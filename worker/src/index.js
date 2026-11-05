const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const BUCKET = 'linkora-assets';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
let jwksMemo = { keys: null, expiresAt: 0, promise: null };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!origin) return {};
  if (!allowed.includes(origin)) return null;
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, DELETE, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '86400', 'vary': 'Origin' };
}
function base64urlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function decodeSegment(value) { return JSON.parse(new TextDecoder().decode(base64urlToBytes(value))); }

async function googleKeys(fetcher, force = false) {
  const now = Date.now();
  if (!force && jwksMemo.keys && jwksMemo.expiresAt > now) return jwksMemo.keys;
  if (!force && jwksMemo.promise) return jwksMemo.promise;
  jwksMemo.promise = (async () => {
    const response = await fetcher(JWKS_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Unable to load Firebase signing keys');
    const body = await response.json();
    const cacheControl = response.headers.get('cache-control') || '';
    const seconds = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
    jwksMemo = { keys: body.keys || [], expiresAt: Date.now() + Math.max(60, Math.min(seconds, 21600)) * 1000, promise: null };
    return jwksMemo.keys;
  })();
  try { return await jwksMemo.promise; } catch (error) { jwksMemo.promise = null; throw error; }
}

export async function verifyFirebaseToken(token, projectId, fetcher = fetch) {
  if (!token || !projectId) throw new Error('Missing token or Firebase project configuration');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported token signature');
  const keys = await googleKeys(fetcher);
  let jwk = keys.find(key => key.kid === header.kid && key.alg === 'RS256' && key.use === 'sig');
  if (!jwk) {
    const rotatedKeys = await googleKeys(fetcher, true);
    jwk = rotatedKeys.find(key => key.kid === header.kid && key.alg === 'RS256' && key.use === 'sig');
  }
  if (!jwk) throw new Error('Unknown Firebase signing key');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error('Invalid token signature');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== `https://securetoken.google.com/${projectId}` || claims.aud !== projectId) throw new Error('Wrong Firebase issuer or audience');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new Error('Invalid Firebase UID');
  if (!Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 300 || !Number.isFinite(claims.auth_time) || claims.auth_time > now + 300) throw new Error('Expired or invalid token time');
  return { uid: claims.sub, claims };
}

function fileType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
function safeObjectPath(value, uid) {
  if (typeof value !== 'string' || value.length > 240) return false;
  const pieces = value.split('/');
  return pieces.length === 4 && pieces[0] === 'profiles' && pieces[1] === uid && ['avatar', 'cover', 'thumbnails'].includes(pieces[2]) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(pieces[3]);
}
function storageUrl(env, path) {
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
async function upload(request, env, uid, fetcher) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_FILE_SIZE + 65536) return json({ error: 'Image exceeds the 5 MB upload limit.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Expected multipart form data.' }, 400); }
  const file = form.get('file');
  const assetType = form.get('assetType');
  if (!(file instanceof File)) return json({ error: 'Choose an image file.' }, 400);
  if (!['avatar', 'cover', 'thumbnails'].includes(assetType)) return json({ error: 'Invalid asset type.' }, 400);
  if (file.size < 1 || file.size > MAX_FILE_SIZE) return json({ error: 'Images must be between 1 byte and 5 MB.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = fileType(bytes);
  if (!detected || file.type !== detected.mime) return json({ error: 'Only valid JPEG, PNG and WebP images are supported.' }, 415);
  const path = `profiles/${uid}/${assetType}/${crypto.randomUUID()}.${detected.ext}`;
  const response = await fetcher(storageUrl(env, path), { method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': detected.mime, 'x-upsert': 'false' }, body: bytes });
  if (!response.ok) return json({ error: 'Image upload failed.' }, 502);
  const publicUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return json({ url: publicUrl, path, contentType: detected.mime, size: file.size }, 201);
}
async function remove(request, env, uid, fetcher) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Expected a JSON object.' }, 400); }
  const path = body?.path;
  if (!safeObjectPath(path, uid)) return json({ error: 'Invalid or unauthorized object path.' }, 403);
  const response = await fetcher(storageUrl(env, path), { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok && response.status !== 404) return json({ error: 'Image deletion failed.' }, 502);
  return json({ deleted: true, path });
}

export async function handleRequest(request, env, fetcher = fetch) {
  const cors = corsHeaders(request, env);
  if (cors === null) return json({ error: 'Origin is not allowed.' }, 403);
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors || {} });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.FIREBASE_PROJECT_ID) return json({ error: 'Storage service is not configured.' }, 503, cors || {});
  if ((url.pathname !== '/api/upload' || request.method !== 'POST') && (url.pathname !== '/api/delete' || request.method !== 'DELETE')) return json({ error: 'Not found.' }, 404, cors || {});
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401, cors || {});
  let identity;
  try { identity = await verifyFirebaseToken(authorization.slice(7).trim(), env.FIREBASE_PROJECT_ID, fetcher); }
  catch { return json({ error: 'Invalid or expired Firebase ID token.' }, 401, cors || {}); }
  try {
    const response = url.pathname === '/api/upload' ? await upload(request, env, identity.uid, fetcher) : await remove(request, env, identity.uid, fetcher);
    const headers = new Headers(response.headers); for (const [key, value] of Object.entries(cors || {})) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return json({ error: 'Storage request could not be completed.' }, 502, cors || {});
  }
}

export default { fetch(request, env) { return handleRequest(request, env, fetch); } };

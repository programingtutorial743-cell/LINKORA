import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, sign } from 'node:crypto';
import { promisify } from 'node:util';
import { handleRequest } from '../src/index.js';

const makePair = promisify(generateKeyPair);
const signAsync = promisify(sign);
let privateKey, jwk;
const project = 'linkora-d6e85';
const env = { FIREBASE_PROJECT_ID: project, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-secret', ALLOWED_ORIGINS: 'http://localhost:8000' };
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function token(uid = 'firebase-user-1', extra = {}, key = privateKey, keyId = jwk.kid) {
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: keyId });
  const now = Math.floor(Date.now()/1000);
  const payload = b64({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, auth_time: now-5, iat: now-2, exp: now+3600, ...extra });
  const input = `${header}.${payload}`;
  const signature = await signAsync('RSA-SHA256', Buffer.from(input), key);
  return `${input}.${signature.toString('base64url')}`;
}
const keyFetch = async url => String(url) === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=300' } })
  : new Response('ok', { status: 201 });
function request(path, { method = 'POST', jwt, origin = 'http://localhost:8000', body, headers = {} } = {}) {
  const h = new Headers({ Origin: origin, ...headers }); if (jwt) h.set('Authorization', `Bearer ${jwt}`);
  return new Request(`https://worker.test${path}`, { method, headers: h, body });
}
function imageForm({ type = 'image/png', bytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]), assetType = 'avatar', size } = {}) {
  const fileBytes = size ? new Uint8Array(size) : bytes;
  if (size) fileBytes.set(bytes);
  const form = new FormData(); form.set('assetType', assetType); form.set('file', new File([fileBytes], 'profile.png', { type })); return form;
}
before(async () => {
  ({ publicKey: jwk, privateKey } = await makePair('rsa', { modulusLength: 2048, publicKeyEncoding: { format: 'jwk' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } }));
  jwk.kid = 'test-kid'; jwk.use = 'sig'; jwk.alg = 'RS256';
});

test('rejects uploads without authentication and with invalid tokens', async () => {
  const unauth = await handleRequest(request('/api/upload', { body: imageForm() }), env, keyFetch);
  assert.equal(unauth.status, 401);
  const invalid = await handleRequest(request('/api/upload', { jwt: 'not.a.valid-token', body: imageForm() }), env, keyFetch);
  assert.equal(invalid.status, 401);
});

test('uploads avatars and covers to unique authenticated folders and returns public URLs', async () => {
  const jwt = await token(); const uploaded = [];
  const fetcher = async (url, init) => {
    if (String(url).startsWith('https://www.googleapis.com/')) return keyFetch(url, init);
    uploaded.push({ url: String(url), init }); return new Response('{}', { status: 200 });
  };
  const avatar = await handleRequest(request('/api/upload', { jwt, body: imageForm({ assetType: 'avatar' }) }), env, fetcher);
  const avatarBody = await avatar.json();
  const replacement = await handleRequest(request('/api/upload', { jwt, body: imageForm({ assetType: 'avatar' }) }), env, fetcher);
  const replacementBody = await replacement.json();
  const cover = await handleRequest(request('/api/upload', { jwt, body: imageForm({ assetType: 'cover' }) }), env, fetcher);
  const coverBody = await cover.json();
  assert.equal(avatar.status, 201); assert.equal(cover.status, 201);
  assert.match(avatarBody.path, /^profiles\/firebase-user-1\/avatar\/[0-9a-f-]{36}\.png$/);
  assert.match(coverBody.path, /^profiles\/firebase-user-1\/cover\/[0-9a-f-]{36}\.png$/);
  assert.notEqual(avatarBody.path, replacementBody.path); assert.notEqual(avatarBody.path, coverBody.path);
  assert.equal(avatarBody.url, `https://example.supabase.co/storage/v1/object/public/linkora-assets/${avatarBody.path}`);
  assert.equal(uploaded[0].init.headers['x-upsert'], 'false');
  assert.equal(uploaded[0].init.headers.apikey, 'test-service-secret');
});

test('rejects unsupported formats and images larger than 5 MB', async () => {
  const jwt = await token();
  const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }); const form = new FormData(); form.set('assetType','avatar');form.set('file',svg);
  const unsupported = await handleRequest(request('/api/upload', { jwt, body: form }), env, keyFetch);
  assert.equal(unsupported.status, 415);
  const oversized = await handleRequest(request('/api/upload', { jwt, body: imageForm({ size: 5 * 1024 * 1024 + 1 }) }), env, keyFetch);
  assert.equal(oversized.status, 413);
});

test('deletes an owned object, rejects another UID path, and rejects unapproved origins', async () => {
  const jwt = await token(); const calls = [];
  const fetcher = async (url, init) => { if (String(url).startsWith('https://www.googleapis.com/')) return keyFetch(url, init); calls.push({url:String(url),init}); return new Response('',{status:200}); };
  const path = 'profiles/firebase-user-1/avatar/12345678-1234-1234-1234-123456789abc.png';
  const ok = await handleRequest(request('/api/delete', { method:'DELETE', jwt, body:JSON.stringify({path}), headers:{'Content-Type':'application/json'} }), env, fetcher);
  assert.equal(ok.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'DELETE');
  const other = await handleRequest(request('/api/delete', { method:'DELETE', jwt, body:JSON.stringify({path:path.replace('firebase-user-1','someone-else')}), headers:{'Content-Type':'application/json'} }), env, fetcher);
  assert.equal(other.status, 403); assert.equal(calls.length, 1);
  const blocked = await handleRequest(request('/api/delete', { method:'DELETE', jwt, origin:'https://evil.example', body:JSON.stringify({path}), headers:{'Content-Type':'application/json'} }), env, fetcher);
  assert.equal(blocked.status, 403);
});

test('rejects correctly signed tokens for another Firebase audience', async () => {
  const jwt = await token('firebase-user-1', { aud: 'another-project' });
  const response = await handleRequest(request('/api/delete', { method:'DELETE', jwt, body:JSON.stringify({path:'profiles/firebase-user-1/avatar/12345678-1234-1234-1234-123456789abc.png'}), headers:{'Content-Type':'application/json'} }), env, keyFetch);
  assert.equal(response.status, 401);
});

test('rejects tokens with a bad signature and expired claims', async () => {
  const valid = await token();const parts=valid.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  const badSignature=await handleRequest(request('/api/delete',{method:'DELETE',jwt:parts.join('.'),body:'{}',headers:{'Content-Type':'application/json'}}),env,keyFetch);
  assert.equal(badSignature.status,401);
  const expired=await token('firebase-user-1',{exp:Math.floor(Date.now()/1000)-5});
  const expiredResponse=await handleRequest(request('/api/delete',{method:'DELETE',jwt:expired,body:'{}',headers:{'Content-Type':'application/json'}}),env,keyFetch);
  assert.equal(expiredResponse.status,401);
});

test('refreshes Google signing keys when a token uses a newly rotated key ID', async () => {
  const pair = await makePair('rsa', { modulusLength: 2048, publicKeyEncoding: { format: 'jwk' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
  const nextKey = pair.publicKey; nextKey.kid = 'rotated-kid'; nextKey.use = 'sig'; nextKey.alg = 'RS256';
  const jwt = await token('firebase-user-1', {}, pair.privateKey, nextKey.kid); let fetchCount = 0;
  const rotatedFetch = async (url, init) => {
    if (String(url).startsWith('https://www.googleapis.com/')) { fetchCount++; return new Response(JSON.stringify({keys:[fetchCount === 1 ? nextKey : jwk]}),{headers:{'cache-control':'public, max-age=300'}}); }
    return new Response('{}',{status:200});
  };
  const response = await handleRequest(request('/api/delete',{method:'DELETE',jwt,body:JSON.stringify({path:'profiles/firebase-user-1/avatar/12345678-1234-1234-1234-123456789abc.png'}),headers:{'Content-Type':'application/json'}}),env,rotatedFetch);
  assert.equal(response.status,200);assert.equal(fetchCount,1);
});



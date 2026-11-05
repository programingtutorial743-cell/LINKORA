# LINKORA

LINKORA is a static Cloudflare Pages link-in-bio app built with HTML, CSS, vanilla JavaScript modules, Firebase Authentication and Firestore. Profile media is stored in the public Supabase Storage bucket `linkora-assets`; a Cloudflare Worker verifies Firebase ID tokens and performs authenticated uploads and deletes with a Supabase service-role secret.

## Local development

Serve the frontend (ES modules do not work from `file://`):

```sh
python -m http.server 8000
```

In another terminal, start the storage Worker:

```sh
cd worker
npm install
```

Create `worker/.dev.vars` (this file is ignored by Git) with:

```dotenv
SUPABASE_URL=https://rewvfsgbdkakeajzssjs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Then run `npm run dev`. Open <http://localhost:8000>. `js/config.js` points image requests to the local Worker at `http://127.0.0.1:8787` by default. The Firebase project's Authentication authorized domains must include `localhost` and `127.0.0.1`.

## Supabase setup

1. In Supabase project `rewvfsgbdkakeajzssjs`, create a Storage bucket named `linkora-assets` and mark it **public**. It is only for public creator avatars, cover images and link thumbnails. Do not put private or sensitive files there.
2. Copy the **service_role** key from the project's API settings for Worker secret setup only. Never add it to the site, `js/config.js`, Pages variables, or Git.
3. The publishable key is public and does not need to be used by the browser: the browser only communicates with the Worker.

The Worker chooses paths from the verified Firebase UID: `profiles/{uid}/avatar/{uuid}.{jpg|png|webp}`, `profiles/{uid}/cover/{uuid}.{jpg|png|webp}`, or `profiles/{uid}/thumbnails/{uuid}.{jpg|png|webp}`. The client cannot choose a UID or an upload path. Uploads are limited to valid JPEG, PNG and WebP images up to 5 MB. Existing public image URLs are still rendered as stored.

## Deploy the Worker

From `worker/`, install Wrangler, authenticate, and run the Worker tests:

```sh
npm install
npm test
npx wrangler login
npx wrangler whoami
npx wrangler secret list
```

Configure the required Cloudflare Worker secrets without placing their values in files or source code. You can either run `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (enter each value when prompted; each command deploys a new Worker version), or prepare `worker/.dev.vars` locally (it is ignored by Git) with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and deploy with `npm run deploy -- --secrets-file .dev.vars`. Do not run the deploy command until you intend to deploy. `wrangler secret list` shows configured names, not values. The Worker reads both Supabase values only from its environment; neither belongs in source code or frontend configuration. Keep `FIREBASE_PROJECT_ID` set to `linkora-d6e85` in `worker/wrangler.toml` and set `ALLOWED_ORIGINS` to exact site origins without trailing slashes (including `https://linkora-61l.pages.dev` and the localhost origins used for development).

After deployment, set the public, non-secret Worker URL in `js/config.js`:

```js
window.LINKORA_STORAGE_API_URL = 'https://linkora-storage.YOUR_ACCOUNT.workers.dev';
```

Commit and deploy the frontend to Cloudflare Pages. Keep the Worker URL free of `/api`; the frontend appends `/api/upload` and `/api/delete` itself. Add the deployed Pages host to Firebase Authentication's authorized domains. The Worker CORS allowlist must exactly include every frontend origin.

## Firebase setup

The Firebase Web SDK is initialized once in `js/firebase.js` for project `linkora-d6e85`.

1. Enable **Authentication → Email/Password**, configure verification and password-reset email templates, and add local/deployed origins to authorized domains.
2. Create Firestore and publish `firestore.rules`.
3. Firebase Storage is no longer used; no Firebase Storage bucket or rules deployment is needed.

The Firebase web API key is a public project identifier. Never add Firebase service-account credentials or private keys to frontend files.

## Checks

Run the Worker unit tests from the repository root:

```sh
node --test worker/test/index.test.js
```

They use generated Firebase signing keys and mocked Google/Supabase HTTP responses. They cover token checks, avatar and cover paths, public URL creation, upload limits, file-type validation, deletion ownership and CORS. They do not contact Supabase, Firebase, or deploy the Worker.

## Current app behavior and remaining setup

- The dashboard Appearance page uploads, replaces and removes avatar and cover images. Firestore receives the URL and private object path only after the Worker confirms an upload. Old managed images are removed after replacement; profile previews update immediately.
- Account deletion removes current Worker-managed avatar/cover objects, public profiles and links. Earlier Firebase Storage URLs continue to display, but files created by the old storage implementation cannot be removed through this Worker because no Supabase object path was recorded for them.
- The Worker has no list endpoint by design. If you add more asset types, store their paths in the owner-only Firestore profile and add corresponding cleanup calls.
- Analytics ingestion and Pro billing remain disabled pending their respective protected backend integrations. No simulated counts or payments are shown.

## Cloudflare Pages

Create a Pages project from the Git repository with no build command and the repository root as the output directory. `_redirects` rewrites `/u/username` to the profile renderer and supports direct navigation and refresh. Deploy `firestore.rules` in Firebase, deploy the Worker separately as above, set the Worker URL in `js/config.js`, and add the exact Pages domain to Firebase Auth and the Worker CORS allowlist.

// Use the local Worker with the Python dev server; use the deployed Worker everywhere else.
const isLocalFrontend = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.LINKORA_STORAGE_API_URL ||= isLocalFrontend
  ? 'http://127.0.0.1:8787'
  : 'https://linkora-storage.micnu123.workers.dev';

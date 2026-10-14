import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolio } from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';

class MemoryStore {
  values = new Map(); sequence = 0; hook = null;
  async set(key, value, options = {}) {
    if (this.hook) { const hook = this.hook; this.hook = null; await hook(key); }
    const old = this.values.get(key);
    if (options.onlyIfNew && old || options.onlyIfMatch && old?.etag !== options.onlyIfMatch) return { modified: false };
    const data = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    const etag = '"' + ++this.sequence + '"'; this.values.set(key, { bytes: data.slice(), etag, metadata: options.metadata || {} });
    return { modified: true, etag };
  }
  setJSON(key, value, options) { return this.set(key, JSON.stringify(value), options); }
  async getWithMetadata(key, options = {}) {
    const stored = this.values.get(key); if (!stored) return null;
    const text = () => new TextDecoder().decode(stored.bytes);
    const data = options.type === 'json' ? JSON.parse(text()) : options.type === 'arrayBuffer' ? stored.bytes.slice().buffer : text();
    return { data, etag: stored.etag, metadata: structuredClone(stored.metadata) };
  }
  async get(key, options) { return (await this.getWithMetadata(key, options))?.data ?? null; }
  async getMetadata(key) { const item = this.values.get(key); return item ? { etag: item.etag, metadata: structuredClone(item.metadata) } : null; }
  async delete(key) { this.values.delete(key); }
}
const password = 'test-only-password-with-many-characters';
function setup() {
  const store = new MemoryStore(); let time = Date.now();
  const app = createPortfolio({ store, password, initialDocument, now: () => time });
  let cookie = '';
  async function call(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.auth !== false && cookie) headers.set('cookie', cookie);
    if (options.method && !['GET', 'HEAD'].includes(options.method) && options.origin !== false) headers.set('origin', 'https://portfolio.example');
    const body = options.body instanceof Uint8Array ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body);
    return app.fetch(new Request('https://portfolio.example' + path, { method: options.method || 'GET', headers, body }), { ip: 'test-ip', rewrite: async () => new Response('private-editor') });
  }
  async function login() {
    const response = await call('/api/login', { method: 'POST', body: { password } });
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0]; return response;
  }
  return { store, app, call, login, expire: () => time += 9 * 60 * 60 * 1000, cookie: () => cookie };
}
const doc = () => structuredClone(initialDocument);

test('anonymous visitors see published portfolio; draft and upload require an actual owner session', async () => {
  const env = setup();
  assert.equal((await env.call('/api/session')).status, 200);
  assert.equal((await (await env.call('/api/session')).json()).canEdit, false);
  assert.deepEqual((await (await env.call('/api/content')).json()).document, initialDocument);
  assert.equal((await env.call('/api/draft')).status, 401);
  assert.equal((await env.call('/api/draft', { headers: { 'oai-authenticated-user-id': 'fake', 'oai-authenticated-user-email': 'fake' } })).status, 401);
  assert.equal((await env.call('/api/media/start', { method: 'POST', body: { type: 'video/mp4', size: 100 } })).status, 401);
  const response = await env.call('/uredi'); assert.equal(response.status, 302); assert.match(response.headers.get('location'), /prijava.html$/);
});

test('secure cookie authenticates owner, expires and is invalidated by changing password', async () => {
  const env = setup(), response = await env.login();
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(response.headers.get('set-cookie').includes(flag));
  assert.equal((await (await env.call('/api/session')).json()).canEdit, true);
  assert.equal(await (await env.call('/uredi')).text(), 'private-editor');
  const changed = createPortfolio({ store: env.store, password: password + 'changed', initialDocument });
  const session = await changed.fetch(new Request('https://portfolio.example/api/session', { headers: { cookie: env.cookie() } }));
  assert.equal((await session.json()).canEdit, false);
  env.expire(); assert.equal((await env.call('/api/draft')).status, 401);
});

test('saving a private draft never changes public content; publish changes public content atomically', async () => {
  const env = setup(); await env.login(); const edited = doc(); edited.texts[0] = 'Nova javna verzija';
  let response = await env.call('/api/draft', { method: 'PUT', body: { document: edited, revision: 0 } }); assert.equal(response.status, 200);
  assert.equal((await (await env.call('/api/content', { auth: false })).json()).document.texts[0], initialDocument.texts[0]);
  assert.equal((await env.call('/api/draft', { auth: false })).status, 401);
  response = await env.call('/api/publish', { method: 'POST', body: { revision: 1 } }); assert.equal(response.status, 200);
  assert.equal((await (await env.call('/api/content', { auth: false })).json()).document.texts[0], edited.texts[0]);
  edited.texts[0] = 'Privatna promjena';
  assert.equal((await env.call('/api/draft', { method: 'PUT', body: { document: edited, revision: 1 } })).status, 200);
  assert.equal((await (await env.call('/api/content', { auth: false })).json()).document.texts[0], 'Nova javna verzija');
  assert.equal((await env.call('/api/draft', { method: 'PUT', body: { document: edited, revision: 1 } })).status, 409);
  assert.equal((await env.call('/api/publish', { method: 'POST', body: { revision: 1 } })).status, 409);
});

test('cross-origin saves, invalid media URLs and absent media cannot replace published snapshot', async () => {
  const env = setup(); await env.login();
  assert.equal((await env.call('/api/draft', { method: 'PUT', body: { document: doc(), revision: 0 }, origin: false })).status, 403);
  const invalid = doc(); invalid.photos[0].src = 'https://other-site.example/photo.jpg';
  assert.equal((await env.call('/api/draft', { method: 'PUT', body: { document: invalid, revision: 0 } })).status, 400);
  const edited = doc(); edited.videos[0].src = '/media/' + crypto.randomUUID() + '.mp4'; edited.videos[0].present = true;
  assert.equal((await env.call('/api/draft', { method: 'PUT', body: { document: edited, revision: 0 } })).status, 200);
  assert.equal((await env.call('/api/publish', { method: 'POST', body: { revision: 1 } })).status, 400);
  assert.deepEqual((await (await env.call('/api/content')).json()).document, initialDocument);
});

test('conditional state write prevents a concurrent draft edit being overwritten by publish', async () => {
  const env = setup(); await env.login();
  await env.call('/api/draft', { method: 'PUT', body: { document: doc(), revision: 0 } });
  env.store.hook = async key => {
    if (key === 'state') { const state = await env.store.get('state', { type: 'json' }); state.draft.revision = 2; state.draft.document.texts[0] = 'Concurrent'; await env.store.setJSON('state', state); }
  };
  assert.equal((await env.call('/api/publish', { method: 'POST', body: { revision: 1 } })).status, 409);
  assert.equal((await (await env.call('/api/draft')).json()).document.texts[0], 'Concurrent');
  assert.deepEqual((await (await env.call('/api/content')).json()).document, initialDocument);
});

test('chunk upload persists binary video; private until published; public byte ranges seek across chunks', async () => {
  const env = setup(); await env.login(); const size = 2 * 1024 * 1024 * 2 + 123;
  const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
  const created = await (await env.call('/api/media/start', { method: 'POST', body: { type: 'video/mp4', size } })).json();
  const parts = [];
  for (let offset = 0, part = 1; offset < size; offset += created.partSize, part++) {
    const response = await env.call('/api/media/part?id=' + created.id + '&part=' + part, { method: 'PUT', body: bytes.slice(offset, offset + created.partSize) });
    assert.equal(response.status, 200); parts.push(await response.json());
  }
  assert.equal((await env.call('/api/media/complete', { method: 'POST', body: { id: created.id, parts: parts.slice(1) } })).status, 400);
  const complete = await env.call('/api/media/complete', { method: 'POST', body: { id: created.id, parts } }); assert.equal(complete.status, 200);
  const media = (await complete.json()).url;
  assert.equal((await env.call(media, { auth: false })).status, 401);
  assert.equal((await env.call('/api/media/abort', { method: 'POST', body: { id: created.id } })).status, 409);
  const edited = doc(); edited.videos[0].src = media; edited.videos[0].present = true;
  await env.call('/api/draft', { method: 'PUT', body: { document: edited, revision: 0 } });
  await env.call('/api/publish', { method: 'POST', body: { revision: 1 } });
  const ranged = await env.call(media, { auth: false, headers: { range: 'bytes=2097140-2097170' } });
  assert.equal(ranged.status, 206); assert.equal(ranged.headers.get('content-range'), 'bytes 2097140-2097170/' + size);
  assert.deepEqual(new Uint8Array(await ranged.arrayBuffer()), bytes.slice(2097140, 2097171));
  const suffix = await env.call(media, { auth: false, headers: { range: 'bytes=-20' } }); assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), bytes.slice(-20));
  assert.equal((await env.call(media, { auth: false, headers: { range: 'bytes=999999999-' } })).status, 416);
  const full = await env.call(media, { auth: false }); assert.equal(full.status, 200); assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes);
  const head = await env.call(media, { auth: false, method: 'HEAD' }); assert.equal(head.headers.get('content-length'), String(size)); assert.equal(await head.text(), '');
  const freshRuntime = createPortfolio({ store: env.store, password, initialDocument: { ...initialDocument, title: 'A later code deploy' } });
  const stillSaved = await freshRuntime.fetch(new Request('https://portfolio.example/api/content')); assert.equal((await stillSaved.json()).document.videos[0].src, media);
});

test('owner setup fails closed and repeated wrong passwords are throttled', async () => {
  const store = new MemoryStore(), unconfigured = createPortfolio({ store, password: '', initialDocument });
  const response = await unconfigured.fetch(new Request('https://portfolio.example/api/login', { method: 'POST', headers: { origin: 'https://portfolio.example' }, body: JSON.stringify({ password: '' }) })); assert.equal(response.status, 503);
  const env = setup();
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await env.call('/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await env.call('/api/login', { method: 'POST', body: { password } })).status, 429);
});

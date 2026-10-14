import { ORIGINAL_PART_SIZE } from './original-storage.js';
import SparkMD5 from './vendor/spark-md5.js';
const PART_SIZE = 512 * 1024;
const LEGACY_PART_SIZE = 2 * 1024 * 1024;
const MAX_SIZE = 2 * 1024 * 1024 * 1024;
const COOKIE = '__Host-anchos-owner';
const SESSION_SECONDS = 8 * 60 * 60;
const UPLOAD_TTL = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/x-m4v': 'm4v' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
const hash = async value => hex(await crypto.subtle.digest('SHA-256', value));
async function limitedBody(request, max) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Nedostaju podaci.');
  let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); fail(413, 'Podaci su preveliki.'); }
    chunks.push(value);
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
async function readJSON(request, max = 2 * 1024 * 1024) {
  const bytes = await limitedBody(request, max);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'Neispravni podaci.'); }
}
function sameOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) fail(403, 'Spremanje je dopušteno samo s ove stranice.');
}
function sourceOK(src) {
  return typeof src === 'string' && (/^\/media\/[a-f0-9-]{36}\.(jpg|png|webp|mp4|mov|m4v|webm|ogv)$/.test(src) || /^assets\/[a-zA-Z0-9_-]+\.(webp|jpg|png)$/.test(src));
}
export function validateDocument(doc) {
  if (!doc || !Array.isArray(doc.texts) || !Array.isArray(doc.photos) || !Array.isArray(doc.videos)) fail(400, 'Nedostaje sadržaj portfolija.');
  if (doc.texts.length > 200 || doc.photos.length > 30 || doc.videos.length !== 5) fail(400, 'Neispravan broj elemenata.');
  for (const text of [...doc.texts, doc.title, doc.description, doc.email, doc.phone]) if (typeof text !== 'string' || text.length > 20000) fail(400, 'Neispravan tekst.');
  for (const photo of doc.photos) if (!photo || !sourceOK(photo.src) || typeof photo.alt !== 'string' || photo.alt.length > 1000) fail(400, 'Fotografija nije spremljena.');
  const slots = new Set();
  for (const video of doc.videos) {
    if (!video || !['1', '2', '3', '4', '5'].includes(video.slot) || slots.has(video.slot)) fail(400, 'Neispravna mjesta za videe.');
    slots.add(video.slot);
    if (typeof video.src !== 'string' || (video.src && !sourceOK(video.src)) || (!video.src && video.present)) fail(400, 'Video nije spremljen.');
  }
  const value = doc.collaborations;
  if (value !== undefined) {
    if (!value || !Array.isArray(value.items) || value.items.length > 100 || !value.labels) fail(400, 'Neispravne suradnje.');
    for (const item of value.items) if (!item || typeof item.brand !== 'string' || item.brand.length > 500 || typeof item.comment !== 'string' || item.comment.length > 10000) fail(400, 'Neispravan komentar.');
    for (const key of ['eyebrow', 'heading', 'caption']) if (typeof value.labels[key] !== 'string' || value.labels[key].length > 1000) fail(400, 'Neispravan naslov suradnji.');
  }
  if (!Array.isArray(doc.colors) || doc.colors.length !== 3 || doc.colors.some(c => !/^#[0-9a-f]{6}$/i.test(c))) fail(400, 'Neispravne boje.');
}
function uploadKey(id) {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) fail(400, 'Neispravno učitavanje.');
  return 'uploads/' + id;
}
const partKey = (id, part) => 'parts/' + id + '/' + part;
export function createPortfolio({ store, password, initialDocument, originals = null, migrationEnabled = false, dispatch = globalThis.fetch, now = () => Date.now(), log = data => console.error(JSON.stringify(data)) }) {
  const get = (key, type = 'json') => store.get(key, { type, consistency: 'strong' });
  const entry = (key, type = 'json') => store.getWithMetadata(key, { type, consistency: 'strong' });
  const emptyState = () => ({ draft: null, published: null });
  async function signed(value) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  }
  async function matches(value, signature) {
    if (!/^[a-f0-9]{64}$/.test(signature || '')) return false;
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(signature.match(/../g), x => parseInt(x, 16));
    return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(value));
  }
  async function authorized(request) {
    if (password.length < 16) return false;
    const value = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!value) return false;
    const [expiry, nonce, signature, ...extra] = value.split('.');
    const expiration = Number(expiry);
    if (extra.length || !Number.isSafeInteger(expiration) || expiration <= now() || expiration > now() + SESSION_SECONDS * 1000 || !/^[a-f0-9-]{36}$/.test(nonce)) return false;
    return matches('session:' + expiry + '.' + nonce + ':' + new URL(request.url).host, signature);
  }
  async function owner(request) { if (!await authorized(request)) fail(401, 'Prijavi se za uređivanje portfolija.'); }
  async function mutateState(previous, value) {
    // Keep an immutable recovery copy before replacing any existing state.
    // The production store and every existing media key remain unchanged.
    if (previous) await store.setJSON('history/' + await hash(encoder.encode(previous.etag)), previous.data, { onlyIfNew: true });
    const result = await store.setJSON('state', value, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
    if (!result.modified) fail(409, 'Postoji noviji nacrt. Tvoje izmjene su zadržane u ovoj kartici.');
  }
  async function uploadSession(id) {
    const result = await get(uploadKey(id));
    if (!result || now() - result.createdAt > UPLOAD_TTL) fail(410, 'Učitavanje je isteklo. Ponovno odaberi datoteku.');
    return result;
  }
  async function loginLimit(ip) {
    const key = 'login-rate/' + await signed('ip:' + (ip || 'unknown'));
    for (let attempt = 0; attempt < 4; attempt++) {
      const old = await entry(key);
      const counter = !old || now() - old.data.since >= 10 * 60 * 1000 ? { since: now(), count: 0 } : old.data;
      if (counter.count >= 10) fail(429, 'Previše pokušaja. Pokušaj ponovno za 10 minuta.');
      const result = await store.setJSON(key, { ...counter, count: counter.count + 1 }, old ? { onlyIfMatch: old.etag } : { onlyIfNew: true });
      if (result.modified) return;
    }
    fail(429, 'Pokušaj ponovno za nekoliko trenutaka.');
  }
  return { async fetch(request, context = {}) {
    const url = new URL(request.url), path = url.pathname;
    const startedAt = now(), trace = crypto.randomUUID();
    try {
      if (path === '/api/health' && request.method === 'GET') {
        await store.getMetadata('state', { consistency: 'strong' });
        return json({ ready: true, build: 'original-video-delivery-v4', originalStorageConfigured:!!originals });
      }
      if (path === '/uredi' && ['GET', 'HEAD'].includes(request.method)) {
        const destination = await authorized(request) ? '/index.html' : '/prijava.html';
        if (destination === '/prijava.html') return Response.redirect(url.origin + destination, 302);
        if (!context.rewrite) fail(503, 'Pregled uređivanja nije dostupan.');
        const response = await context.rewrite(destination);
        const headers = new Headers(response.headers); headers.set('cache-control', 'no-store');
        return new Response(response.body, { status: response.status, headers });
      }
      if (path === '/api/login' && request.method === 'POST') {
        sameOrigin(request);
        if (password.length < 16) fail(503, 'Uređivanje još nije aktivirano. Vlasnica treba postaviti lozinku u Netlifyju.');
        await loginLimit(context.ip);
        const data = await readJSON(request, 4096);
        if (typeof data.password !== 'string' || data.password.length > 1024 || !await matches('password:' + data.password, await signed('password:' + password))) fail(401, 'Lozinka nije ispravna.');
        const value = String(now() + SESSION_SECONDS * 1000) + '.' + crypto.randomUUID();
        const token = value + '.' + await signed('session:' + value + ':' + url.host);
        return json({ signedIn: true }, 200, { 'set-cookie': COOKIE + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + SESSION_SECONDS });
      }
      if (path === '/api/logout' && request.method === 'POST') {
        sameOrigin(request);
        return json({ signedOut: true }, 200, { 'set-cookie': COOKIE + '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0' });
      }
      if (path === '/api/session' && request.method === 'GET') {
        const canEdit=await authorized(request);
        if (!canEdit || !originals || !migrationEnabled) return json({canEdit});
        const state=await get('state');
        const files=[...new Set([...(state?.draft?.document?.videos || []),...(state?.published?.document?.videos || [])].map(v=>v.src).filter(src=>src.startsWith('/media/')))];
        const manifests=await Promise.all(files.map(src=>get('media/'+src.slice(7))));
        return json({canEdit,canPrepareOriginals:true,migrationNeeded:manifests.some(m=>m?.type?.startsWith('video/') && (m.backend!=='r2'||m.type==='video/mp4'&&!m.playback?.ready))});
      }
      if (path === '/api/originals/migrate' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        if (!originals || !migrationEnabled) fail(503,'Prijenos postojećih originala još nije aktiviran.');
        const body=JSON.stringify({expires:now()+300000,nonce:crypto.randomUUID()});
        const response=await dispatch(url.origin+'/.netlify/functions/migrate-originals-background',{method:'POST',headers:{'content-type':'application/json','x-anchos-signature':await signed('original-migration:'+body)},body,signal:AbortSignal.timeout(10000),redirect:'error'});
        await response.body?.cancel();
        if (response.status!==202) fail(503,'Prijenos originala nije pokrenut. Sadržaj je zadržan.');
        return json({started:true,originalsRetained:true});
      }
      if (path === '/api/originals/status' && request.method === 'GET') {
        await owner(request);
        const state=await get('state');
        const files=[...new Set([...(state?.draft?.document?.videos || []),...(state?.published?.document?.videos || [])].map(v=>v.src).filter(src=>/^\/media\/[a-f0-9-]{36}\.(mp4|mov|m4v|webm|ogv)$/.test(src)))];
        const progress=await Promise.all(files.map(async src=>{
          const file=src.slice(7),manifest=await get('media/'+file),job=await get('original-migrations/'+file),playback=await get('playback-preparations/'+file);
          const ready=manifest?.backend==='r2'&&(manifest.type!=='video/mp4'||manifest.playback?.ready);
          return {status:ready?'verified':playback?.status||job?.status || 'waiting',bytes:manifest?.size || 0,copiedBytes:ready?manifest.size:playback?.copiedBytes||job?.copiedBytes || 0};
        }));
        return json({total:progress.length,verified:progress.filter(p=>p.status==='verified').length,paused:progress.some(p=>p.status==='paused'),copiedBytes:progress.reduce((n,p)=>n+p.copiedBytes,0),totalBytes:progress.reduce((n,p)=>n+p.bytes,0)});
      }
      if (path === '/api/originals/check' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        if (!originals) fail(503,'Nova pohrana još nije uključena.');
        // Isolated 64 KiB test object. Never touches any portfolio reference.
        const bytes=Uint8Array.from({length:65536},(_,i)=>i%251);
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
        const checksum=btoa(SparkMD5.ArrayBuffer.hash(bytes.buffer,true));
        const key='originals/'+crypto.randomUUID()+'.mp4';
        const uploadId=await originals.start(key,'video/mp4');
        const signedPart=await originals.partURL(key,uploadId,1,checksum);
        const uploaded=await dispatch(signedPart.url,{method:'PUT',headers:signedPart.headers,body:bytes,signal:AbortSignal.timeout(25000),redirect:'error'});
        if (!uploaded.ok) {
          const errorXML=await uploaded.text();
          const code=errorXML.match(/<Code>([A-Za-z0-9_-]{1,80})<\/Code>/)?.[1];
          fail(503,'Probni prijenos nije potvrđen ('+uploaded.status+(code?', '+code:'')+').');
        }
        await uploaded.body?.cancel();
        const parts=await originals.list(key,uploadId);
        if (parts.length!==1 || parts[0].size!==bytes.length || parts[0].checksum!==checksum) fail(503,'Probni original nije potvrđen u pohrani.');
        await originals.complete(key,uploadId,parts);
        const head=await originals.head(key);
        if (!head || head.size!==bytes.length || head.type!=='video/mp4') fail(503,'Podaci probne kopije nisu potvrđeni.');
        const full=await originals.read(key),copy=await full.arrayBuffer();
        if (copy.byteLength!==bytes.length || await hash(copy)!==hex(digest)) fail(503,'Izvorni bajtovi probne kopije nisu potvrđeni.');
        const ranged=await dispatch(await originals.signedURL(key),{headers:{range:'bytes=31-94'},signal:AbortSignal.timeout(25000),redirect:'error'});
        const rangeBytes=new Uint8Array(await ranged.arrayBuffer());
        if (ranged.status!==206 || ranged.headers.get('content-range')!=='bytes 31-94/65536' || rangeBytes.length!==64 || rangeBytes.some((v,i)=>v!==bytes[31+i])) fail(503,'Dostava dijelova originala nije potvrđena.');
        await store.setJSON('original-storage-checks/'+url.host,{verifiedAt:new Date(now()).toISOString(),key,sha256:hex(digest)});
        return json({verified:true,originalBytesPreserved:true,rangeVerified:true,portfolioUnchanged:true});
      }
      if (path === '/api/originals/browser-check' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        const data=await readJSON(request,4096);
        const expected='4c4f9a7de2280f04112a35196ceb0010a0230d9a3d7e7f3da971f81016c383e5';
        if (!data.src?.startsWith('/media/') || !sourceOK(data.src) || data.sha256!==expected || data.rangeVerified!==true) fail(400,'Provjera izvornog prijenosa nije potvrđena.');
        const manifest=await get('media/'+data.src.slice(7));
        if (!manifest || manifest.backend!=='r2' || manifest.size!==ORIGINAL_PART_SIZE+97 || manifest.type!=='video/mp4') fail(400,'Probni original nije spremljen.');
        await store.setJSON('original-browser-checks/'+url.host,{verifiedAt:new Date(now()).toISOString(),src:data.src,sha256:expected,rangeVerified:true});
        return json({verified:true});
      }
      if (path === '/api/content' && request.method === 'GET') {
        const state = await get('state');
        return json(state?.published || { document: initialDocument, revision: 0 });
      }
      if (path === '/api/draft') {
        await owner(request);
        const previous = await entry('state'), state = previous?.data || emptyState();
        if (request.method === 'GET') return json(state.draft || { document: state.published?.document || initialDocument, revision: 0 });
        if (request.method !== 'PUT') fail(405, 'Nedopušten postupak.');
        sameOrigin(request);
        const data = await readJSON(request); validateDocument(data.document);
        if (!Number.isSafeInteger(data.revision) || data.revision < 0 || (state.draft?.revision || 0) !== data.revision) fail(409, 'Postoji noviji nacrt. Nemoj zatvoriti ovu karticu.');
        const updatedAt = new Date(now()).toISOString(), revision = data.revision + 1;
        await mutateState(previous, { ...state, draft: { document: data.document, revision, updatedAt } });
        return json({ saved: true, revision, updatedAt });
      }
      if (path === '/api/publish' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        const data = await readJSON(request, 4096), previous = await entry('state'), state = previous?.data;
        if (!state?.draft || !Number.isSafeInteger(data.revision) || state.draft.revision !== data.revision) fail(409, 'Nacrt je promijenjen. Spremi ga pa ponovno objavi.');
        const doc = state.draft.document;
        const files = [...doc.photos.map(p => p.src), ...doc.videos.map(v => v.src)].filter(src => src.startsWith('/media/'));
        for (const src of new Set(files)) if (!await get('media/' + src.slice(7))) fail(400, 'Jedna datoteka nije učitana. Objavljena verzija je zadržana.');
        const updatedAt = new Date(now()).toISOString();
        await mutateState(previous, { ...state, published: { ...state.draft, updatedAt } });
        return json({ published: true, revision: data.revision, updatedAt });
      }
      if (path === '/api/media/start' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        const data = await readJSON(request, 4096), ext = TYPES[data.type];
        if (!ext) fail(400, 'Ovaj format nije podržan. Za video odaberi MP4, MOV, WEBM, M4V ili OGV.');
        if (!Number.isSafeInteger(data.size) || data.size < 1) fail(400, 'Odabrana datoteka je prazna ili je nije moguće pročitati.');
        if (data.size > MAX_SIZE) fail(400, 'Video ima ' + Math.ceil(data.size / 1024 / 1024) + ' MB. Dopušteno je do 2 GB po videu.');
        const fingerprint = data.fingerprint;
        if (fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(fingerprint)) fail(400, 'Neispravna potvrda izvorne datoteke.');
        if (fingerprint) {
          const existing = await get('upload-index/' + fingerprint);
          if (existing) {
            const session = await get(uploadKey(existing.id));
            if (session && now() - session.createdAt <= UPLOAD_TTL && session.size === data.size && session.type === data.type) {
              const completed=await get('media/'+session.file);
              if(completed)return json({id:session.id,completedUrl:'/media/'+session.file,resumed:true,direct:completed.backend==='r2'});
              // Preserve every old part while moving unfinished legacy uploads
              // off the Edge transfer path when direct storage is available.
              if(!originals||!data.type.startsWith('video/')||session.backend==='r2')return json({ id: session.id, partSize: session.partSize || LEGACY_PART_SIZE, verifyBatch: 8, resumed: true, direct: session.backend === 'r2' });
            }
          }
        }
        const id = crypto.randomUUID();
        const direct = !!originals && data.type.startsWith('video/');
        const objectKey = direct ? 'originals/' + id + '.' + ext : undefined;
        const uploadId = direct ? await originals.start(objectKey,data.type) : undefined;
        const partSize = direct ? ORIGINAL_PART_SIZE : PART_SIZE;
        await store.setJSON(uploadKey(id), { id, file: id + '.' + ext, type: data.type, size: data.size, partSize, verified: 0, createdAt: now(), fingerprint: fingerprint || '', ...(direct ? {backend:'r2',objectKey,uploadId}: {}) });
        if (fingerprint) {
          const key = 'upload-index/' + fingerprint, old = await entry(key);
          const saved = await store.setJSON(key, { id }, old ? { onlyIfMatch: old.etag } : { onlyIfNew: true });
          if (!saved.modified) fail(409, 'Ista datoteka se učitava u drugoj kartici. Pokušaj ponovno.');
        }
        return json({ id, partSize, verifyBatch: 8, resumed: false, direct });
      }
      if (path === '/api/media/status' && request.method === 'GET') {
        await owner(request);
        const id = url.searchParams.get('id'), session = await uploadSession(id);
        const partSize = session.partSize || LEGACY_PART_SIZE, count = Math.ceil(session.size / partSize);
        const completed = await get('media/' + session.file);
        if (completed) return json({ completed: true, url: '/media/' + session.file, partSize, count, verified: count });
        if (session.backend === 'r2') {
          if (!originals) fail(503,'Pohrana originala nije povezana.');
          const head = await originals.head(session.objectKey);
          if (head && head.size === session.size && head.type === session.type) {
            await store.setJSON('media/' + session.file,{...session,count},{onlyIfNew:true});
            return json({completed:true,url:'/media/'+session.file,partSize,count,verified:count});
          }
          const parts = await originals.list(session.objectKey,session.uploadId);
          return json({completed:false,direct:true,partSize,count,receipts:parts,more:false});
        }
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isInteger(offset) || offset < 0 || offset >= count) fail(400, 'Neispravan nastavak prijenosa.');
        const receipts = [];
        for (let base = offset; base < Math.min(count, offset + 16); base += 4) {
          const group = await Promise.all(Array.from({ length: Math.min(4, count - base, offset + 16 - base) }, async (_, i) => {
            const partNumber = base + i + 1;
            const actual = await store.getMetadata(partKey(id, partNumber), { consistency: 'strong' });
            const expected = Math.min(partSize, session.size - (partNumber - 1) * partSize);
            return actual && actual.metadata.size === expected && /^[a-f0-9]{64}$/.test(actual.metadata.digest || '') ? { partNumber, etag: actual.metadata.digest } : null;
          }));
          for (const receipt of group) { if (!receipt) return json({ completed: false, partSize, count, verified: session.verified || 0, receipts, nextPart: offset + receipts.length, more: false }); receipts.push(receipt); }
        }
        return json({ completed: false, partSize, count, verified: session.verified || 0, receipts, nextPart: offset + receipts.length, more: offset + receipts.length < count });
      }
      if (path === '/api/media/part' && request.method === 'PUT') {
        sameOrigin(request); await owner(request);
        const id = url.searchParams.get('id'), session = await uploadSession(id), part = Number(url.searchParams.get('part'));
        const partSize = session.partSize || LEGACY_PART_SIZE;
        const count = Math.ceil(session.size / partSize);
        if (session.backend === 'r2') fail(400,'Original se prenosi izravno u pohranu.');
        if (!Number.isInteger(part) || part < 1 || part > count) fail(400, 'Neispravan dio datoteke.');
        if (await get('media/' + session.file)) fail(409, 'Datoteka je već završena.');
        const bytes = await limitedBody(request, partSize), expected = Math.min(partSize, session.size - (part - 1) * partSize);
        if (bytes.length !== expected) fail(400, 'Dio datoteke nije učitan u cijelosti.');
        const etag = await hash(bytes);
        await store.set(partKey(id, part), bytes.buffer, { metadata: { size: bytes.length, digest: etag } });
        return json({ partNumber: part, etag });
      }
      if (path === '/api/media/part-url' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        const data = await readJSON(request,4096), session = await uploadSession(data.id);
        if (session.backend !== 'r2' || !originals) fail(400,'Izravni prijenos nije aktiviran.');
        if (!Number.isInteger(data.part) || data.part < 1 || data.part > Math.ceil(session.size/session.partSize)) fail(400,'Neispravan dio originala.');
        if (await get('media/' + session.file)) fail(409,'Datoteka je već završena.');
        return json(await originals.partURL(session.objectKey,session.uploadId,data.part,data.checksum));
      }
      if (path === '/api/media/complete' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        const data = await readJSON(request, 512 * 1024), session = await uploadSession(data.id);
        if (session.backend === 'r2') {
          if (!originals) fail(503,'Pohrana originala nije povezana.');
          if (await get('media/' + session.file)) return json({url:'/media/'+session.file});
          let head = await originals.head(session.objectKey);
          const count = Math.ceil(session.size/session.partSize);
          if (!head) {
            const parts = await originals.list(session.objectKey,session.uploadId);
            if (parts.length !== count || parts.some((p,i)=>p.partNumber !== i+1 || p.size !== Math.min(session.partSize,session.size-i*session.partSize))) fail(400,'Original nije prenesen u cijelosti.');
            await originals.complete(session.objectKey,session.uploadId,parts);
            head = await originals.head(session.objectKey);
          }
          if (!head || head.size !== session.size || head.type !== session.type) fail(400,'Spremljeni original nije potvrđen.');
          await store.setJSON('media/'+session.file,{...session,count,originalBytesPreserved:true},{onlyIfNew:true});
          return json({url:'/media/'+session.file});
        }
        const partSize = session.partSize || LEGACY_PART_SIZE;
        const count = Math.ceil(session.size / partSize);
        const batched = data.offset !== undefined;
        const offset = batched ? data.offset : 0;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset >= count || !Array.isArray(data.parts) || data.parts.length < 1 || (batched ? data.parts.length > Math.min(64, count - offset) : data.parts.length !== count) || data.parts.some((p, i) => !p || p.partNumber !== offset + i + 1 || !/^[a-f0-9]{64}$/.test(p.etag || ''))) fail(400, 'Nedostaju dijelovi datoteke.');
        if (await get('media/' + session.file)) return json({ url: '/media/' + session.file });
        const sessionEntry = batched ? await entry(uploadKey(data.id)) : null;
        const verified = sessionEntry?.data.verified || 0;
        if (batched && offset > verified) fail(409, 'Nedostaje prethodni dio provjere. Pokušaj ponovno.');
        if (batched && verified >= offset + data.parts.length && verified < count) return json({ continue: true, nextPart: verified });
        for (let offset = 0; offset < data.parts.length; offset += 4) {
          await Promise.all(data.parts.slice(offset, offset + 4).map(async part => {
          const actual = await store.getMetadata(partKey(data.id, part.partNumber), { consistency: 'strong' });
          const expected = Math.min(partSize, session.size - (part.partNumber - 1) * partSize);
          if (!actual || actual.metadata.digest !== part.etag || actual.metadata.size !== expected) fail(400, 'Datoteka nije učitana u cijelosti.');
          }));
        }
        if (batched && verified < offset + data.parts.length) {
          const nextPart = offset + data.parts.length;
          const saved = await store.setJSON(uploadKey(data.id), { ...sessionEntry.data, verified: nextPart }, { onlyIfMatch: sessionEntry.etag });
          if (!saved.modified) fail(409, 'Provjera je promijenjena. Pokušaj ponovno.');
          if (nextPart < count) return json({ continue: true, nextPart });
        }
        await store.setJSON('media/' + session.file, { ...session, count }, { onlyIfNew: true });
        return json({ url: '/media/' + session.file });
      }
      if (path === '/api/media/abort' && request.method === 'POST') {
        sameOrigin(request); await owner(request);
        const data = await readJSON(request, 4096), session = await uploadSession(data.id);
        if (session.backend === 'r2') fail(409,'Izvorni dijelovi zadržani su za nastavak prijenosa.');
        if (await get('media/' + session.file)) fail(409, 'Spremljenu datoteku nije moguće izbrisati ovim postupkom.');
        for (let part = 1; part <= Math.ceil(session.size / (session.partSize || LEGACY_PART_SIZE)); part++) await store.delete(partKey(data.id, part));
        await store.delete(uploadKey(data.id));
        return json({ aborted: true });
      }
      if (path.startsWith('/media/') && ['GET', 'HEAD'].includes(request.method)) {
        if (!sourceOK(path) || !path.startsWith('/media/')) fail(404, 'Datoteka ne postoji.');
        const state = await get('state'), doc = state?.published?.document;
        const visible = doc && (doc.photos.some(p => p.src === path) || doc.videos.some(v => v.src === path));
        if (!visible) await owner(request);
        const manifest = await get('media/' + path.slice(7));
        if (!manifest) fail(404, 'Datoteka ne postoji.');
        if (manifest.backend === 'r2' && originals) {
          const key=url.searchParams.get('original')==='1'?manifest.objectKey:manifest.playback?.ready?manifest.playback.key:manifest.objectKey;
          return new Response(null,{status:307,headers:{location:await originals.signedURL(key,request.method,{},visible?21600:1800), 'cache-control':'no-store','referrer-policy':'no-referrer'}});
        }
        if (manifest.backend === 'r2' && !manifest.legacy) fail(503,'Izravna pohrana originala nije povezana.');
        // Migrated originals retain the old chunk manifest for emergency fallback.
        const storedManifest = manifest.backend === 'r2' ? manifest.legacy : manifest;
        const partSize = storedManifest.partSize || LEGACY_PART_SIZE;
        const headers = new Headers({ 'content-type': manifest.type, 'accept-ranges': 'bytes', 'cache-control': 'private,no-store', 'x-content-type-options': 'nosniff' });
        let start = 0, end = manifest.size - 1, status = 200;
        const range = request.method === 'GET' && request.headers.get('range');
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) return json({ error: 'Neispravan raspon.' }, 416, { 'content-range': 'bytes */' + manifest.size });
          if (!match[1]) start = Math.max(0, manifest.size - Number(match[2]));
          else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= manifest.size) return json({ error: 'Neispravan raspon.' }, 416, { 'content-range': 'bytes */' + manifest.size });
          // Honor the player's entire requested range. Storage chunks are only an
          // internal detail; truncating a bytes=0- response can stall playback.
          status = 206;
          headers.set('content-range', `bytes ${start}-${end}/${manifest.size}`);
        }
        headers.set('content-length', String(end - start + 1));
        if (request.method === 'HEAD') return new Response(null, { headers });
        let offset = start;
        const body = new ReadableStream({
          async pull(controller) {
            try {
              if (offset > end) { controller.close(); return; }
              const part = Math.floor(offset / partSize) + 1;
              const buffer = await get(partKey(storedManifest.id, part), 'arrayBuffer');
              if (!buffer) throw new Error('Nedostaje dio datoteke.');
              const bytes = new Uint8Array(buffer), within = offset % partSize, length = Math.min(bytes.length - within, end - offset + 1);
              if (length < 1) throw new Error('Neispravna datoteka.');
              controller.enqueue(bytes.subarray(within, within + length)); offset += length;
              if (offset > end) controller.close();
            } catch (error) { controller.error(error); }
          }
        });
        return new Response(body, { status, headers });
      }
      return json({ error: 'Postupak ne postoji.' }, 404);
    } catch (error) {
      log({ event: 'portfolio-request-error', trace, path, status: error.status || 503, uploadId: /^[a-f0-9-]{36}$/.test(url.searchParams.get('id') || '') ? url.searchParams.get('id') : undefined, part: url.searchParams.get('part'), elapsedMs: now() - startedAt, name: error.name, cause: String(error.message || '').replace(/https?:\/\/[^\s]+/g, '[URL]').replace(/Bearer\s+[^\s]+/gi, '[token]').slice(0, 500) });
      return json({ error: error.status ? error.message : 'Spremanje trenutno nije dostupno. Tvoje izmjene ostaju u otvorenoj stranici.', trace }, error.status || 503);
    }
  } };
}

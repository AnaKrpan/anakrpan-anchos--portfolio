import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/upload-tools.js', import.meta.url), 'utf8');
function load() {
  const context = vm.createContext({ crypto:globalThis.crypto, TextEncoder, Uint8Array, structuredClone, AbortController, setTimeout, clearTimeout, Map, Set });
  vm.runInContext(source, context); return context.PortfolioUploads;
}
function persistence(records = new Map()) {
  return { async get(key) { return structuredClone(records.get(key)); }, async set(key, value) { records.set(key, structuredClone(value)); }, async remove(key) { records.delete(key); }, records };
}
function transport() {
  const sessions = new Map(), index = new Map(), sends = new Map();
  let creates = 0, failPart = 0, failures = 0, loseComplete = false;
  const request = async (path, options) => {
    const url = new URL(path, 'https://test.example'), data = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : null;
    if (url.pathname.endsWith('/start')) {
      let id = index.get(data.fingerprint), resumed = !!id;
      if (!id) { id = String(++creates); index.set(data.fingerprint, id); sessions.set(id, { receipts:[],size:data.size,verified:0,done:false }); }
      return { id,partSize:512*1024,verifyBatch:8,resumed };
    }
    const id = url.searchParams.get('id') || data.id, session = sessions.get(id);
    if (url.pathname.endsWith('/part')) {
      const part = Number(url.searchParams.get('part'));
      sends.set(part, (sends.get(part) || 0) + 1);
      if (part === failPart && failures > 0) { failures--; const error = new Error('Temporary connection failure'); error.status=503; throw error; }
      session.receipts[part-1] = { partNumber:part,etag:'a'.repeat(64) }; return session.receipts[part-1];
    }
    if (url.pathname.endsWith('/status')) {
      if (session.done) return { completed:true,url:'/media/'+id+'.mp4' };
      const offset = Number(url.searchParams.get('offset')), count = Math.ceil(session.size/(512*1024));
      const receipts = session.receipts.slice(offset,offset+16).filter(Boolean);
      return { completed:false,receipts,verified:session.verified,nextPart:offset+receipts.length,more:receipts.length===16 && offset+receipts.length<count };
    }
    if (url.pathname.endsWith('/complete')) {
      if (session.done) return {url:'/media/'+id+'.mp4'};
      const count = Math.ceil(session.size/(512*1024));
      session.verified=data.offset+data.parts.length;
      if (session.verified<count) return {continue:true,nextPart:session.verified};
      session.done=true;
      if (loseComplete) { loseComplete=false; throw new Error('Final acknowledgement lost'); }
      return {url:'/media/'+id+'.mp4'};
    }
    throw new Error('Unexpected path '+path);
  };
  return { request,sends,sessions,created:()=>creates,fail:(part,count)=>{failPart=part;failures=count;},loseFinal:()=>{loseComplete=true;} };
}
const file = () => new Blob([new Uint8Array(1024*1024+20)]);
const uploader = (api, network, storage, attempts=4) => api.createUploader({request:network.request,storage,sleep:async()=>{},attempts});

test('resume survives a new browser context and persistent progress skips already acknowledged chunks', async () => {
  const network=transport(), storage=persistence(); network.fail(2,4);
  await assert.rejects(uploader(load(),network,storage).upload(file(),'video/mp4'), /Ponovno odaberi isti video/);
  assert.equal(storage.records.size,1);
  const result=await uploader(load(),network,storage).upload(file(),'video/mp4');
  assert.equal(result.url,'/media/1.mp4'); assert.equal(network.created(),1); assert.equal(network.sends.get(1),1); assert.equal(storage.records.size,0);
});

test('server index recovers an interrupted upload even if all browser progress was lost', async () => {
  const network=transport(); network.fail(2,4);
  await assert.rejects(uploader(load(),network,persistence()).upload(file(),'video/mp4'));
  const result=await uploader(load(),network,persistence()).upload(file(),'video/mp4');
  assert.equal(result.url,'/media/1.mp4'); assert.equal(network.created(),1); assert.equal(network.sends.get(1),1);
});

test('lost final response recovers completed media without sending the video again', async () => {
  const network=transport(); network.loseFinal(); const storage=persistence();
  await assert.rejects(uploader(load(),network,storage,1).upload(file(),'video/mp4'));
  assert.equal((await uploader(load(),network,storage).upload(file(),'video/mp4')).url,'/media/1.mp4');
  assert.equal(network.sends.get(1),1); assert.equal(network.sends.get(3),1);
});

test('fingerprinting reads only small samples and never reads an entire large video', async () => {
  const reads=[];
  const large={size:821*1024*1024,slice(start,end){reads.push([start,end]);return new Blob([new Uint8Array(end-start)]);},arrayBuffer(){throw new Error('Whole-file read is forbidden');}};
  assert.match(await load().fingerprint(large,'video/mp4'), /^[a-f0-9]{64}$/);
  assert.equal(reads.length,2); assert(reads.every(([start,end])=>end-start<=65536));
});

test('different files with the same size get different identities', async () => {
  const api=load();
  const a=new Blob([new Uint8Array(100)]), b=new Blob([new Uint8Array(100).fill(1)]);
  assert.notEqual(await api.fingerprint(a,'video/mp4'),await api.fingerprint(b,'video/mp4'));
});

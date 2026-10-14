import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createOriginalStorage,originalStorageConfig,ORIGINAL_PART_SIZE} from '../netlify/edge-functions/lib/original-storage.js';

const config=originalStorageConfig(name=>process.env[name]);
assert(config,'Configure the R2 runtime credentials first. Never paste secrets into chat.');
const originals=createOriginalStorage(config);
const key='originals/'+crypto.randomUUID()+'.mp4';
// This is isolated random test data, not an existing portfolio video.
const bytes=randomBytes(ORIGINAL_PART_SIZE+97);
const uploadId=await originals.start(key,'video/mp4');
for(let offset=0,part=1;offset<bytes.length;offset+=ORIGINAL_PART_SIZE,part++) {
  const body=bytes.subarray(offset,offset+ORIGINAL_PART_SIZE);
  const checksum=createHash('sha256').update(body).digest('base64');
  const signed=await originals.partURL(key,uploadId,part,checksum);
  const response=await fetch(signed.url,{method:'PUT',headers:signed.headers,body,signal:AbortSignal.timeout(120000),redirect:'error'});
  await response.body?.cancel();assert(response.ok,'Storage rejected checksum-bound original test bytes.');
  const confirmed=await originals.list(key,uploadId);assert.equal(confirmed.find(p=>p.partNumber===part)?.checksum,checksum);
}
const confirmed=await originals.list(key,uploadId);
assert.equal(confirmed.length,2);assert.equal(confirmed[0].size,ORIGINAL_PART_SIZE);assert.equal(confirmed[1].size,97);
await originals.complete(key,uploadId,confirmed);
const head=await originals.head(key);assert.equal(head.size,bytes.length);assert.equal(head.type,'video/mp4');
const download=await originals.read(key);const copied=Buffer.from(await download.arrayBuffer());
assert.equal(createHash('sha256').update(copied).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
const source=await originals.signedURL(key);
for(const [start,end] of [[0,63],[ORIGINAL_PART_SIZE-31,ORIGINAL_PART_SIZE+31],[bytes.length-64,bytes.length-1]]) {
  const response=await fetch(source,{headers:{range:'bytes='+start+'-'+end},signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes '+start+'-'+end+'/'+bytes.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(start,end+1));
}
console.log(JSON.stringify({storageReady:true,checksumVerified:true,rangeVerified:true,testBytes:bytes.length,testObject:key}));
console.log('Isolated test object retained for inspection. Existing originals and portfolio content were not modified. Browser CORS, mobile playback and migration still require separate checks.');

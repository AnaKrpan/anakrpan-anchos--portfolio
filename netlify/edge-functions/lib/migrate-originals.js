// Runs in a Node background function, never inside the Edge response stream.
// Copies only bytes. No transcoding, remuxing, deletion, or document changes.
import { createHash } from 'node:crypto';
import { ORIGINAL_PART_SIZE } from './original-storage.js';

export async function migrateOriginal({store,originals,file,now=()=>Date.now(),deadline=Infinity}) {
  const key='media/'+file;
  const before=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
  if (!before || before.data.backend === 'r2') return {alreadyMigrated:!!before};
  const old=before.data;
  if (!old.type?.startsWith('video/') || !Number.isSafeInteger(old.size) || old.size<1) throw new Error('Original manifest is not a video');
  const sourcePartSize=old.partSize || 2*1024*1024;
  const jobKey='original-migrations/'+file;
  const previous=await store.getWithMetadata(jobKey,{type:'json',consistency:'strong'});
  if (previous?.data.status === 'running' && previous.data.leaseUntil>now()) return {busy:true};
  const lease=crypto.randomUUID();
  let job={...previous?.data,status:'running',lease,leaseUntil:now()+14*60*1000};
  const acquired=await store.setJSON(jobKey,job,previous ? {onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if (!acquired.modified) return {busy:true};
  let current=await store.getWithMetadata(jobKey,{type:'json',consistency:'strong'});
  async function save(updates) {
    job={...job,...updates};
    const updated=await store.setJSON(jobKey,job,{onlyIfMatch:current.etag});
    if (!updated.modified) throw new Error('Migration lease changed');
    current=await store.getWithMetadata(jobKey,{type:'json',consistency:'strong'});
  }
  try {
    if (!job.objectKey) {
      const objectKey='originals/'+crypto.randomUUID()+'.'+file.split('.').pop();
      const uploadId=await originals.start(objectKey,old.type);
      await save({objectKey,uploadId});
    }
    let head=await originals.head(job.objectKey);
    const existing=head ? [] : await originals.list(job.objectKey,job.uploadId);
    const receipts=new Map(existing.map(part=>[part.partNumber,part]));
    const sourceHash=createHash('sha256');
    const count=Math.ceil(old.size/ORIGINAL_PART_SIZE);
    for (let part=1;part<=count;part++) {
      if (now()>deadline-60000) { await save({status:'paused',leaseUntil:0}); return {paused:true}; }
      const start=(part-1)*ORIGINAL_PART_SIZE, size=Math.min(ORIGINAL_PART_SIZE,old.size-start);
      const chunk=new Uint8Array(size);
      const first=Math.floor(start/sourcePartSize)+1, last=Math.floor((start+size-1)/sourcePartSize)+1;
      for (let base=first;base<=last;base+=4) {
        const buffers=await Promise.all(Array.from({length:Math.min(4,last-base+1)},(_,i)=>store.get('parts/'+old.id+'/'+(base+i),{type:'arrayBuffer',consistency:'strong'})));
        for (let i=0;i<buffers.length;i++) {
          const bytes=buffers[i] && new Uint8Array(buffers[i]);
          const position=(base+i-1)*sourcePartSize;
          const expected=Math.min(sourcePartSize,old.size-position);
          if (!bytes || bytes.length!==expected) throw new Error('Original source part is missing or incomplete');
          const from=Math.max(start,position),to=Math.min(start+size,position+bytes.length);
          chunk.set(bytes.subarray(from-position,to-position),from-start);
        }
      }
      sourceHash.update(chunk);
      const checksum=createHash('sha256').update(chunk).digest('base64');
      const stored=receipts.get(part);
      if (!head && (stored?.size!==size || stored?.checksum!==checksum)) {
        const signed=await originals.partURL(job.objectKey,job.uploadId,part,checksum);
        const response=await fetch(signed.url,{method:'PUT',headers:signed.headers,body:chunk,signal:AbortSignal.timeout(120000),redirect:'error'});
        const etag=response.headers.get('etag');
        await response.body?.cancel();
        if (!response.ok || !etag) throw new Error('Migration upload was not acknowledged');
        receipts.set(part,{partNumber:part,size,checksum,etag});
      }
      await save({copiedBytes:Math.min(old.size,start+size)});
    }
    const digest=sourceHash.digest('hex');
    if (!head) {
      // Trust storage's checksum-backed receipts, not just local acknowledgements.
      const confirmed=await originals.list(job.objectKey,job.uploadId);
      if (confirmed.length!==count || confirmed.some((p,i)=>p.partNumber!==i+1 || p.size!==Math.min(ORIGINAL_PART_SIZE,old.size-i*ORIGINAL_PART_SIZE) || p.checksum!==receipts.get(p.partNumber)?.checksum)) throw new Error('Migration part verification failed');
      await originals.complete(job.objectKey,job.uploadId,confirmed);
      head=await originals.head(job.objectKey);
    }
    if (!head || head.size!==old.size || head.type!==old.type) throw new Error('Migrated original metadata differs');
    const response=await originals.read(job.objectKey), reader=response.body.getReader(), copiedHash=createHash('sha256');
    let copiedBytes=0;
    try {
      for (;;) {
        if (now()>deadline-15000) { await save({status:'paused',leaseUntil:0}); return {paused:true}; }
        const {value,done}=await reader.read();
        if (done) break;
        copiedBytes+=value.length; copiedHash.update(value);
      }
    } finally { await reader.cancel().catch(()=>{}); }
    if (copiedBytes!==old.size || copiedHash.digest('hex')!==digest) throw new Error('Full original SHA-256 verification failed');
    const archive='original-manifest-history/'+file+'/'+createHash('sha256').update(before.etag).digest('hex');
    await store.setJSON(archive,old,{onlyIfNew:true});
    // Keep every old chunk and the full old manifest. References stay identical.
    const result=await store.setJSON(key,{...old,backend:'r2',objectKey:job.objectKey,originalBytesPreserved:true,sha256:digest,legacy:old},{onlyIfMatch:before.etag});
    if (!result.modified) throw new Error('Original reference changed during migration');
    await save({status:'verified',sha256:digest,leaseUntil:0});
    return {verified:true,bytes:old.size,sha256:digest};
  } catch(error) {
    await save({status:'paused',leaseUntil:0,error:'Migration paused; original source retained.'}).catch(()=>{});
    throw error;
  }
}

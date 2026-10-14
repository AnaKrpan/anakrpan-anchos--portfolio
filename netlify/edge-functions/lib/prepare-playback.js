import {createHash} from 'node:crypto';
import {boxHeader,relocateMovieBox,fastStartPrefix} from './fast-start.js';
import {ORIGINAL_PART_SIZE} from './original-storage.js';

async function digestStream(hash,response,deadline,now){
  const reader=response.body.getReader();let size=0;
  try{for(;;){if(now()>deadline-15000)throw new Error('Playback preparation deadline');const {value,done}=await reader.read();if(done)break;size+=value.length;hash.update(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return size;
}
export async function preparePlayback({store,originals,file,deadline=Infinity,now=()=>Date.now(),transport=globalThis.fetch}){
  const manifestKey='media/'+file,before=await store.getWithMetadata(manifestKey,{type:'json',consistency:'strong'}),old=before?.data;
  if(!old||old.backend!=='r2'||old.type!=='video/mp4'||old.playback?.ready)return {skipped:true};
  const jobKey='playback-preparations/'+file,previous=await store.getWithMetadata(jobKey,{type:'json',consistency:'strong'});
  if(previous?.data.status==='running'&&previous.data.leaseUntil>now())return {busy:true};
  let job={...previous?.data,status:'running',leaseUntil:now()+14*60*1000,sourceKey:old.objectKey};
  const acquired=await store.setJSON(jobKey,job,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(!acquired.modified)return {busy:true};
  let current=await store.getWithMetadata(jobKey,{type:'json',consistency:'strong'});
  async function save(update){job={...job,...update};const r=await store.setJSON(jobKey,job,{onlyIfMatch:current.etag});if(!r.modified)throw new Error('Playback preparation changed');current=await store.getWithMetadata(jobKey,{type:'json',consistency:'strong'});}
  async function bytes(start,end){const response=await originals.readRange(old.objectKey,start,end,old.size);const data=new Uint8Array(await response.arrayBuffer());if(data.length!==end-start+1)throw new Error('Truncated source range');return data;}
  async function finish(playback){
    const archive='original-manifest-history/'+file+'/'+createHash('sha256').update(before.etag).digest('hex');
    await store.setJSON(archive,old,{onlyIfNew:true});
    const r=await store.setJSON(manifestKey,{...old,playback},{onlyIfMatch:before.etag});if(!r.modified)throw new Error('Original manifest changed');
    await save({status:'verified',leaseUntil:0});return {verified:true,unchanged:!!playback.unchanged};
  }
  try{
    let pos=0,mdat=null,movie=null,unsupported=false;
    for(let count=0;pos<old.size&&count<64;count++){
      const header=boxHeader(await bytes(pos,Math.min(old.size-1,pos+31)),0,old.size-pos);
      if(header.size+pos>old.size)throw new Error('MP4 box exceeds original');
      if(header.type==='moof')unsupported=true;
      if(header.type==='mdat'&&mdat===null)mdat=pos;
      if(header.type==='moov')movie={offset:pos,size:header.size};
      pos+=header.size;
    }
    if(unsupported||!movie||mdat===null||movie.offset<mdat||movie.offset+movie.size!==old.size||movie.size>2*1024*1024||mdat>1024*1024){
      return finish({ready:true,key:old.objectKey,size:old.size,unchanged:true});
    }
    const movieBytes=await bytes(movie.offset,old.size-1),moved=relocateMovieBox(movieBytes,mdat,movie.offset);
    if(mdat+moved.length>=ORIGINAL_PART_SIZE)return finish({ready:true,key:old.objectKey,size:old.size,unchanged:true});
    const prefix=mdat?await bytes(0,mdat-1):new Uint8Array();
    const firstSize=Math.min(ORIGINAL_PART_SIZE,old.size),media=await bytes(mdat,firstSize-moved.length-1);
    const first=fastStartPrefix(prefix,moved,media);
    if(first.length!==firstSize)throw new Error('Playback prefix size differs');
    if(!job.key){const key='playback/'+crypto.randomUUID()+'.mp4',uploadId=await originals.start(key,old.type);await save({key,uploadId});}
    let head=await originals.head(job.key);
    if(!head){
      const stored=new Map((await originals.list(job.key,job.uploadId)).map(p=>[p.partNumber,p]));
      const checksum=createHash('md5').update(first).digest('base64');
      if(stored.get(1)?.checksum!==checksum){
        const grant=await originals.partURL(job.key,job.uploadId,1,checksum);
        const response=await transport(grant.url,{method:'PUT',headers:grant.headers,body:first,signal:AbortSignal.timeout(120000),redirect:'error'});
        await response.body?.cancel();if(!response.ok)throw new Error('Playback prefix upload failed');
      }
      const count=Math.ceil(old.size/ORIGINAL_PART_SIZE);
      for(let part=2;part<=count;part++){
        if(now()>deadline-60000)throw new Error('Playback preparation deadline');
        const start=(part-1)*ORIGINAL_PART_SIZE,size=Math.min(ORIGINAL_PART_SIZE,old.size-start);
        if(stored.get(part)?.size!==size)await originals.copyPart(job.key,job.uploadId,part,old.objectKey,start-moved.length,start+size-1-moved.length);
        await save({copiedBytes:start+size});
      }
      const confirmed=await originals.list(job.key,job.uploadId);
      if(confirmed.length!==count||confirmed.some((p,i)=>p.partNumber!==i+1||p.size!==Math.min(ORIGINAL_PART_SIZE,old.size-i*ORIGINAL_PART_SIZE)))throw new Error('Playback copy parts differ');
      await originals.complete(job.key,job.uploadId,confirmed);head=await originals.head(job.key);
    }
    if(!head||head.size!==old.size||head.type!==old.type)throw new Error('Playback copy size differs');
    // Compare the entire copied file with the exact lossless metadata relocation.
    const expected=createHash('sha256');expected.update(prefix);expected.update(moved);
    const sourceSize=await digestStream(expected,await originals.readRange(old.objectKey,mdat,movie.offset-1,old.size),deadline,now);
    if(prefix.length+moved.length+sourceSize!==old.size)throw new Error('Original byte count differs');
    const copied=createHash('sha256'),copiedSize=await digestStream(copied,await originals.read(job.key),deadline,now);
    const expectedHash=expected.digest('hex');
    if(copiedSize!==old.size||copied.digest('hex')!==expectedHash)throw new Error('Lossless playback copy integrity failed');
    return finish({ready:true,key:job.key,size:old.size,sha256:expectedHash,fastStart:true,lossless:true});
  }catch(error){await save({status:'paused',leaseUntil:0,error:'Preparation paused; original preserved.'}).catch(()=>{});throw error;}
}

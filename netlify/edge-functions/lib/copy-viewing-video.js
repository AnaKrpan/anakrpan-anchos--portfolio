import {createHash} from 'node:crypto';
import {ORIGINAL_PART_SIZE} from './original-storage.js';

export async function copyViewingVideo({store,originals,src,copy,origin,transport=fetch}){
  const receiptKey='viewing-copies/'+src.slice(7);
  const existing=await store.get(receiptKey,{type:'json',consistency:'strong'});
  if(existing?.sha256===copy.sha256&&existing?.size===copy.size)return existing;
  const jobKey='viewing-copy-jobs/'+src.slice(7);
  let job=await store.get(jobKey,{type:'json',consistency:'strong'});
  if(!job){
    const key='viewing/'+crypto.randomUUID()+'.mp4';
    job={key,uploadId:await originals.start(key,'video/mp4')};
    await store.setJSON(jobKey,job);
  }
  if(!await originals.head(job.key)){
    const parts=new Map((await originals.list(job.key,job.uploadId)).map(p=>[p.partNumber,p]));
    const sourceHash=createHash('sha256');
    for(let start=0,part=1;start<copy.size;start+=ORIGINAL_PART_SIZE,part++){
      const end=Math.min(copy.size-1,start+ORIGINAL_PART_SIZE-1);
      const response=await transport(new URL(copy.url,origin),{headers:{range:'bytes='+start+'-'+end},signal:AbortSignal.timeout(60000)});
      if(response.status!==206||response.headers.get('content-range')!=='bytes '+start+'-'+end+'/'+copy.size){await response.body?.cancel();throw Error('Viewing source range differs');}
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length!==end-start+1)throw Error('Viewing source truncated');
      sourceHash.update(bytes);
      const md5=createHash('md5').update(bytes).digest('base64');
      if(parts.get(part)?.checksum===md5&&parts.get(part)?.size===bytes.length)continue;
      const grant=await originals.partURL(job.key,job.uploadId,part,md5);
      const uploaded=await transport(grant.url,{method:'PUT',headers:grant.headers,body:bytes,signal:AbortSignal.timeout(60000),redirect:'error'});
      await uploaded.body?.cancel();if(!uploaded.ok)throw Error('Viewing upload failed');
    }
    if(sourceHash.digest('hex')!==copy.sha256)throw Error('Viewing source checksum differs');
    const confirmed=await originals.list(job.key,job.uploadId);
    if(confirmed.length!==Math.ceil(copy.size/ORIGINAL_PART_SIZE)||confirmed.some((p,i)=>p.partNumber!==i+1||p.size!==Math.min(ORIGINAL_PART_SIZE,copy.size-i*ORIGINAL_PART_SIZE)))throw Error('Viewing parts differ');
    await originals.complete(job.key,job.uploadId,confirmed);
  }
  const head=await originals.head(job.key);if(head?.size!==copy.size||head.type!=='video/mp4')throw Error('Viewing target size differs');
  const response=await originals.read(job.key),hash=createHash('sha256');let size=0;
  for await(const bytes of response.body){hash.update(bytes);size+=bytes.length;}
  if(size!==copy.size||hash.digest('hex')!==copy.sha256)throw Error('Viewing target checksum differs');
  const receipt={key:job.key,size:copy.size,sha256:copy.sha256,originalSize:copy.originalSize,verified:true};
  await store.setJSON(receiptKey,receipt);
  return receipt;
}

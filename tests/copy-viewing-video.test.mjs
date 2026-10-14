import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyViewingVideo} from '../netlify/edge-functions/lib/copy-viewing-video.js';

function fixture(){
  const bytes=new Uint8Array(8*1024*1024+31).fill(13),values=new Map(),parts=new Map();let object=null,uploads=0,downloads=0,interrupt=false;
  const src='/media/11111111-1111-4111-8111-111111111111.mp4';
  const copy={url:'/viewing-videos/test.mp4',size:bytes.length,originalSize:90000000,sha256:createHash('sha256').update(bytes).digest('hex')};
  values.set('state',{unchanged:'public and private documents'});values.set('media/'+src.slice(7),{objectKey:'originals/untouched.mp4'});
  const store={get:async key=>values.get(key)||null,setJSON:async(key,data)=>{values.set(key,data);}};
  const originals={start:async()=> 'upload',head:async()=>object?{size:object.length,type:'video/mp4'}:null,list:async()=>[...parts.values()].map(({bytes,...p})=>p),partURL:async(key,id,part,checksum)=>({url:'https://storage.test/'+part,headers:{'content-md5':checksum}}),complete:async()=>{object=Buffer.concat([...parts.values()].map(p=>p.bytes));},read:async()=>new Response(object)};
  const transport=async(url,options)=>{
    if(new URL(url).hostname==='site.test'){
      downloads++;const match=options.headers.range.match(/bytes=(\d+)-(\d+)/),start=Number(match[1]),end=Number(match[2]);
      return new Response(bytes.slice(start,end+1),{status:206,headers:{'content-range':'bytes '+start+'-'+end+'/'+bytes.length}});
    }
    const part=Number(new URL(url).pathname.slice(1));if(part===2&&interrupt)throw Error('Interrupted');uploads++;
    const chunk=Buffer.from(options.body),checksum=createHash('md5').update(chunk).digest('base64');assert.equal(checksum,options.headers['content-md5']);
    parts.set(part,{partNumber:part,size:chunk.length,checksum,etag:'"'+'a'.repeat(32)+'"',bytes:chunk});return new Response(null,{status:200});
  };
  return {store,originals,src,copy,origin:'https://site.test',transport,values,bytes,get object(){return object;},get uploads(){return uploads;},get downloads(){return downloads;},set interrupt(x){interrupt=x;}};
}
test('viewing migration preserves exact bytes and original/public/private state; verified rerun transfers nothing',async()=>{
  const f=fixture(),receipt=await copyViewingVideo(f);assert.equal(receipt.sha256,f.copy.sha256);assert.deepEqual(new Uint8Array(f.object),f.bytes);
  assert.deepEqual(f.values.get('state'),{unchanged:'public and private documents'});assert.equal(f.values.get('media/'+f.src.slice(7)).objectKey,'originals/untouched.mp4');
  const downloads=f.downloads;await copyViewingVideo(f);assert.equal(f.downloads,downloads);assert.equal(f.uploads,2);
});
test('interrupted viewing copy resumes confirmed parts without switching public playback prematurely',async()=>{
  const f=fixture();f.interrupt=true;await assert.rejects(copyViewingVideo(f),/Interrupted/);assert(!f.values.has('viewing-copies/'+f.src.slice(7)));
  f.interrupt=false;await copyViewingVideo(f);assert.equal(f.uploads,2);assert.deepEqual(new Uint8Array(f.object),f.bytes);
});
test('checksum mismatch never publishes a viewing receipt',async()=>{
  const f=fixture();f.copy.sha256='b'.repeat(64);await assert.rejects(copyViewingVideo(f),/checksum differs/);assert(!f.values.has('viewing-copies/'+f.src.slice(7)));assert.equal(f.object,null);
});

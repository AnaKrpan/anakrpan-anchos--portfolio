import test from 'node:test';
import assert from 'node:assert/strict';
import { getStore } from '@netlify/blobs';

test('installed Netlify SDK honors actual conditional request headers and closes unused responses', async () => {
  const objects=new Map(); let serial=0,cancelled=0;
  const discardedResponse=(status,headers={})=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('unused response'));},cancel(){cancelled++;}}),{status,headers});
  const transport=async (input,options={})=>{
    const url=new URL(input), headers=new Headers(options.headers), method=options.method||'GET';
    const key=url.pathname.includes('/object/') ? decodeURIComponent(url.pathname.split('/object/')[1]) : url.pathname.split('/sdk-test/')[1];
    if(headers.get('accept')?.includes('type=signed-url'))return Response.json({url:'https://objects.invalid/object/'+encodeURIComponent(key)});
    const old=objects.get(key);
    if(method==='PUT'){
      if(headers.get('if-none-match')==='*'&&old||headers.has('if-match')&&headers.get('if-match')!==old?.etag)return discardedResponse(412);
      const etag='"version-'+ ++serial+'"'; objects.set(key,{content:String(options.body),etag}); return discardedResponse(200,{etag});
    }
    if(!old)return discardedResponse(404);
    if(method==='HEAD')return new Response(null,{headers:{etag:old.etag}});
    return new Response(old.content,{headers:{etag:old.etag}});
  };
  const store=getStore({name:'sdk-test',siteID:'fixture-site',token:'fixture-only',apiURL:'https://api.invalid',fetch:transport});
  const first=await store.setJSON('state',{version:1},{onlyIfNew:true}); assert.equal(first.modified,true);
  assert.equal((await store.setJSON('state',{version:2},{onlyIfNew:true})).modified,false);
  assert.equal((await store.setJSON('state',{version:2},{onlyIfMatch:'"wrong"'})).modified,false);
  const changed=await store.setJSON('state',{version:2},{onlyIfMatch:first.etag}); assert.equal(changed.modified,true);
  assert.deepEqual(await store.get('state',{type:'json'}),{version:2});
  assert.equal(await store.get('missing'),null);
  assert.equal(cancelled,5);
});

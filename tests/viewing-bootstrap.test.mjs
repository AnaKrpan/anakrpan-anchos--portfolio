import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';

test('public health checks start one signed preparation, then stop permanently after verification',async()=>{
  const values=new Map();let count=0,etag=0;
  const store={getMetadata:async()=>({}),get:async key=>values.get(key)?.data||null,getWithMetadata:async key=>values.get(key)||null,setJSON:async(key,data,options={})=>{const old=values.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};values.set(key,{data,etag:String(++etag)});return {modified:true};}};
  const app=createPortfolio({store,initialDocument,password:'test-password-long-enough',originals:{},migrationEnabled:true,viewingCopies:{'/media/test.mp4':{}},dispatch:async(url,options)=>{count++;assert.equal(url,'https://site.test/.netlify/functions/viewing-copies-background');assert.match(options.headers['x-anchos-signature'],/^[a-f0-9]{64}$/);return new Response(null,{status:202});}});
  const health=()=>app.fetch(new Request('https://site.test/api/health'));
  await health();await health();await health();assert.equal(count,1);
  await store.setJSON('viewing-copy-bootstrap/v1',{status:'verified',retryAt:0});
  assert.equal((await(await health()).json()).viewingCopiesReady,true);assert.equal(count,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';
import {viewingBootstrapKey} from '../netlify/edge-functions/lib/viewing-bootstrap-key.js';

test('public health checks start one signed preparation, then stop permanently after verification',async()=>{
  const values=new Map();let count=0,etag=0;
  const store={getMetadata:async()=>({}),get:async key=>values.get(key)?.data||null,getWithMetadata:async key=>values.get(key)||null,setJSON:async(key,data,options={})=>{const old=values.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};values.set(key,{data,etag:String(++etag)});return {modified:true};}};
  const app=createPortfolio({store,initialDocument,password:'test-password-long-enough',originals:{},migrationEnabled:true,viewingCopies:{'/media/test.mp4':{}},dispatch:async(url,options)=>{count++;assert.equal(url,'https://site.test/.netlify/functions/viewing-copies-background');assert.match(options.headers['x-anchos-signature'],/^[a-f0-9]{64}$/);return new Response(null,{status:202});}});
  const health=()=>app.fetch(new Request('https://site.test/api/health'));
  await health();await health();await health();assert.equal(count,1);
  await store.setJSON(await viewingBootstrapKey({'/media/test.mp4':{}}),{status:'verified',retryAt:0});
  assert.equal((await(await health()).json()).viewingCopiesReady,true);assert.equal(count,1);
});

test('new playback copies get their own preparation after original migration has been disabled',async()=>{
  const oldCopies={'/media/old.mp4':{sha256:'old',size:10}},newCopies={...oldCopies,'/media/new.mp4':{sha256:'new',size:20}};
  const oldKey=await viewingBootstrapKey(oldCopies),newKey=await viewingBootstrapKey(newCopies);
  assert.notEqual(oldKey,newKey);assert.equal(await viewingBootstrapKey(Object.fromEntries(Object.entries(newCopies).reverse())),newKey);
  const values=new Map([[oldKey,{data:{status:'verified'},etag:'old'}]]);let count=0;
  const store={getMetadata:async()=>({}),get:async k=>values.get(k)?.data||null,getWithMetadata:async k=>values.get(k)||null,setJSON:async(k,data)=>{values.set(k,{data,etag:'new'});return {modified:true};}};
  const app=createPortfolio({store,initialDocument,password:'test-password-long-enough',originals:{},migrationEnabled:false,viewingCopiesEnabled:true,viewingCopies:newCopies,dispatch:async()=>{count++;return new Response(null,{status:202});}});
  await app.fetch(new Request('https://site.test/api/health'));assert.equal(count,1);
  assert.equal(values.get(oldKey).data.status,'verified');
  await store.setJSON(newKey,{status:'verified'});
  const health=await app.fetch(new Request('https://site.test/api/health'));assert.equal((await health.json()).viewingCopiesReady,true);assert.equal(count,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';

test('public viewing copy keeps raw original route and private drafts protected',async()=>{
  const file='11111111-1111-4111-8111-111111111111.mp4',src='/media/'+file;
  const document=structuredClone(initialDocument);document.videos[0].src=src;
  const state={published:{document},draft:{document:structuredClone(document)}};
  const manifest={backend:'r2',size:1000,objectKey:'originals/'+file,type:'video/mp4'};
  const store={get:async key=>key==='state'?state:key==='media/'+file?manifest:null};
  const originals={signedURL:async key=>'https://storage.test/'+key};
  const viewingCopies={[src]:{originalSize:1000,url:'/viewing-videos/mobile.mp4'}};
  const app=createPortfolio({store,initialDocument,originals,viewingCopies,password:'test-password-long-enough',log:()=>{}});
  const get=path=>app.fetch(new Request('https://site.test'+path));
  assert.equal((await get(src)).headers.get('location'),'https://site.test/viewing-videos/mobile.mp4');
  assert.equal((await get(src+'?original=1')).headers.get('location'),'https://storage.test/originals/'+file);
  manifest.size=1001;
  assert.equal((await get(src)).headers.get('location'),'https://storage.test/originals/'+file);
  manifest.size=1000;state.published.document.videos[0].src='';
  assert.equal((await get(src)).status,401);
  assert.equal((await get('/api/draft')).status,401);
  assert.equal(manifest.objectKey,'originals/'+file);
});

test('verified R2 viewing copy takes precedence and raw original stays unchanged',async()=>{
  const file='11111111-1111-4111-8111-111111111111.mp4',src='/media/'+file,document=structuredClone(initialDocument);
  document.videos[0].src=src;
  const copy={originalSize:1000,size:100,sha256:'a'.repeat(64),url:'/viewing-videos/mobile.mp4'};
  const receipt={verified:true,originalSize:1000,size:100,sha256:copy.sha256,key:'viewing/'+file};
  const store={get:async key=>key==='state'?{published:{document}}:key==='media/'+file?{backend:'r2',size:1000,objectKey:'originals/'+file}:key==='viewing-copies/'+file?receipt:null};
  const app=createPortfolio({store,initialDocument,viewingCopies:{[src]:copy},originals:{signedURL:async key=>'https://r2.test/'+key},password:'test-password-long-enough'});
  assert.equal((await app.fetch(new Request('https://site.test'+src))).headers.get('location'),'https://r2.test/viewing/'+file);
  assert.equal((await app.fetch(new Request('https://site.test'+src+'?original=1'))).headers.get('location'),'https://r2.test/originals/'+file);
  receipt.sha256='b'.repeat(64);
  assert.equal((await app.fetch(new Request('https://site.test'+src))).headers.get('location'),'https://site.test/viewing-videos/mobile.mp4');
});

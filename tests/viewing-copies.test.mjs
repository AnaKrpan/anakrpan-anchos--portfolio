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

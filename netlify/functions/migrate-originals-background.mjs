import {getStore} from '@netlify/blobs';
import {createOriginalStorage,originalStorageConfig} from '../edge-functions/lib/original-storage.js';
import {migrateOriginal} from '../edge-functions/lib/migrate-originals.js';
import {preparePlayback} from '../edge-functions/lib/prepare-playback.js';
import copies from '../edge-functions/lib/viewing-copies.js';

export default async function handler(request) {
  const password=process.env.PORTFOLIO_PASSWORD || '';
  if (password.length<16 || process.env.ORIGINAL_VIDEO_MIGRATION==='disabled') return new Response(null,{status:403});
  const signature=request.headers.get('x-anchos-signature');
  if (!/^[a-f0-9]{64}$/.test(signature || '')) return new Response(null,{status:403});
  const body=await request.text();
  if (body.length>4096) return new Response(null,{status:400});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode('original-migration:'+body));
  if (!valid) return new Response(null,{status:403});
  const payload=JSON.parse(body);
  if (!Number.isSafeInteger(payload.expires) || payload.expires<Date.now() || payload.expires>Date.now()+300000 || !/^[a-f0-9-]{36}$/.test(payload.nonce || '')) return new Response(null,{status:403});
  const config=originalStorageConfig(name=>process.env[name]);
  if (!config) return new Response(null,{status:503});
  const store=getStore('anchos-portfolio-v1');
  const consumed=await store.setJSON('original-migration-requests/'+payload.nonce,{at:Date.now()},{onlyIfNew:true});
  if (!consumed.modified) return new Response(null,{status:200});
  const snapshot=await store.getWithMetadata('state',{type:'json',consistency:'strong'});
  if (!snapshot) return new Response(null,{status:200});
  // Private drafts are archived in the existing private Blob store as well.
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshot.etag)));
  const hash=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
  await store.setJSON('history/'+hash,snapshot.data,{onlyIfNew:true});
  const files=new Set([...(snapshot.data.draft?.document?.videos || []),...(snapshot.data.published?.document?.videos || [])].map(v=>v.src).filter(src=>/^\/media\/[a-f0-9-]{36}\.(mp4|mov|m4v|webm|ogv)$/.test(src)).map(src=>src.slice(7)));
  const originals=createOriginalStorage(config);
  const deadline=Date.now()+13*60*1000;
  for (const file of files) {
    if(copies['/media/'+file])continue;
    if (Date.now()>deadline-60000) break;
    try { await migrateOriginal({store,originals,file,deadline}); await preparePlayback({store,originals,file,deadline}); }
    catch { console.error(JSON.stringify({event:'original-migration-paused',file,sourceRetained:true})); }
  }
  return new Response(null,{status:200});
}

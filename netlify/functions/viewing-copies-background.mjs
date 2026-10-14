import {getStore} from '@netlify/blobs';
import copies from '../edge-functions/lib/viewing-copies.js';
import {createOriginalStorage,originalStorageConfig} from '../edge-functions/lib/original-storage.js';
import {copyViewingVideo} from '../edge-functions/lib/copy-viewing-video.js';

export default async function handler(request){
  const password=process.env.PORTFOLIO_PASSWORD||'',signature=request.headers.get('x-anchos-signature')||'';
  if(password.length<16||!/^[a-f0-9]{64}$/.test(signature))return new Response(null,{status:403});
  const body=await request.text();if(body.length>4096)return new Response(null,{status:400});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode('viewing-copies:'+body)))return new Response(null,{status:403});
  const payload=JSON.parse(body);
  if(!Number.isSafeInteger(payload.expires)||payload.expires<Date.now()||payload.expires>Date.now()+300000||!/^[a-f0-9-]{36}$/.test(payload.nonce||''))return new Response(null,{status:403});
  const store=getStore('anchos-portfolio-v1');
  const consumed=await store.setJSON('viewing-copy-requests/'+payload.nonce,{at:Date.now()},{onlyIfNew:true});if(!consumed.modified)return new Response(null,{status:200});
  const config=originalStorageConfig(n=>process.env[n]);if(!config)return new Response(null,{status:503});
  const originals=createOriginalStorage(config);
  try{
    for(const [src,copy] of Object.entries(copies))await copyViewingVideo({store,originals,src,copy,origin:'https://anakrpan-anchos-potrfolio.netlify.app'});
    await store.setJSON('viewing-copy-bootstrap/v1',{status:'verified',retryAt:0});
  }catch{
    await store.setJSON('viewing-copy-bootstrap/v1',{status:'paused',retryAt:Date.now()+6*60*60*1000});
    console.error('Viewing copy preparation paused; originals and current public playback preserved.');
  }
  return new Response(null,{status:200});
}

import { getStore } from '@netlify/blobs';
import { createPortfolio } from './lib/server.js';
import initialDocument from './lib/initial-document.js';
import {originalStorageConfig,createOriginalStorage} from './lib/original-storage.js';
import {previewStore} from './lib/preview-store.js';

export default async function handler(request, context) {
  const password = Netlify.env.get('PORTFOLIO_PASSWORD') || '';
  const sandbox=new URL(request.url).hostname!=='anakrpan-anchos-potrfolio.netlify.app';
  const primary=getStore('anchos-portfolio-v1');
  const store=sandbox?await previewStore(primary,getStore('anchos-projects-review-v1')):primary;
  // Review uploads stay isolated and do not require changing R2 CORS or secrets.
  const publicMedia=sandbox?store.publicMediaURL(new URL(request.url).pathname):null;
  if(publicMedia&&['GET','HEAD'].includes(request.method))return new Response(null,{status:307,headers:{location:publicMedia,'cache-control':'no-store'}});
  const config = sandbox?null:originalStorageConfig(name=>Netlify.env.get(name));
  const originals = config ? createOriginalStorage(config) : null;
  // Only the existing production host starts copying old originals by default.
  // Previews stay disabled; the operator can explicitly disable migration.
  const migrationEnabled=!!originals && new URL(request.url).hostname==='anakrpan-anchos-potrfolio.netlify.app' && Netlify.env.get('ORIGINAL_VIDEO_MIGRATION') !== 'disabled';
  return createPortfolio({ store, password, initialDocument, originals, migrationEnabled,projectsEnabled:true,directUploads:!sandbox,sandbox }).fetch(request, context);
}

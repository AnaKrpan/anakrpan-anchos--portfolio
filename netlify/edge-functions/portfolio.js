import { getStore } from '@netlify/blobs';
import { createPortfolio } from './lib/server.js';
import initialDocument from './lib/initial-document.js';
import {originalStorageConfig,createOriginalStorage} from './lib/original-storage.js';

export default async function handler(request, context) {
  const password = Netlify.env.get('PORTFOLIO_PASSWORD') || '';
  const store = getStore('anchos-portfolio-v1');
  const config = originalStorageConfig(name=>Netlify.env.get(name));
  const originals = config ? createOriginalStorage(config) : null;
  const migrationEnabled=Netlify.env.get('ORIGINAL_VIDEO_MIGRATION') === 'enabled';
  return createPortfolio({ store, password, initialDocument, originals, migrationEnabled }).fetch(request, context);
}

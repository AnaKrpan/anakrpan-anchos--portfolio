import { getStore } from '@netlify/blobs';
import { createPortfolio } from './lib/server.js';
import initialDocument from './lib/initial-document.js';

export default async function handler(request, context) {
  const password = Netlify.env.get('PORTFOLIO_PASSWORD') || '';
  const store = getStore('anchos-portfolio-v1');
  return createPortfolio({ store, password, initialDocument }).fetch(request, context);
}

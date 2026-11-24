export async function viewingBootstrapKey(copies){
  const entries=Object.entries(copies).sort(([a],[b])=>a.localeCompare(b)).map(([src,c])=>[src,c.sha256,c.size]);
  const bytes=new TextEncoder().encode(JSON.stringify(entries));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return 'viewing-copy-bootstrap/'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

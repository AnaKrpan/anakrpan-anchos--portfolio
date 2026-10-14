// R2 uses the S3 API. The vendored signer is unmodified aws4fetch v1.0.20 (MIT).
import { AwsClient } from './vendor/aws4fetch.js';

export const ORIGINAL_PART_SIZE = 8 * 1024 * 1024;
const safeKey = key => typeof key === 'string' && /^originals\/[a-f0-9-]{36}\.(mp4|mov|m4v|webm|ogv)$/.test(key);
const escapeXML = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const unescapeXML = text => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, c) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[c]));
const field = (xml, name) => { const value = xml.match(new RegExp('<'+name+'>([^<]*)</'+name+'>')); return value ? unescapeXML(value[1]) : null; };
const storageError = (message, status=503) => Object.assign(new Error(message), {status});

export function originalStorageConfig(read) {
  const enabled = read('ORIGINAL_VIDEO_STORAGE') === 'r2';
  const accountId = read('R2_ACCOUNT_ID'), bucket = read('R2_BUCKET'), accessKeyId = read('R2_ACCESS_KEY_ID'), secretAccessKey = read('R2_SECRET_ACCESS_KEY');
  if (!enabled) return null;
  if (!/^[a-f0-9]{32}$/.test(accountId || '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '') || !accessKeyId || !secretAccessKey) throw storageError('Pohrana originalnih videa još nije potpuno povezana.');
  return {accountId,bucket,accessKeyId,secretAccessKey};
}

export function createOriginalStorage(config, {fetch: transport = globalThis.fetch, now = () => new Date()} = {}) {
  const client = new AwsClient({...config,service:'s3',region:'auto',retries:0});
  const endpoint = 'https://' + config.accountId + '.r2.cloudflarestorage.com/' + config.bucket + '/';
  const datetime = () => now().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const url = (key, query={}) => {
    if (!safeKey(key)) throw storageError('Neispravna putanja originala.',400);
    const result = new URL(endpoint + key);
    for (const [name,value] of Object.entries(query)) result.searchParams.set(name,String(value));
    return result;
  };
  async function signedURL(key, method='GET', query={}, expires=1800, headers={}) {
    const target = url(key,{...query,'X-Amz-Expires':expires});
    const request = await client.sign(target,{method,headers,aws:{signQuery:true,datetime:datetime(),allHeaders:true}});
    return request.url;
  }
  async function send(key, method, query={}, {headers={},body,notFound=false,timeout=25000}={}) {
    const request = await client.sign(url(key,query),{method,headers,body,aws:{datetime:datetime()}});
    const response = await transport(request,{signal:AbortSignal.timeout(timeout),redirect:'error'});
    if (notFound && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw storageError('Pohrana originala nije odgovorila ('+response.status+').',response.status >= 500 ? 503 : 502); }
    return response;
  }
  return {
    signedURL,
    async start(key,type) {
      const response = await send(key,'POST',{uploads:''},{headers:{'content-type':type,'cache-control':'private,max-age=1800','x-amz-checksum-algorithm':'SHA256'}});
      const uploadId = field(await response.text(),'UploadId');
      if (!uploadId || uploadId.length > 2048) throw storageError('Nedostaje potvrda početka pohrane.');
      return uploadId;
    },
    async list(key,uploadId) {
      const receipts=[];
      let marker=0;
      for (let page=0;page<20;page++) {
        const response = await send(key,'GET',{uploadId,'part-number-marker':marker});
        const xml=await response.text();
        for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
          const partNumber=Number(field(match[1],'PartNumber')), size=Number(field(match[1],'Size')), etag=field(match[1],'ETag');
          if (!Number.isInteger(partNumber) || partNumber<1 || !Number.isSafeInteger(size) || size<1 || !/^"?[a-f0-9]{32}(?:-\d+)?"?$/.test(etag || '')) throw storageError('Neispravna potvrda spremljenog dijela.');
          const checksum=field(match[1],'ChecksumSHA256');
          if (!/^[A-Za-z0-9+/]{43}=$/.test(checksum || '')) throw storageError('Nedostaje potvrda izvornih bajtova.');
          receipts.push({partNumber,size,etag,checksum});
        }
        if (field(xml,'IsTruncated') !== 'true') return receipts.sort((a,b)=>a.partNumber-b.partNumber);
        const next=Number(field(xml,'NextPartNumberMarker'));
        if (!Number.isInteger(next) || next<=marker) throw storageError('Nastavak provjere nije potvrđen.');
        marker=next;
      }
      throw storageError('Previše dijelova originala.');
    },
    async partURL(key,uploadId,partNumber,checksum) {
      if (!Number.isInteger(partNumber) || partNumber < 1 || !/^[A-Za-z0-9+/]{43}=$/.test(checksum || '')) throw storageError('Nedostaje provjera originalnih bajtova.',400);
      const headers={'x-amz-checksum-sha256':checksum};
      return {url:await signedURL(key,'PUT',{uploadId,partNumber},1800,headers),headers};
    },
    async complete(key,uploadId,receipts) {
      const body='<CompleteMultipartUpload>'+receipts.map(part=>'<Part><PartNumber>'+part.partNumber+'</PartNumber><ETag>'+escapeXML(part.etag)+'</ETag><ChecksumSHA256>'+escapeXML(part.checksum)+'</ChecksumSHA256></Part>').join('')+'</CompleteMultipartUpload>';
      const response=await send(key,'POST',{uploadId},{headers:{'content-type':'application/xml'},body});
      const xml=await response.text();
      // S3 can return a completion error with HTTP 200.
      if (!field(xml,'ETag') || /<Error>/.test(xml)) throw storageError('Original nije potvrđen nakon završetka.');
    },
    async head(key) {
      const response=await send(key,'HEAD',{}, {notFound:true});
      if (!response) return null;
      const result={size:Number(response.headers.get('content-length')),type:response.headers.get('content-type'),etag:response.headers.get('etag')};
      await response.body?.cancel();
      return result;
    },
    async read(key) { return send(key,'GET',{}, {timeout:180000}); }
  };
}

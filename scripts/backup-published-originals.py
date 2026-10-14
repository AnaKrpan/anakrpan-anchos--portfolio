"""Read-only backup of the published portfolio and byte-identical original media."""
import concurrent.futures, hashlib, json, os, pathlib, time, urllib.request

ORIGIN = 'https://anakrpan-anchos-potrfolio.netlify.app'
OUT = pathlib.Path('portfolio-backup')
OUT.mkdir(exist_ok=True)

def request(path, headers=None):
    return urllib.request.urlopen(urllib.request.Request(ORIGIN + path, headers=headers or {}), timeout=90)

with request('/api/content') as response:
    content_bytes = response.read()
(OUT / 'published-content.json').write_bytes(content_bytes)
content = json.loads(content_bytes)
sources = sorted(set(x['src'] for x in content['document']['photos'] + content['document']['videos'] if x.get('src')))
records = []
for source in sources:
    if source.startswith('/media/'):
        with request(source, {'Range': 'bytes=0-0'}) as response:
            if response.status != 206:
                raise RuntimeError('Original does not support verified byte ranges')
            size = int(response.headers['Content-Range'].split('/')[-1])
            if len(response.read()) != 1:
                raise RuntimeError('Unexpected first byte length')
        target = OUT / source.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('wb') as output:
            output.truncate(size)
        block = 4 * 1024 * 1024
        def part(start):
            end = min(size - 1, start + block - 1)
            for attempt in range(5):
                try:
                    with request(source, {'Range': f'bytes={start}-{end}'}) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                            raise RuntimeError('Unexpected content range')
                        data = response.read(end - start + 2)
                        if len(data) != end - start + 1:
                            raise RuntimeError('Incomplete original range')
                    with target.open('r+b', buffering=0) as output:
                        output.seek(start)
                        output.write(data)
                    return len(data)
                except Exception:
                    if attempt == 4:
                        raise
                    time.sleep(min(16, 2 ** attempt))
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for count in pool.map(part, range(0, size, block)):
                completed += count
        if completed != size or target.stat().st_size != size:
            raise RuntimeError('Backup length mismatch')
    else:
        target = OUT / source.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        with request('/' + source.lstrip('/')) as response:
            target.write_bytes(response.read())
    digest = hashlib.file_digest(target.open('rb'), 'sha256').hexdigest()
    records.append({'source': source, 'file': str(target.relative_to(OUT)), 'bytes': target.stat().st_size, 'sha256': digest})
    print('BACKUP_ORIGINAL', json.dumps({'source': source, 'bytes': target.stat().st_size, 'sha256': digest}), flush=True)
(OUT / 'manifest.json').write_text(json.dumps({'origin': ORIGIN, 'publishedRevision': content.get('revision'), 'files': records}, indent=2))
(OUT / 'README.txt').write_text('Byte-identical public media and published content snapshot. SHA-256 hashes are listed in manifest.json. This does not include private drafts or unreferenced uploads. Code and design are separately preserved on the GitHub backup branch. GitHub artifacts expire: download this archive for permanent safekeeping. No originals were deleted or replaced.\n')
print('BACKUP_COMPLETE', len(records), flush=True)

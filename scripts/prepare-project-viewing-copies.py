"""Create separate playback copies of published project videos; preserve all originals."""
import hashlib, json, pathlib, re, subprocess, tempfile, urllib.request

origin = 'https://anakrpan-anchos-potrfolio.netlify.app'
manifest = pathlib.Path('netlify/edge-functions/lib/viewing-copies.js')
copies = json.loads(manifest.read_text().removeprefix('export default ').strip().removesuffix(';'))
with urllib.request.urlopen(origin+'/api/content', timeout=60) as response:
    document = json.load(response)['document']
published = {v['src'] for p in document['projects'] if p['status']=='published' for v in p['videos'] if v.get('src')}
output = pathlib.Path('public/viewing-videos')
output.mkdir(parents=True, exist_ok=True)
for src in sorted(published):
    if src in copies or not re.fullmatch(r'/media/[a-f0-9-]{36}\.(mp4|mov|m4v|webm)', src):
        continue
    target = output/(src.split('/')[-1].rsplit('.', 1)[0]+'-watch-v1.mp4')
    if target.exists():
        raise RuntimeError('Refusing to overwrite an existing viewing asset')
    with tempfile.TemporaryDirectory() as temp:
        original = pathlib.Path(temp)/'original'
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(origin+src+'?original=1', timeout=180) as response, original.open('wb') as handle:
            while block := response.read(4*1024*1024):
                size += len(block)
                if size > 2*1024**3:
                    raise RuntimeError('Unexpected original size')
                digest.update(block)
                handle.write(block)
        probe = lambda path: json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
        source = probe(original)
        stream = next(s for s in source['streams'] if s['codec_type']=='video')
        if stream.get('color_transfer') in ('smpte2084','arib-std-b67'):
            raise RuntimeError('HDR requires a separately reviewed colour conversion; original preserved')
        args = ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i',str(original),'-map','0:v:0','-map','0:a:0?','-map_metadata','-1']
        remux = stream['codec_name']=='h264' and stream.get('pix_fmt')=='yuv420p' and stream['width']<=1080 and stream['height']<=1920 and int(source['format'].get('bit_rate',0))<=4500000
        if remux:
            args += ['-c','copy']
        else:
            args += ['-vf',"scale=w='min(1080,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",'-c:v','libx264','-threads','2','-preset','medium','-crf','20','-profile:v','high','-level:v','4.1','-pix_fmt','yuv420p','-maxrate','4M','-bufsize','8M']
            audio = next((s for s in source['streams'] if s['codec_type']=='audio'), None)
            args += ['-c:a','copy'] if not audio or audio['codec_name']=='aac' else ['-c:a','aac','-b:a','160k']
        subprocess.run(args+['-movflags','+faststart',str(target)],check=True,timeout=1800)
        info = probe(target)
        video = next(s for s in info['streams'] if s['codec_type']=='video')
        assert video['codec_name']=='h264' and video['pix_fmt']=='yuv420p'
        assert video['width']<=1080 and video['height']<=1920
        assert abs(video['width']/video['height']-stream['width']/stream['height'])<0.002
        assert abs(float(info['format']['duration'])-float(source['format']['duration']))<0.2
        assert 0<target.stat().st_size<95*1024*1024
        with target.open('rb') as handle:
            head=handle.read(262144)
        assert 0<head.find(b'moov')<head.find(b'mdat')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-xerror','-i',str(target),'-map','0:v:0','-map','0:a:0?','-f','null','-'],check=True,timeout=300)
        copies[src]={'url':'/viewing-videos/'+target.name,'originalSize':size,'originalSHA256':digest.hexdigest(),'size':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'width':video['width'],'height':video['height'],'fps':video['avg_frame_rate'],'mode':'lossless-faststart' if remux else '1080p-playback'}
        print(json.dumps({'source':src,'originalBytes':size,'viewingBytes':target.stat().st_size,'duration':info['format']['duration'],'mode':copies[src]['mode'],'decode':'passed'}),flush=True)
manifest.write_text('export default '+json.dumps(copies,indent=2)+';\n')
(output/'verification.json').write_text(json.dumps(copies,indent=2)+'\n')

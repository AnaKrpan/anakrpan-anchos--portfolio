"""Create viewing copies of published videos only; never overwrite originals."""
import hashlib, json, pathlib, subprocess, tempfile, urllib.request, re

origin = 'https://anakrpan-anchos-potrfolio.netlify.app'
with urllib.request.urlopen(origin+'/api/content', timeout=60) as r:
    document = json.load(r)['document']
output = pathlib.Path('public/viewing-videos')
output.mkdir(parents=True, exist_ok=True)
copies = {}
for video in document['videos']:
    src = video.get('src', '')
    if not re.fullmatch(r'/media/[a-f0-9-]{36}\.(mp4|mov|m4v|webm|ogv)', src):
        continue
    name = src.rsplit('/',1)[-1].rsplit('.',1)[0]
    target = output/(name+'.mp4')
    with tempfile.TemporaryDirectory() as temp:
        original = pathlib.Path(temp)/'original'
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(origin+src+'?original=1', timeout=180) as r, original.open('wb') as f:
            while block := r.read(4*1024*1024):
                size += len(block)
                if size > 2*1024**3:
                    raise RuntimeError('Unexpected original size')
                digest.update(block)
                f.write(block)
        source_info = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(original)]))
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i',str(original),'-map','0:v:0','-map','0:a:0?','-map_metadata','-1','-vf',"scale=w='min(1080,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",'-c:v','libx264','-preset','fast','-crf','23','-profile:v','high','-level:v','4.1','-pix_fmt','yuv420p','-maxrate','4M','-bufsize','8M','-c:a','aac','-b:a','128k','-movflags','+faststart',str(target)],check=True,timeout=1800)
        info = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(target)]))
        stream = next(s for s in info['streams'] if s['codec_type']=='video')
        assert stream['codec_name']=='h264' and stream['pix_fmt']=='yuv420p'
        assert stream['width']<=1080 and stream['height']<=1920
        assert abs(float(info['format']['duration'])-float(source_info['format']['duration']))<0.2
        assert 0<target.stat().st_size<95*1024*1024 and target.stat().st_size<size
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-xerror','-i',str(target),'-map','0:v:0','-map','0:a:0?','-f','null','-'],check=True,timeout=300)
        # Metadata must precede the large media payload for immediate playback.
        head=target.read_bytes()[:262144]
        assert 0<head.find(b'moov')<head.find(b'mdat')
        copies[src]={'url':'/viewing-videos/'+target.name,'originalSize':size,'originalSHA256':digest.hexdigest(),'size':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'width':stream['width'],'height':stream['height'],'fps':30}
        print(json.dumps({'slot':video.get('slot'),'originalBytes':size,'viewingBytes':target.stat().st_size,'duration':info['format']['duration'],'decode':'passed'}),flush=True)
pathlib.Path('netlify/edge-functions/lib/viewing-copies.js').write_text('export default '+json.dumps(copies,indent=2)+';\n')
pathlib.Path('public/viewing-videos/verification.json').write_text(json.dumps(copies,indent=2)+'\n')

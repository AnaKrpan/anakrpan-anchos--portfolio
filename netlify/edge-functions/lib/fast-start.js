// Lossless MP4 metadata relocation. Original media bytes are never re-encoded.
export function boxHeader(bytes,offset=0,limit=bytes.length) {
  if(offset+8>bytes.length)throw new Error('Truncated MP4 box');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let size=view.getUint32(offset),header=8;
  const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(size===1){if(offset+16>bytes.length)throw new Error('Truncated extended box');size=Number(view.getBigUint64(offset+8));header=16;}
  if(size===0)size=limit-offset;
  if(!Number.isSafeInteger(size)||size<header)throw new Error('Invalid MP4 box size');
  return {type,size,header};
}
export function relocateMovieBox(movie,insertAt,oldStart) {
  const output=Uint8Array.from(movie),view=new DataView(output.buffer,output.byteOffset,output.byteLength);
  const containers=new Set(['moov','trak','mdia','minf','stbl']);let tables=0;
  function walk(start,end){
    for(let pos=start;pos<end;){
      const box=boxHeader(output,pos,end),stop=pos+box.size;
      if(stop>end)throw new Error('MP4 box exceeds parent');
      if(containers.has(box.type))walk(pos+box.header,stop);
      else if(box.type==='stco'||box.type==='co64'){
        const width=box.type==='stco'?4:8,base=pos+box.header;
        if(base+8>stop)throw new Error('Truncated chunk offsets');
        const count=view.getUint32(base+4);
        if(base+8+count*width>stop)throw new Error('Truncated offset entries');
        for(let i=0;i<count;i++){
          const entry=base+8+i*width,old=width===4?view.getUint32(entry):Number(view.getBigUint64(entry));
          if(!Number.isSafeInteger(old)||old>=oldStart)throw new Error('Unsupported media chunk location');
          const moved=old<insertAt?old:old+output.length;
          if(width===4){if(moved>0xffffffff)throw new Error('32-bit offset overflow');view.setUint32(entry,moved);}
          else view.setBigUint64(entry,BigInt(moved));
        }
        tables++;
      }
      pos=stop;
    }
  }
  if(boxHeader(output).type!=='moov')throw new Error('Missing movie box');
  walk(0,output.length);
  if(!tables)throw new Error('No supported MP4 offset tables');
  return output;
}
export function fastStartPrefix(prefix,movie,media) {
  const result=new Uint8Array(prefix.length+movie.length+media.length);
  result.set(prefix);result.set(movie,prefix.length);result.set(media,prefix.length+movie.length);return result;
}

import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {boxHeader,relocateMovieBox,fastStartPrefix} from '../netlify/edge-functions/lib/fast-start.js';
const source=await readFile(process.argv[2]);let pos=0,movie,mdat;
while(pos<source.length){const box=boxHeader(source,pos,source.length);if(box.type==='moov')movie={offset:pos,size:box.size};if(box.type==='mdat'&&mdat===undefined)mdat=pos;pos+=box.size;}
if(!movie||mdat===undefined||movie.offset+movie.size!==source.length||movie.offset<mdat)throw Error('Unsupported validation source');
const relocated=relocateMovieBox(source.subarray(movie.offset),mdat,movie.offset);
const output=fastStartPrefix(source.subarray(0,mdat),relocated,source.subarray(mdat,movie.offset));
if(output.length!==source.length)throw Error('File size changed');
await writeFile(process.argv[3],output);
console.log(JSON.stringify({originalSize:source.length,playbackSize:output.length,originalSHA256:createHash('sha256').update(source).digest('hex'),playbackSHA256:createHash('sha256').update(output).digest('hex'),movieBeforeMedia:boxHeader(output,mdat).type==='moov'}));

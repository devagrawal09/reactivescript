// Merges a NODE_V8_COVERAGE directory (one file per fresh worker, cov-workers.mjs) into ONE
// file in the same format, keeping only the Solid src copy (/solid-src/): per script, per
// function (keyed by its own range), every block range with its counts summed over all files.
// docs/slice2a-fuzz/tools/delta.mjs and docs/slice2b-fuzz/tools/lines.mjs sum counts by range
// the same way, so their output on the merged directory equals their output on the original
// one; this only bounds memory (one program's files are parsed at a time).
//   node docs/slice2c-fuzz/tools/cov-merge.mjs IN_DIR OUT_DIR
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const [inDir,outDir]=process.argv.slice(2);
const scripts=new Map();let files=0;
for(const f of readdirSync(inDir)){const j=JSON.parse(readFileSync(inDir+'/'+f));files++;
 for(const s of j.result){if(!s.url.includes('/solid-src/'))continue;let fns=scripts.get(s.url);if(!fns)scripts.set(s.url,fns=new Map());
  for(const fn of s.functions){const r0=fn.ranges[0],k=r0.startOffset+':'+r0.endOffset+':'+fn.functionName;let e=fns.get(k);
   if(!e)fns.set(k,e={functionName:fn.functionName,isBlockCoverage:fn.isBlockCoverage,first:r0.startOffset+':'+r0.endOffset,ranges:new Map()});
   for(const r of fn.ranges){const rk=r.startOffset+':'+r.endOffset;e.ranges.set(rk,(e.ranges.get(rk)??0)+r.count)}}}}
const result=[...scripts].map(([url,fns])=>({url,functions:[...fns.values()].map(e=>({functionName:e.functionName,isBlockCoverage:e.isBlockCoverage,
 ranges:[e.first,...[...e.ranges.keys()].filter(k=>k!==e.first)].map(k=>{const [a,b]=k.split(':').map(Number);return {startOffset:a,endOffset:b,count:e.ranges.get(k)}})}))}));
mkdirSync(outDir,{recursive:true});writeFileSync(outDir+'/merged.json',JSON.stringify({result}));
console.log(files,'files,',result.length,'solid-src scripts ->',outDir+'/merged.json');

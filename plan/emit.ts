import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadTsxModules} from '../tsx/modules.ts';
import {loadYieldModules} from '../yield/lower.ts';
import {resolvePlan} from './resolve.ts';
const input=resolve(process.argv[2]);
const read=(path:string)=>{try{return readFileSync(path,'utf8')}catch{return undefined}};
// Integration can use sol's read-only frontend until its lowering change lands on main.
const yieldLoader=process.env.YIELD_FRONTEND ? (await import(pathToFileURL(resolve(process.env.YIELD_FRONTEND,'yield/lower.ts')).href)).loadYieldModules : loadYieldModules;
const set=(input.endsWith('.yield.tsx')?yieldLoader:loadTsxModules)(input,read);
const result=JSON.stringify(resolvePlan(set),null,2)+'\n';
if(process.argv[3])writeFileSync(process.argv[3],result);else process.stdout.write(result);

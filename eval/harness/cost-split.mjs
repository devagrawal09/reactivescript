// Round 5 secondary measures per run, from the transcripts: model calls, output tokens, the first call's context
// (system, tools and the one-line start), ./check and ./test calls, doc reads, messaging-tool calls, wall-clock, API $.
// Usage: node harness/cost-split.mjs <agents.txt> <transcripts-dir> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
const [list, dir, outFile] = process.argv.slice(2);
// API $ per uncached input token at the day's frontier-model price ($5 per million); billed units are in input tokens
const PRICE = 5e-6;
const runs = readFileSync(list,"utf8").trim().split("\n").map(l=>l.split(/\s+/));
const out = [];
for (const [run,id] of runs) {
  const lines = readFileSync(`${dir}/agent-${id}.jsonl`,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  const seen=new Set(); let first=null, t0=null, t1=null; let checks=0, tests=0, reads=0, readsDocs=0, mcp=0, tools={};
  let calls=[];
  for (const e of lines) {
    if (e.timestamp) { const t=Date.parse(e.timestamp); if(t0===null||t<t0)t0=t; if(t1===null||t>t1)t1=t; }
    const m=e.message; if(!m) continue;
    if (m.usage && !seen.has(m.id)) { seen.add(m.id); calls.push(m.usage); }
    if (e.type==="assistant" && Array.isArray(m.content)) for (const c of m.content) if (c.type==="tool_use") {
      tools[c.name]=(tools[c.name]||0)+1;
      if (c.name.startsWith("mcp__")) mcp++;
      const cmd = c.input?.command||"";
      if (c.name==="Bash") { if (/\.\/check/.test(cmd)) checks++; if (/\.\/test/.test(cmd)) tests++; }
      if (c.name==="Read") { reads++; if (/node_modules|guide|spec\//.test(c.input.file_path||"")) readsDocs++; }
    }
  }
  const u0=calls[0]; const fixed = (u0.cache_creation_input_tokens??0)+(u0.cache_read_input_tokens??0)+(u0.input_tokens??0);
  const billed = calls.reduce((s,u)=>s+(u.input_tokens??0)*1+(u.cache_creation_input_tokens??0)*1.25+(u.cache_read_input_tokens??0)*0.1+(u.output_tokens??0)*5,0);
  const output = calls.reduce((s,u)=>s+(u.output_tokens??0),0);
  out.push({run, task:run.split("-")[0], arm:run.split("-")[1], billed, calls:calls.length, output, fixed, checks, tests, reads, readsDocs, mcp, secs:Math.round((t1-t0)/1000), usd: billed*PRICE});
}
const med=xs=>{const s=[...xs].sort((a,b)=>a-b);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2};
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const groups={};
for (const r of out){ for (const k of [`${r.task}/${r.arm}`,`ALL/${r.arm}`]) (groups[k]??=[]).push(r); }
console.log("group          n  mean    median  calls  out    fixed  checks tests reads docs mcp secs  usd");
for (const [k,g] of Object.entries(groups).sort()) {
  const f=x=>g.map(r=>r[x]);
  console.log(k.padEnd(14), String(g.length).padStart(2), String(Math.round(mean(f("billed")))).padStart(7), String(Math.round(med(f("billed")))).padStart(7),
   mean(f("calls")).toFixed(1).padStart(5), String(Math.round(mean(f("output")))).padStart(6), String(Math.round(mean(f("fixed")))).padStart(6),
   mean(f("checks")).toFixed(1).padStart(5), mean(f("tests")).toFixed(1).padStart(5), mean(f("reads")).toFixed(1).padStart(5), mean(f("readsDocs")).toFixed(1).padStart(4), String(f("mcp").reduce((a,b)=>a+b,0)).padStart(3), String(Math.round(med(f("secs")))).padStart(5), mean(f("usd")).toFixed(2));
}
writeFileSync(outFile, JSON.stringify(out,null,2)+"\n");

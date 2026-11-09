// Writes docs/strings-fuzz/tools/unit-programs.json: hand-written --strings unit programs on the
// fuzz/solid.mjs op language (string values through the ported scheduler).
const rd=id=>({op:'read',id}),lit=value=>({op:'lit',value}),add=(a,b)=>({op:'add',a,b}),eq=(a,b)=>({op:'eq',a,b}),not=a=>({op:'not',a});
const choose=(test,yes,no)=>({op:'choose',test,yes,no}),get=(of,key)=>({op:'get',of,key}),elem={op:'elem'},ef=f=>get(elem,f),item=()=>({op:'item'});
const P={};
// An equal string is no change (`===` by content): no recompute, no effect.
P.equal_string_write=[{op:'signal',id:'s',value:'ab'},{op:'memo',id:'m',expr:add(rd('s'),lit('!'))},{op:'effect',id:'e',render:true,expr:rd('m')},{op:'flush'},
 {op:'write',id:'s',value:'ab'},{op:'flush'},{op:'write',id:'s',value:'a'},{op:'write',id:'s',value:'ab'},{op:'flush'},{op:'write',id:'s',value:'b'},{op:'flush'},
 {op:'read',label:'m',expr:rd('m')}];
// JS `+` and truthiness: integer + string, string + integer, "" falsy, "0" truthy, === on strings.
P.coercions=[{op:'signal',id:'s',value:''},{op:'signal',id:'k',value:3},
 {op:'memo',id:'a',expr:add(rd('k'),rd('s'))},{op:'memo',id:'b',expr:add(add(rd('s'),rd('k')),add(rd('k'),1))},
 {op:'memo',id:'c',expr:choose(rd('s'),lit('full'),lit('empty'))},{op:'memo',id:'d',expr:not(rd('s'))},{op:'memo',id:'e',expr:eq(rd('a'),lit('30'))},
 {op:'effect',id:'v',render:true,expr:{op:'arr',items:[rd('a'),rd('b'),rd('c'),rd('d'),rd('e')]}},{op:'flush'},
 {op:'write',id:'s',value:'0'},{op:'flush'},{op:'write',id:'k',value:-1},{op:'flush'},{op:'write',id:'s',value:''},{op:'flush'}];
// A list of strings with duplicates, by identity (by value for strings), index rows and a key function.
P.string_list=[{op:'signal',id:'xs',value:['a','b','a','']},
 {op:'list',id:'I',each:rd('xs'),keyed:true,index:true,row:[{effect:'e',render:true,expr:add(item(),{op:'index'})}]},
 {op:'list',id:'F',each:rd('xs'),keyed:{expr:add(elem,lit('#'))},index:false,row:[{effect:'e',render:true,expr:add(item(),lit('!'))}]},
 {op:'effect',id:'top',render:true,expr:{op:'arr',items:[{op:'len',of:rd('I')},{op:'len',of:rd('F')}]}},{op:'flush'},
 {op:'write',id:'xs',value:['b','a','a']},{op:'flush'},{op:'write',id:'xs',value:['','c']},{op:'flush'},{op:'write',id:'xs',value:[]},{op:'flush'}];
// The slice-2 tracker scenario (frontend/slices/tracker/tracker.scenario.json, format 2)
// as ops: claims guess "me", overlapping claims merge, resolve "dev"/"bo"/"ana", rejections
// write `"Could not assign #" + id`, the filter toggles both ways.
{const rows=[{id:1,title:'Crash on save',assignee:''},{id:2,title:'Slow search',assignee:'ana'},{id:3,title:'Typo in footer',assignee:''}];
 const L=get({op:'store',id:'issues'},'list'),open=eq(ef('assignee'),lit(''));
 const ops=[{op:'store',id:'issues',value:{list:rows}},{op:'memo',id:'shown',optimistic:true,expr:L},
  {op:'signal',id:'mode',value:'all'},{op:'signal',id:'status',value:''},
  {op:'memo',id:'visible',expr:{op:'filter',of:rd('shown'),where:choose(eq(rd('mode'),lit('all')),1,open),native:true}},
  {op:'memo',id:'unassigned',expr:{op:'count',of:rd('shown'),where:open,native:true}},
  {op:'effect',id:'hm',render:true,expr:add(lit('Filter: '),rd('mode'))},
  {op:'effect',id:'hu',render:true,expr:add(rd('unassigned'),lit(' open'))},
  {op:'show',id:'B',when:{op:'len',of:rd('visible')},yes:[{list:{id:'L',lazy:true,each:rd('visible'),keyed:true,index:false,
   row:[{effect:'t',render:true,expr:add(get(item(),'title'),lit(': '))},{effect:'a',render:true,expr:choose(get(item(),'assignee'),get(item(),'assignee'),lit('nobody'))}]}}],no:[]},
  {op:'effect',id:'body',render:true,expr:{op:'call',of:rd('B')}},
  {op:'effect',id:'foot',render:true,expr:rd('status')},{op:'flush'}];
 let a=0;const claim=(K,c)=>{ops.push({op:'action',id:'claim'+a++,slices:[
   {steps:[{update:'shown',expr:{op:'replace',of:{op:'arg'},where:eq(ef('id'),K),with:{op:'obj',fields:{id:K,title:ef('title'),assignee:lit('me')}},native:true}}],flight:'assign:'+K+'#'+c},
   {steps:[{store:'issues',edits:[{path:['list',{key:'id',is:K},'assignee'],set:{op:'sent'}}]},{write:'status',value:''}]}],
   catch:{steps:[{update:'status',expr:add(lit('Could not assign #'),K)}]}});ops.push({op:'drain'})};
 claim(1,1);claim(3,1);ops.push({op:'resolve',flight:'assign:3#1',value:'dev'},{op:'reject',flight:'assign:1#1',message:'offline'});
 claim(2,1);ops.push({op:'resolve',flight:'assign:2#1',value:'bo'},{op:'write',id:'mode',value:'open'},{op:'flush'});
 claim(1,2);ops.push({op:'resolve',flight:'assign:1#2',value:'ana'},{op:'write',id:'mode',value:'all'},{op:'flush'});
 claim(2,2);ops.push({op:'reject',flight:'assign:2#2',message:'offline'});
 ops.push({op:'read',label:'rows',expr:{op:'plain',of:rd('shown'),fields:['id','title','assignee']}},{op:'read',label:'status',expr:rd('status')});
 P.tracker_scenario=ops}
console.log(JSON.stringify(P,null,1));

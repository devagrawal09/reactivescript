// Writes docs/render-fuzz/tools/unit-programs.json: the hand-written renderer unit programs.
const rows=(a,b)=>Array.from({length:b-a+1},(_,i)=>({row:a+i}));
const R=x=>({x:'read',id:x}),ins=(x,fn=true)=>({k:'ins',x,fn}),txt=v=>({k:'text',v});
const el=(tag,kids,props=[])=>({x:'el',tag,props,kids});
const P={};
P.text_types=[{op:'signal',id:'v',value:'hello'},{op:'signal',id:'n',value:1},
 {op:'render',view:el('div',[{k:'el',el:el('p',[ins(R('v'))])},txt('['),ins({x:'cat',a:R('n'),b:' items'}),txt(']'),ins(R('v'))])},
 ...['world',7,0,'',null,true,['a',1,['b',[]]],[],'back',[ 'x' ]].flatMap(v=>[{op:'write',id:'v',value:v},{op:'flush'}]),
 {op:'write',id:'n',value:'2'},{op:'flush'}];
const big=rows(1,100);
P.for_bulk_moves=[{op:'signal',id:'l',value:big},
 {op:'render',view:el('ul',[txt('['),ins({x:'for',each:R('l'),arity:1,kids:el('li',[ins({x:'field',of:{x:'item'},key:'label'})])},false),txt(']')])},
 {op:'write',id:'l',value:big.slice().reverse()},{op:'flush'},
 {op:'write',id:'l',value:big.slice(70).concat(big.slice(0,70))},{op:'flush'},
 {op:'write',id:'l',value:big.slice(0,10).concat(big.slice(80),big.slice(10,80))},{op:'flush'},
 {op:'write',id:'l',value:big.filter((_,i)=>i%3)},{op:'flush'},
 {op:'write',id:'l',value:[]},{op:'flush'},
 {op:'write',id:'l',value:rows(101,166)},{op:'flush'}];
P.for_keyed_modes=[{op:'signal',id:'l',value:rows(1,4)},
 {op:'render',view:el('div',[
  ins({x:'for',each:R('l'),arity:2,keyed:false,kids:el('li',[ins({x:'field',of:{x:'item'},key:'label'}),txt('@'),ins({x:'index'})])}),txt('|'),
  ins({x:'for',each:R('l'),arity:2,keyed:'id',kids:el('li',[ins({x:'field',of:{x:'item'},key:'id'}),txt('@'),ins({x:'index'})]),fallback:'none'}),txt('|'),
  ins({x:'for',each:R('l'),arity:1,kids:{x:'arr',items:[{x:'field',of:{x:'item'},key:'label'},',']},fallback:el('i',[txt('empty')])})])},
 {op:'write',id:'l',value:[{row:3},{row:1},{row:4},{row:2},{row:3}]},{op:'flush'},
 {op:'write',id:'l',value:[{row:2}]},{op:'flush'},
 {op:'write',id:'l',value:[]},{op:'flush'},
 {op:'write',id:'l',value:rows(5,7)},{op:'flush'}];
P.show_swaps=[{op:'signal',id:'c',value:'x'},{op:'signal',id:'s',value:'a'},
 {op:'render',view:el('div',[
  ins({x:'show',when:R('c'),kids:el('b',[ins(R('s'))]),fallback:'off'},false),txt('|'),
  ins({x:'show',when:R('c'),fn:true,kids:{x:'arr',items:['v:',{x:'sarg'}]}},false),txt('|'),
  ins({x:'show',when:R('c'),keyed:true,fn:true,kids:el('i',[ins({x:'sarg'})]),fallback:el('u',[txt('none')])},false)])},
 ...['y','',0,'z','z',null,'w'].flatMap(v=>[{op:'write',id:'c',value:v},{op:'flush'}]),
 {op:'write',id:'s',value:'b'},{op:'flush'}];
P.conditional_fragments=[{op:'signal',id:'t',value:true},{op:'signal',id:'k',value:2},{op:'signal',id:'a',value:['p','q']},
 {op:'render',view:el('div',[txt('<'),ins({x:'arr',items:[{x:'cmemo',test:R('t'),yes:el('b',[txt('T')]),no:'F'},{x:'memo',body:R('a')},{x:'fn',body:{x:'cond',test:R('k'),yes:{x:'arr',items:[R('k'),'-']},no:{x:'arr',items:[]}}}]}),txt('>'),
  ins({x:'cmemo',test:R('k'),yes:R('a'),no:{x:'arr',items:[]}})])},
 {op:'write',id:'t',value:false},{op:'flush'},{op:'write',id:'a',value:[]},{op:'flush'},{op:'write',id:'k',value:0},{op:'flush'},
 {op:'write',id:'a',value:['r',['s',3]]},{op:'write',id:'t',value:'yes'},{op:'flush'},{op:'write',id:'k',value:5},{op:'flush'}];
const H=(id,o={})=>({x:'handler',id,...o});
P.delegated_events=[{op:'signal',id:'n',value:0},{op:'signal',id:'d',value:false},
 {op:'render',view:el('div',[{k:'el',el:el('section',[{k:'el',el:el('button',[txt('go')],[{name:'onClick',v:H('inner',{data:['row',7],write:{id:'n',value:1}}),dyn:false},{name:'disabled',v:R('d'),dyn:true}])},ins(R('n'))],[{name:'onClick',v:H('mid'),dyn:false}])}],[{name:'onClick',v:H('outer',{data:'top'}),dyn:false},{name:'onInput',v:H('in',{stop:true}),dyn:false}])},
 {op:'dispatch',node:4,type:'click'},{op:'flush'},
 {op:'dispatch',node:3,type:'click'},
 {op:'write',id:'d',value:true},{op:'flush'},{op:'dispatch',node:4,type:'click'},
 {op:'dispatch',node:3,type:'input'},{op:'dispatch',node:1,type:'click'},{op:'dispatch',node:99,type:'click'}];
P.stop_propagation=[{op:'render',view:el('div',[{k:'el',el:el('p',[txt('x')],[{name:'onClick',v:H('p',{stop:true}),dyn:false}])}],[{name:'onClick',v:H('div'),dyn:false}])},
 {op:'dispatch',node:3,type:'click'},{op:'dispatch',node:1,type:'click'}];
P.native_events=[{op:'signal',id:'c',value:1},
 {op:'render',view:{x:'let',id:'t',v:H('tuple',{data:5}),body:el('form',[{k:'el',el:el('input',[],[{name:'onChange',v:{x:'cond',test:R('c'),yes:{x:'var',id:'t'},no:null},dyn:true}])}],[{name:'onChange',v:H('form'),dyn:false},{name:'onClick',v:{x:'cond',test:R('c'),yes:H('fresh'),no:H('other')},dyn:true}])}},
 {op:'dispatch',node:2,type:'change'},{op:'write',id:'c',value:2},{op:'flush'},{op:'dispatch',node:2,type:'change'},
 {op:'write',id:'c',value:0},{op:'flush'},{op:'dispatch',node:2,type:'change'},{op:'dispatch',node:2,type:'click'},
 {op:'write',id:'c',value:3},{op:'flush'},{op:'dispatch',node:2,type:'change'}];
P.shared_node=[{op:'signal',id:'a',value:true},{op:'signal',id:'b',value:false},
 {op:'render',view:{x:'let',id:'m',v:{x:'memo',body:el('em',[txt('shared')])},body:el('div',[
  {k:'el',el:el('p',[ins({x:'cond',test:R('a'),yes:{x:'arr',items:[{x:'var',id:'m'},'x']},no:el('i',[txt('n')])})])},
  {k:'el',el:el('p',[ins({x:'cond',test:R('b'),yes:{x:'var',id:'m'},no:'-'})])}])}},
 {op:'write',id:'b',value:true},{op:'flush'},{op:'write',id:'a',value:false},{op:'flush'},
 {op:'write',id:'b',value:false},{op:'flush'},{op:'write',id:'a',value:true},{op:'flush'}];
P.dispose=[{op:'signal',id:'s',value:'a'},{op:'render',view:{x:'arr',items:[el('p',[ins(R('s'))]),R('s'),'!']}},
 {op:'write',id:'s',value:'b'},{op:'flush'},{op:'dispose'},{op:'write',id:'s',value:'c'},{op:'flush'},{op:'dispose'}];
P.components=[{op:'signal',id:'s',value:'a'},{op:'render',view:el('main',[ins({x:'comp',body:el('h1',[ins(R('s'))])},false),ins({x:'comp',body:{x:'cat',a:R('s'),b:'!'}},false)])},
 {op:'write',id:'s',value:'b'},{op:'flush'}];
console.log(JSON.stringify(P,null,1));

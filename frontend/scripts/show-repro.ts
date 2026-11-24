// docs/PIN-MAIN.md, "The plan fuzz baseline": the minimal program behind UPSTREAM_RX_SHOW. Upstream's emit writes an RX `if` as a
// <Show> with a block-bodied callback, which Solid main's production compiler (#4730) keeps as a component; the TSX twin's
// <Show> with JSX children becomes a ternary.   node --experimental-strip-types --conditions=browser scripts/show-repro.ts
import { transform } from '@solidjs/compiler';
import { loadModules } from '#rx/src/modules.ts';
import { compileModules } from '#rx/compile/emit.ts';
const rx = 'source open := true;\n<p onClick={() => { open := false }}>{if open { <b>yes</b> } else { <i>no</i> }}</p>\n';
const set = loadModules('App.rx', p => p === 'App.rx' ? rx : undefined);
const built = compileModules(set);
const jsx = [...built.files.values()].join('\n');
console.log('--- upstream emit (JSX) ---\n' + jsx.split('\n').filter(l => /Show|__item|<b>|<i>/.test(l)).join('\n'));
const c = (code: string, o = {}) => transform(code, { filename: 'a.jsx', generate: 'universal', moduleName: 'r', ...o } as any).code;
const lowered = (code: string) => /createComponent\(_?\$?Show/.test(code) ? 'Show component' : 'ternary (lowered)';
console.log('RX emit, compiled as upstream does      :', lowered(c(jsx)));
const twin = 'import {Show} from "solid-js"; export default () => <p><Show when={open()} fallback={<i>no</i>}><b>yes</b></Show></p>';
console.log('TSX twin, default (prod)                :', lowered(c(twin)));
console.log('TSX twin, lowerShow: false              :', lowered(c(twin, { lowerShow: false })));
console.log('TSX twin, dev: true                     :', lowered(c(twin, { dev: true })));
const up = 'import {Show} from "solid-js"; export default () => <p><Show when={open()} fallback={(() => <i>no</i>)()}>{(__item) => { return <b>yes</b>; }}</Show></p>';
console.log('upstream shape by hand (callback child) :', lowered(c(up)));
const up2 = 'import {Show} from "solid-js"; export default () => <p><Show when={open()} fallback={(() => <i>no</i>)()}>{<b>yes</b>}</Show></p>';
console.log('same, child without the callback        :', lowered(c(up2)));

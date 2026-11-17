// The plan v2.3 fuzz generator (plan/docs/PLAN-V2.md, "v2.3: composition", "Plan fuzz v2.3"): one seeded program with
// element attributes and components of one module, printed as Solid TSX (the composition tier), as RX and as React 19
// (react/fuzz.ts --compose), twin for twin, plus a chooser that clicks live targets. It is additive: gen.ts and gen-async.ts and their seeds are untouched.
//
// Programs vary: static and dynamic attributes (strings, integers, booleans, conditionals) on host elements, one
// effect's worth or several per template, attributes in For rows over a row local; a Badge component with value props
// (static, dynamic, conditional, a row local) and a callback prop it calls (a callback writing a signal, one over a row
// local, or an action passed by name), and a Panel component with children (elements, a nested component, or one text
// child, static or dynamic); sites under Show and in For rows. Buttons toggle, grow and count, one disabled by a
// dynamic attribute.
import { rng } from '../../tsx/fuzz/gen.ts';

type X =
  | { k: 'lit'; v: string | number | boolean }
  | { k: 'sig'; name: 's' | 'n' | 'open' }
  | { k: 'local'; name: string }
  | { k: 'prop'; name: string }
  | { k: 'add'; l: X; r: X }
  | { k: 'gt'; l: X; r: X }
  | { k: 'not'; e: X }
  | { k: 'cond'; c: X; t: X; f: X };
/** `react`: the React 19 twin (TSX syntax, plain reads, React's attribute names). */
type Ctx = { tsx: boolean; react?: boolean };
const px = (x: X, c: Ctx): string => {
  switch (x.k) {
    case 'lit': return typeof x.v === 'string' ? JSON.stringify(x.v) : String(x.v);
    case 'sig': return c.tsx && !c.react ? x.name + '()' : x.name;
    case 'local': return x.name;
    case 'prop': return 'props.' + x.name;
    case 'add': return '(' + px(x.l, c) + ' + ' + px(x.r, c) + ')';
    case 'gt': return '(' + px(x.l, c) + ' > ' + px(x.r, c) + ')';
    case 'not': return '!' + px(x.e, c);
    case 'cond': return '(' + px(x.c, c) + ' ? ' + px(x.t, c) + ' : ' + px(x.f, c) + ')';
  }
};

export type ComposeCase = { seed: number; family: string; tsx: string; rx: string; react: string; actions: { name: string }[]; script: { seed: number; steps: number } };

export function generateCompose(seed: number): ComposeCase {
  const r = rng(seed * 7919 + 13);
  /** Scope: a row local (a string), or the component's props. */
  type Scope = { row?: string; props?: 'badge' | 'panel' };
  const str = (sc: Scope, d = 0): X => {
    const opts: (() => X)[] = [() => ({ k: 'lit', v: r.pick(['a', 'b', 'zz']) })];
    if (!sc.props) opts.push(() => ({ k: 'sig', name: 's' }));
    if (sc.row) opts.push(() => ({ k: 'local', name: sc.row! }));
    if (sc.props) opts.push(() => ({ k: 'prop', name: sc.props === 'badge' ? 'label' : 'title' }));
    if (d < 2) {
      opts.push(() => ({ k: 'add', l: { k: 'lit', v: r.pick(['x', 'row ']) }, r: r.chance(0.6) ? str(sc, d + 1) : int(sc, d + 1) }));
      if (!sc.props) opts.push(() => ({ k: 'cond', c: bool(sc), t: str(sc, d + 1), f: { k: 'lit', v: 'off' } }));
    }
    return r.pick(opts)();
  };
  const int = (sc: Scope, d = 0): X => {
    const opts: (() => X)[] = [() => ({ k: 'lit', v: r.int(4) })];
    if (!sc.props) opts.push(() => ({ k: 'sig', name: 'n' }));
    if (sc.props === 'badge') opts.push(() => ({ k: 'prop', name: 'count' }));
    if (d < 2) opts.push(() => ({ k: 'add', l: int(sc, d + 1), r: { k: 'lit', v: 1 + r.int(2) } }));
    return r.pick(opts)();
  };
  const bool = (sc: Scope): X => sc.props ? { k: 'lit', v: true } : r.pick<X>([{ k: 'sig', name: 'open' }, { k: 'not', e: { k: 'sig', name: 'open' } }, { k: 'gt', l: { k: 'sig', name: 'n' }, r: { k: 'lit', v: r.int(3) } }]);
  const dynamic = (x: X): boolean => x.k === 'sig' || x.k === 'prop' || (x.k === 'add' || x.k === 'gt' ? dynamic(x.l) || dynamic(x.r) : x.k === 'not' ? dynamic(x.e) : x.k === 'cond' ? dynamic(x.c) || dynamic(x.t) || dynamic(x.f) : false);

  type Attr = { name: string; x: X };
  /** A few attributes of a host element: names from the HTML vocabulary, values of their type. */
  const attrs = (sc: Scope, max = 3): Attr[] => {
    const pool: (() => Attr)[] = [
      () => ({ name: 'class', x: str(sc) }), () => ({ name: 'title', x: str(sc) }), () => ({ name: 'data-n', x: int(sc) }),
      () => ({ name: 'aria-label', x: str(sc) }), () => ({ name: 'hidden', x: bool(sc) }), () => ({ name: 'tabindex', x: int(sc) }),
    ];
    const out: Attr[] = [];
    for (let i = r.int(max + 1); i > 0; i--) { const a = r.pick(pool)(); if (!out.some(b => b.name === a.name)) out.push(a); }
    return out;
  };
  const REACT_NAMES: Record<string, string> = { class: 'className', tabindex: 'tabIndex' };
  const pa = (as: Attr[], c: Ctx) => as.map(a => ' ' + (c.react ? REACT_NAMES[a.name] ?? a.name : a.name) + '={' + px(a.x, c) + '}').join('');
  // An element text hole: coerced in TSX (`"" + x`, which the plan drops), as RX renders ToString anyway.
  const hole = (x: X, c: Ctx) => '{' + (c.tsx && !c.react ? '"" + ' + px(x, c) : px(x, c)) + '}';

  // ------------------------------------------------------------- Badge and Panel
  const badgeAttrs = attrs({ props: 'badge' }, 2);
  const badgeCount = r.chance(0.5);
  const badge = (c: Ctx) => {
    const head = c.tsx ? 'function Badge(props: { label: string; count: number; onPick: (x: number) => void }) {\n  return (\n    ' : 'component Badge(props) {\n  ';
    const click = c.tsx ? '() => props.onPick(props.count)' : '() => { props.onPick(props.count); }';
    const body = '<li' + pa(badgeAttrs, c) + ' onClick={' + click + '}>' + hole({ k: 'prop', name: 'label' }, c) + (badgeCount ? '<i>' + hole({ k: 'prop', name: 'count' }, c) + '</i>' : '') + '</li>';
    return head + body + (c.tsx ? '\n  );\n}' : '\n}');
  };
  const panelHead = r.chance(0.5);
  const panel = (c: Ctx) => {
    const head = c.tsx ? 'function Panel(props: { title: string; children: ' + (c.react ? 'React.ReactNode' : 'JSX.Element') + ' }) {\n  return (\n    ' : 'component Panel(props) {\n  ';
    const body = panelHead
      ? '<section title={props.title}><h2>' + hole({ k: 'prop', name: 'title' }, c) + '</h2>{props.children}</section>'
      : '<section>{props.children}<p>end</p></section>';
    return head + body + (c.tsx ? '\n  );\n}' : '\n}');
  };

  // ------------------------------------------------------------- App
  const withAction = r.chance(0.5);
  type Pick = { k: 'set'; sig: 'n' | 's' } | { k: 'action' };
  // `items` and `bump` are declared only where read: React Compiler places no value nothing reads.
  let usesItems = false, usesBump = false;
  const onPick = (sc: Scope): Pick => withAction && r.chance(0.35) ? (usesBump = true, { k: 'action' }) : { k: 'set', sig: r.pick(['n', 's'] as const) };
  const pickArg = (p: Pick, sc: Scope, c: Ctx): string => {
    // An action goes through a callback: TSX passes no parameterized action by name (tsx/lower.ts).
    if (p.k === 'action') return c.tsx ? '(x: number) => bump(x)' : '(x) => { bump(x); }';
    const value: X = p.sig === 'n' ? { k: 'add', l: { k: 'local', name: 'x' }, r: { k: 'lit', v: 1 } } : { k: 'add', l: sc.row ? { k: 'local', name: sc.row } : { k: 'lit', v: 'p' }, r: { k: 'local', name: 'x' } };
    return c.tsx ? '(x: number) => set' + p.sig.toUpperCase() + '(' + px(value, c) + ')' : '(x) => { ' + p.sig + ' := ' + px(value, c) + '; }';
  };
  /** `key`: the React twin's key on a row. */
  type Site = (c: Ctx, key?: string) => string;
  const badgeSite = (sc: Scope): Site => {
    const label = str(sc), count = int(sc), pick = onPick(sc);
    return (c, key) => '<Badge' + (key ? ' key={' + key + '}' : '') + ' label={' + px(label, c) + '} count={' + px(count, c) + '} onPick={' + pickArg(pick, sc, c) + '} />';
  };
  const panelSite = (sc: Scope, depth: number): Site => {
    const title = str(sc);
    const kind = r.int(4);
    const inner = kind === 0 ? null : kind === 1 ? badgeSite(sc) : kind === 2 ? element(sc, depth + 1) : null;
    const text: X | null = kind === 0 ? (r.chance(0.5) ? { k: 'lit', v: 'hi' } : { k: 'sig', name: 's' }) : null;
    return (c, key) => '<Panel' + (key ? ' key={' + key + '}' : '') + ' title={' + px(title, c) + '}>'
      + (text ? (text.k === 'lit' ? String(text.v) : '{' + px(text, c) + '}') : inner ? inner(c) : '<b>k</b><i>' + hole({ k: 'sig', name: 'n' }, c) + '</i>')
      + '</Panel>';
  };
  const element = (sc: Scope, depth: number): Site => {
    // Phrasing tags below the top: a <p> inside a <p> is not the tree the browser parses.
    const tag = depth === 0 ? r.pick(['p', 'span', 'em']) : r.pick(['span', 'em']);
    const as = attrs(sc);
    const kids: Site[] = [];
    if (r.chance(0.6)) { const x = r.chance(0.5) ? str(sc) : int(sc); if (dynamic(x)) kids.push(c => hole(x, c)); }
    if (depth < 2 && r.chance(0.4)) kids.push(element(sc, depth + 1));
    if (!kids.length) kids.push(() => 'w');
    return (c, key) => '<' + tag + (key ? ' key={' + key + '}' : '') + pa(as, c) + '>' + kids.map(k => k(c)).join('') + '</' + tag + '>';
  };
  const show = (depth: number): Site => {
    const when = bool({});
    const body = r.chance(0.5) ? badgeSite({}) : panelSite({}, depth + 1);
    return c => c.react ? '{' + px(when, c) + ' && ' + body(c) + '}' : c.tsx ? '<Show when={' + px(when, c) + '}>' + body(c) + '</Show>' : '{if ' + px(when, c) + ' { ' + body(c) + ' }}';
  };
  const rows = (depth: number): Site => {
    const sc: Scope = { row: 'item' };
    usesItems = true;
    const body = r.pick([() => badgeSite(sc), () => element(sc, depth + 1), () => panelSite(sc, depth + 1)])();
    return c => c.react ? '{items.map((item) => ' + body(c, 'item') + ')}' : c.tsx ? '<For each={items()}>{(item) => ' + body(c) + '}</For>' : '{for item in items { ' + body(c) + ' }}';
  };
  const button = (label: string, write: { tsx: string; rx: string; react: string }, as: Attr[]) => (c: Ctx) =>
    '<button' + pa(as, c) + ' onClick={' + (c.react ? '() => ' + write.react : c.tsx ? '() => ' + write.tsx : '() => { ' + write.rx + ' }') + '}>' + label + '</button>';
  const buttons: Site[] = [
    button('toggle', { tsx: 'setOpen(!open())', rx: 'open := !open;', react: 'setOpen(!open)' }, r.chance(0.5) ? attrs({}, 2) : []),
    button('grow', { tsx: 'setS(s() + "x")', rx: 's := s + "x";', react: 'setS(s + "x")' }, []),
    button('inc', { tsx: 'setN(n() + 1)', rx: 'n := n + 1;', react: 'setN(n + 1)' }, r.chance(0.5) ? [{ name: 'disabled', x: { k: 'gt', l: { k: 'sig', name: 'n' }, r: { k: 'lit', v: 2 + r.int(3) } } }] : []),
  ];
  const parts: Site[] = [];
  for (let i = 1 + r.int(4); i > 0; i--) parts.push(r.pick([() => badgeSite({}), () => panelSite({}, 0), () => element({}, 0), () => show(0), () => rows(0)])());
  const order = [...buttons, ...parts].map(x => ({ x, k: r.int(1000) })).sort((a, b) => a.k - b.k).map(o => o.x);
  const rootAttrs = attrs({});
  const view = (c: Ctx) => '<div' + pa(rootAttrs, c) + '>' + order.map(p => p(c)).join('') + '</div>';

  const tsx: Ctx = { tsx: true }, rx: Ctx = { tsx: false };
  const t = [
    'import { ' + [...(usesBump ? ['action'] : []), 'createMemo', 'createSignal', 'For', 'Show'].join(', ') + ' } from "solid-js";', '',
    badge(tsx), '', panel(tsx), '',
    'export default function App() {',
    '  const [s, setS] = createSignal("a");', '  const [n, setN] = createSignal(0);', '  const [open, setOpen] = createSignal(true);',
    ...(usesItems ? ['  const items = createMemo(() => (open() ? ["p", "q"] : ["r"]));'] : []),
    ...(usesBump ? ['  const bump = action(function* (x: number) {', '    setN(x + 2);', '  });'] : []),
    '  return (', '    ' + view(tsx), '  );', '}', '',
  ].join('\n');
  const x = [
    badge(rx), '', panel(rx), '',
    'export default component App() {',
    '  source s := "a";', '  source n := 0;', '  source open := true;',
    ...(usesItems ? ['  items = (open ? ["p", "q"] : ["r"]);'] : []),
    ...(usesBump ? ['  action bump(x: number) {', '    n := x + 2;', '  }'] : []),
    '', '  ' + view(rx), '}', '',
  ].join('\n');
  const react: Ctx = { tsx: true, react: true };
  const rt = [
    'import { ' + (usesBump ? 'startTransition, ' : '') + 'useState } from "react";', '',
    badge(react), '', panel(react), '',
    'export default function App() {',
    '  const [s, setS] = useState("a");', '  const [n, setN] = useState(0);', '  const [open, setOpen] = useState(true);',
    ...(usesItems ? ['  const items = open ? ["p", "q"] : ["r"];'] : []),
    ...(usesBump ? ['  const bump = (x: number) => startTransition(async () => {', '    setN(x + 2);', '  });'] : []),
    '  return (', '    ' + view(react), '  );', '}', '',
  ].join('\n');
  return { seed, family: 'compose', tsx: t, rx: x, react: rt, actions: usesBump ? [{ name: 'bump' }] : [], script: { seed: seed * 31 + 7, steps: 4 + r.int(10) } };
}

export function emitCompose(c: ComposeCase): Record<string, string> {
  return { 'App.tsx': c.tsx, 'App.rx': c.rx, 'api.d.rx': '' };
}

/** Clicks live targets, `steps` of them. */
export function chooserFor(c: ComposeCase) {
  const r = rng(c.script.seed);
  let n = 0;
  return (live: { clickables: { target: { text: string; parent?: string; index: number } }[] }) => {
    if (n++ >= c.script.steps || !live.clickables.length) return null;
    return { type: 'click' as const, target: r.pick(live.clickables).target };
  };
}

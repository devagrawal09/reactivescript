# 07 — Surface

**Status: OPEN (2026-10-22), first draft.** Concrete syntax for everything 02–06
gives a semantics to. Written last, so every form below names the rule it
spells. The scenarios in `scenarios/` are already written in this syntax minus
types, imports and handlers — this document is what makes that official and
fills the gaps. Ruled so far: file = module; `source` / `=` / `:=`; imports
`io` unless `pure`; handlers are JSX attributes; `c ? a : b` only; streams
are `await*`; `errored fallback(e)`; `.rx`. The list at the end records each.

Design stance: the expression language is TypeScript's, verbatim, minus the
forms the scopes forbid; the reactive forms are few and spelled with words
(`source`, `effect`, `action`, `pre`, `peek`, `latest`, `pending?`) rather
than sigils, because an AI reader keys on words. JSX elements are kept
verbatim; control flow inside markup is braced forms, not components.

---

## 1. Files and modules

A file (`.rx`) is a module. Its top level is imports, exports and
declarations. A declaration at the top level lives for the module's lifetime
(a module-level `source` is app state, as a module-level signal is in Solid).

```
import { fetchUser } from "./api"          // an io value: callable only in imperative scope (IO-2)
import pure { formatName } from "./format" // a lifted value function: callable anywhere (E-9)
import { Avatar } from "./Avatar.rx"       // a component

export component Profile(props: { id: number }) { … }
```

- Every JS import is `io` unless imported `pure` (R-io-4). `pure` is the
  one word in the language that lowers taint, and it is unchecked for JS;
  inside `.rx` the row is inferred and only rises: a `fn` that calls `io`
  is a compile error, an `io` call outside imperative scope is a compile
  error (R-io-1..3). `fn` is pure by definition, `action` is `io`.
- `export` works on `component`, `fn`, `action`, and module-level sources and
  equations (exported as accessors — a module boundary is a value boundary,
  never a write boundary: W-1 holds across modules).

## 2. Declarations (02 §1)

```
source count: number := 0              // E-4: assigned once, written only in imperative scope
source user = await fetchUser(id)      // ST-5: a source with a standing question
double = count * 2                     // E-1: an equation; holds for all time
label: string = `${user.name} (${count})`
deferred preview = await render(doc)   // H-1: declared lag
rows key id = map(items, …)            // ST-4: keyed collection
selected = draft(pre selected -> {}) { d[id] := true }   // ST-3
effect (count, user.name) { … }        // EF: compute half in parens, apply half in braces
fn area(ref w: number, h: number): number => w * h       // E-9: `ref` is an instantiation parameter
fn Counter(ref start: number) {        // RG-6: an instantiating fn — has declarations
  source n := start
  n
}
action save(name: string) { … }        // AC-1
component Row(props: { item: Item }) { … }   // RG-4
provide theme = settings.theme         // RG-7: to everything rendered beneath
palette = (use theme).palette          // RG-7: the nearest provision above
provide fields = fields                // RG-7c: a provided source is the source — `use fields := …` writes it
```

- Types are TypeScript's, after the name. On a source they type the value;
  on an equation, the value it holds; on `fn`/`action`/`component`
  parameters as in TS.
- `source x = e` (not `:=`) is the only place `=` declares something that
  can be written.
- `pre x -> init` is `pre x` with the value for the first instant (C-2a).
- A declaration is terminated by a newline or `;`.

## 3. Expressions (02 §1, 04)

TypeScript expression grammar verbatim, with these removals and additions.

Removed (unwritable, bin U): assignment and update operators (`=`, `+=`,
`++`, …), `delete`, `new` on reactive values, `this`, `function`
expressions, `async`/generators, `?.` on a probe. Arrow functions are
allowed and are reactive (lifted) in reactive scope, imperative in
imperative scope (SC-3).

Added:

| form | meaning | rule |
| --- | --- | --- |
| `await e` | the answer to `e`'s flight; absent until it lands | R-1 |
| `await e -> v` | the same, with `v` as the first paint | R-7 |
| `await* e` | the latest answer of an async iterable (a stream) | ST-6b |
| `pre x`, `pre x -> init` | `x`'s value in the previous instant | C-2 |
| `peek(e)` | `e` read without subscribing | E-? (untrack) |
| `latest x` | the value `x` is moving toward, else its committed value | R-9 |
| `pending? e` | the verdict of the reads inside `e` | R-9, H-9 |
| `c ? a : b` | lazy conditional (TS's `c ? a : b` is also accepted) | E-11 |
| `draft(e) { … }` | a copy of `e` written along `d` | ST-3 |

`await` may appear anywhere in an expression; the compiler lifts each one to
its own flight (04 R-1). `yield` is not an expression; a stream is `await*`.

## 4. Markup (02 §V, 03)

A reactive block is declarations, then markup. JSX elements are verbatim:
attributes are equations, children are readers, components are applied as
`<Name prop={e}>…</Name>` (RG-4).

```
<section class={theme}>
  <h1>{user.name}</h1>
  {if open {
    <Panel items={rows} />
  } else {
    <p>closed</p>
  }}
  {for row in rows {
    source hits := 0
    <li onClick={() => { hits := hits + 1 }}>{row.name} {hits}</li>
  }}
  {loading on(id) fallback { <Spinner/> } {
    <Details data={await fetchDetails(id)} />
  }}
  {errored fallback(e) { <p>{e.message}</p> } {
    <Risky/>
  }}
</section>
```

- `{if}`, `{for}`, `{loading}`, `{errored}` are braced inside an element and
  bare at block level. Each block is a region: declarations, then markup
  (RG-1, RG-2, RG-5). `if x { … }` narrows `x` inside (RG-1c).
- `for x in e` keys rows by identity, or by the collection's `key` (ST-4b).
- `errored fallback(e)` binds the error value; `fallback` without a
  parameter ignores it.

## 5. Imperative scope (02 SC-2, 06 AC)

Imperative scope is: an `effect`'s apply block, an `action` body, and any
arrow function written in imperative scope or as an element's event handler.

```
<button onClick={() => { count := count + 1 }}>+</button>

effect (count) {
  document.title = `${count}`        // io: a plain JS statement
  return () => { … }                 // the cleanup (O-2)
}

action rename(n: string) {
  optimistic user.name := n          // AC-3: only here
  let saved = await api.rename(n)    // AC-1: a hold-safe suspension
  user := saved
}

action { refresh user; affects user }   // inline, one run (AC-1)
```

- A write is `target := e`; `target` is a source or a path into one (W-1),
  or `use name …` for a provided source (RG-7c). There is no compound
  assignment; `x := f` with `f` a function is a functional write — `f` is
  applied to the slot at the instant, so writes to one slot in one instant
  compose (W-6).
- `let` declares an imperative local; TS statements (`if`, `for`, `try`,
  `return`, calls) are allowed; reads of reactive names are snapshots of σ
  (H-10, SC-2).
- `await` in an action body suspends the run and keeps its change open; in
  a plain handler it ends the change (the continuation is a new one).
- `refresh x`, `affects x`, `optimistic x := e` are statements (AC-3..5).

## 6. Components (RG-4)

```
component Card(props: { title: string; children: View }) {
  source open := false
  <div class="card" onClick={() => { open := !open }}>
    <h2>{props.title}</h2>
    {if open { props.children }}
  </div>
}
```

- `props` is a structured value; reading `props.x` tracks the caller's
  equation for `x`. `props.children` is a `View`, shown by reading it.
- A component is applied only in markup. It returns nothing.

## 7. Worked ports

S-solid-8:

```
source x := 0
action save() { x := 1; await api.save() }
<div>
  <p>{x}</p> <p>latest {latest x}</p>
  <p>{pending? x ? "saving" : "idle"}</p>
  <button onClick={() => { save() }}>save</button>
</div>
```

S-solid-26 (rows 4–7):

```
source id := 1
user = await fetchUser(id)
action reload() { affects user; refresh user; await gate() }
{loading fallback { <p>…</p> } {
  <p>{user.name}</p> <p>{pending? user ? "updating" : ""}</p>
}}
```

S-store-3:

```
source rows := [{ id: 1, name: "a" }, { id: 2, name: "b" }]
view key id = map(rows, r => ({ id: r.id, name: r.name + "!" }))
{for r in view {
  effect (r.name) { log(r.id, $0) }
  <p>{r.name}</p>
}}
```

## 8. Grammar sketch

```
Module    ::= (Import | Export | Decl)*
Import    ::= "import" "pure"? ImportClause "from" String
Export    ::= "export" Decl
Decl      ::= "source" Name Type? (":=" | "=") Expr
            | "provide" Name "=" Expr
            | "deferred"? Name Type? ("key" Name)? "=" Expr
            | "effect" "(" Expr ("," Expr)* ")" Block
            | "fn" Name "(" Params ")" Type? ("=>" Expr | "{" Decl* Expr "}")
            | "action" Name "(" Params ")" Block
            | "component" Name "(" Name Type? ")" "{" RBlock "}"
RBlock    ::= Decl* Markup*
Markup    ::= JSXElement | "{" Expr "}" | Control
Control   ::= "if" Expr "{" RBlock "}" ("else" "{" RBlock "}")?
            | "for" Name "in" Expr "{" RBlock "}"
            | "loading" ("on" "(" Expr ")")? "fallback" "{" RBlock "}" "{" RBlock "}"
            | "errored" "fallback" ("(" Name ")")? "{" RBlock "}" "{" RBlock "}"
Block     ::= "{" Stmt* "}"
Stmt      ::= Target ":=" Expr | "optimistic" Target ":=" Expr      -- Target may be `use` Name Path (RG-7c)
            | "refresh" Name | "affects" Name | "action" Block
            | "let" Name Type? "=" Expr | TSStatement
Expr      ::= TSExpr with §3's removals and additions
```

---

## Decisions taken by default (veto here)

1. **File = module** (ruled 2026-10-22), components declared with
   `component`, exported with `export`.
2. **`source` / `=` / `:=`** kept over `let`/`const` (ruled 2026-10-22):
   `let`/`const` would still need `=` beside `:=`, because a derived `let`
   (`source x = e`, ST-5) exists — so the keywords would not carry the
   distinction and the operators would anyway. `source` names the one kind
   of binding that can be written; `=` vs `:=` says whether it starts from
   a question or a value.
3. **TS expression grammar verbatim**, with the removal list in §3. No
   `yield`; streams are `await*` (ruled 2026-10-22).
4. **`c ? a : b`** kept beside `c ? a : b`; both are E-11.
5. **Imports are `io` unless `import pure`** (ruled 2026-10-22; R-io-4).
   `pure` is the only taint keyword and points one way.
6. **Event handlers are JSX attributes** (`onClick={() => { … }}`), the
   arrow being imperative scope (ruled 2026-10-22). No `on:click` form.
7. **`errored fallback(e)`** binds the error; `loading on(e)` (ruled
   2026-10-22).
8. **File extension `.rx`** (ruled 2026-10-22; `.rsx` is also free, `.rxs`
   is ooRexx's).
9. **DV-2** ruled 2026-10-22: a failed action's held writes commit; only
   its optimistic state reverts (AC-1).

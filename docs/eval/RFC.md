# RFC: `eval`, running ReactiveScript that arrives as a string

For ryansolid/reactivescript. Draft, not posted.

## Summary

Add `eval` to ReactiveScript: take `.rx` code as a string while the program runs, give it a few named bindings from the
surrounding component, check it with the same checker as authored code, and run it. It comes in two forms:

```rx
<div>{eval(code, { count, bump })}</div>                      // markup eval: renders the code's UI
label: string = eval(formula, { count }, { type: "string" })  // value eval: one typed value
```

TSX spelling, for the TSX frontend:

```tsx
<div>{createEval(() => code(), { count, bump })}</div>
const label = createEval(() => formula(), { count }, { type: "string" });   // read as label()
```

A working prototype of exactly this exists, verified against native Solid 2 (see "Prototype").

## Motivation

- **Generated UI.** A model writes a small widget against a typed interface ("you may read `todos`, call `add`").
  Today that means JSON UI specs, which have no logic, or `new Function`/iframes, which have no checking and share no
  reactivity with the app.
- **Playgrounds and REPLs.** Type code and see it run against live app state.
- **Plugins.** The binding interface is the plugin contract: a plugin sees exactly what the host passes it.

ReactiveScript fits this better than JS. It's small, it's checked, it has no loops or ambient globals, and its
writer-scope rule (O-4) already says other code can only write your state through actions you hand it. `eval` reuses
those guarantees for code the app didn't ship with.

## Proposal

```
markup := "{" "eval" "(" code "," bindings [ "," options ] ")" "}"         an element's child
value  := name ":" scalar "=" "eval" "(" code "," bindings [ "," options ] ")"   the whole value of an equation
bindings := "{" [ name | name ":" name ] { "," … } "}"
options  := { syntax: "rx" | "tsx", check: "strict" | "lenient", type: scalar, interface: string }
scalar   := number | string | boolean
```

- **Markup eval.** The code is a component body: declarations, then markup. It renders where the call stands, as an
  element's child.
- **Value eval.** The code is one expression. The result is a tracked value of the declared scalar type.
- `eval` is a site form, not a function. Inside a handler, inside a larger expression, or as a binding it is refused.
- `code` is any string expression, and it is reactive (see "Lifetime").

### Example 1: counter

```rx
export default component Counter() {
  source count := 0;
  action bump(n: number) { count := count + n; }
  source code := "<button onClick={() => { bump(1) }}>{\"count \" + count}</button>";
  source formula := "count > 3 ? \"big\" : \"small\"";

  size: string = eval(formula, { count }, { type: "string" });
  <section>
    <div>{eval(code, { count, bump })}</div>
    <i>{size}</i>
  </section>
}
```

Both evals read `count`; only the markup one can change it, and only by calling `bump`.

### Example 2: todos

```rx
import { createTodo } from "./api";   // fn createTodo(title: string): Todo[]

export default component Todos() {
  source todos := { list: [{ id: 1, title: "write RFC", done: false }] };
  action add(title: string) { try { let list = await createTodo(title); todos.list := list; } catch (e) {} }
  action setDone(i: number, done: boolean) { todos.list[i].done := done; }
  source view := "...";                          // markup code, below
  source openCount := "filter(todos.list, t => !t.done).length";

  open: number = eval(openCount, { todos }, { type: "number" });
  <section>
    <p>{open + " open"}</p>
    <div>{eval(view, { todos, add, setDone })}</div>
  </section>
}
```

```rx
// view, the markup code
source next := 2;
<div>
  <ul>{for t in todos.list {
    <li onClick={() => { setDone(indexOf(todos.list, x => x.id == t.id), !t.done) }}>
      {if t.done { <s>{t.title}</s> } else { <span>{t.title}</span> }}
    </li>
  }}</ul>
  <button onClick={() => { add("todo " + next); next := next + 1 }}>add</button>
</div>
```

The code owns `next` and writes it freely. It reads the `todos` store but changes it only through `add` and
`setDone`; `todos.list := []` inside the code is refused (`READ_ONLY`). The count and the view are two evals because a
value eval returns one scalar (see "Limits").

### Example 3: async fetch

```rx
import pure { loadIssues } from "./api";   // pure fn loadIssues(): { id: number, title: string }[]

export default component Board() {
  source code := "...";                    // below
  <div>{eval(code, { loadIssues })}</div>
}
```

```rx
// code
issues = await loadIssues();
<section>
  {errored fallback { <p>failed to load</p> } {
    loading fallback { <p>loading…</p> } {
      <ul>{for i in issues { <li>{i.title}</li> }}</ul>
    }
  }}
</section>
```

Loading works as in authored code. Errors need a boundary inside the code: the code is checked as its own component, so
an `errored` around the site doesn't count (see "Limits").

## Semantics

**Bindings by label.** The binding object is the code's whole scope. `{ count }` makes `count` visible inside;
`{ n: count }` makes the caller's `count` visible as `n`. Nothing else resolves: not the caller's other names, not
imports, not globals (`UNBOUND`). Each binding is one of:

| kind | from the caller | inside the code |
| --- | --- | --- |
| read | source, equation, or a value eval | read (tracked) |
| store | a store | read by path (tracked per path) |
| action | an action | call from handlers and actions |
| host | an imported host fn | call; `pure` hosts may be awaited in equations, others in actions |

Bindings are **read-only**. This is O-4 at the boundary: a binding is a read, so `count := 1` inside the code is refused
(`READ_ONLY`). A bound action runs as the caller's action, with its own writes and outcome. The caller decides what can
change; the code decides when.

**Types.** The checker derives the interface from the caller (each binding's kind and type) after it has accepted the
caller, and checks the code against exactly that. It's printed as RX declarations:

```
read count: number
store todos: { list: { id: number, title: string, done: boolean }[] }
action setDone(number, boolean)
pure host loadIssues(): { id: number, title: string }[]
```

A site may write `interface` itself; it must equal the derived one. A host that isn't compiled by the RX frontend (a
plugin loader, say) must pass it.

**Lifetime.** The code string is a reactive source. A markup eval behaves like a keyed `Show` over it: when the string
changes, the evaluated subtree is disposed (its sources, effects and DOM) and the new code is created. An unchanged
string does nothing; the empty string renders nothing. Requests left pending by a disposed subtree settle and write only
that subtree's own sources, which nothing reads. A value eval is a memo that re-reads the code and its bindings.

**Failure.** Code is compiled when it first runs (cached per string). A refusal is an `EvalRefused` error with typed
diagnostics (`UNBOUND`, `READ_ONLY`, `TYPE`, `PARSE`, …, each with a message and line), thrown inside the site, so the
nearest `errored` shows it. Nothing of refused code renders. When the code changes to valid code, the boundary recovers.

## Capability model

- The code can read what it is bound, call bound actions, and call bound host fns. Those host fns are its only I/O.
- No ambient scope, no imports, no JS globals (RX already has none in scope).
- Strict checking by default: any type error refuses the code. `check: "lenient"` turns type errors into warnings for
  REPLs; scope, read-only, async and subset refusals stay hard, and every value is still checked at run time.
- Not covered: CPU and memory limits. RX has no loops, but large lists are still possible. A host that runs untrusted
  code should still bound it.

## Limits

- **A value eval returns one scalar** (number, string or boolean). It can't return a record, a list, an action or UI.
  The todo example needs two evals of related code for that reason, and the two don't share state: the view's `draft`
  isn't visible to the count.
- **A markup eval must be an element's child.** It can't be the component's root, a `Show` branch or a `For` row, and it
  can't be stored in a name and rendered later (`v = eval(…)` then `{v}`), because the compiler lowers those children
  differently.
- **Async code needs its own `errored`.** The code is checked as a separate component, so a reader of a host that can
  fail must have a boundary inside the code (`UNHANDLED_FAILURE`). An `errored` around the eval site still catches
  refusals, but doesn't satisfy that check.
- **The code is the plan subset.** In the prototype, evaluated code is limited to what plan v2 can carry: no `*` or `-`,
  no functional writes, no array spreads, no indexed reads. That's why the todo example adds rows through a host
  and toggles by index.
- Every code change starts fresh; nothing is kept across a swap.

## Open questions

1. **State on swap.** When the code changes, should sources whose declarations didn't change keep their values (REPL
   style, an opt-in `preserve`), or should every change start fresh as today?
2. **Error reporting.** Is a thrown `EvalRefused` caught by `errored` enough, or should eval also expose diagnostics as a
   value, for an editor showing errors while the old code keeps running?
3. **Reactivity of the code string.** Should every change re-create the code, or should hosts be able to debounce or
   commit explicitly?
4. **Richer value results.** Should a value eval return lists and records (the interface grammar already types them),
   and should a single eval be able to return values, actions and UI together (below)?
5. **Placement.** Can an eval run on the server (SSR, or code that should never ship to the client)?
6. **Nesting.** Can evaluated code call `eval` itself, binding only its own names?

## Alternatives

- **One eval that returns a record.** The code is the body of an instantiating fn (RG-6): declarations, then a final
  expression such as `{ open, view: <div>…</div> }`, created once per code string. One eval could then expose a count,
  an action and its UI with shared state. It needs markup as a value (today a `View` arrives only through
  `props.children`) and a typed result on the left (`list: { open: number, view: View } = eval(…)`). It could be added
  on top of the two forms later.
- **JSON UI specs.** Safe and simple, but no logic, no local state and no async, so every new behaviour needs a new
  component in the host.
- **`new Function` or `import()` of generated JS.** Full power, but no checking, ambient scope, and nothing stops writes
  to host state.
- **Sandboxed iframe or worker.** Real isolation, but state is copied across a message boundary, so it doesn't share
  reactivity with the app.

## Prototype

Both forms are built on the `solid-model` branch of devagrawal09/reactivescript, specified in `frontend/docs/EVAL.md`.

- RX and TSX syntax for the call and for the code (`syntax: "tsx"`), lowered to one plan.
- The interface derived by the checker, read-only bindings, fail-closed typed refusals, and async code through `pure`
  host bindings with `loading`/`errored`.
- Code compiles at run time to a plan, which runs on Solid 2's own primitives in JS and on a Rust port of the runtime.
  RX code compiles in the browser. TSX-syntax code can't, because its parser (Oxc) is a native module, so a page
  that takes TSX code needs a server to compile it to a plan first.
- A local demo app posts code to an endpoint and renders the result on a page, using exactly these forms. The three
  examples above compile with the prototype's checker as written (only the `"..."` placeholders are left out).
- **Checked against native Solid 2 (rc.21):** two slices whose code strings change while requests are pending, and a
  differential fuzz that turns each generated program into evaluated code. On seeds 1..3000 (2,000 of them held out),
  every program that compiles gives native Solid's frames and full host log on every leg, with 0 divergences. The
  async fuzz gives the same: 0 divergences on seeds 1..3000. The rest are refused with the same diagnostic as the same
  program written statically.
- Not built: `preserve`, server placement, record results, and refusals caught by `errored` on the Rust leg.

Upstream itself is unchanged. It would need the two site forms in the parser, a binding-reference fact in the checker
(CP-6), and a lowering in the compiler; the prototype adapts the code before checking instead.

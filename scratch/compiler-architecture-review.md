# Compiler architecture review

## Summary (under 3,500 characters)

**Verdict:** The direction is sound, but the table makes a staged research project look like four interchangeable backends. Keep the shared semantic work; start with one JavaScript path. Do not promise a stable, fully host-neutral IR or reusable Rust view backend yet.

**Top five issues**
1. **Host boundaries are semantic, not just syntactic.** Splitting files cannot establish host-call purity, types, dependencies, or portable value behavior. Generated declarations cannot be final before that work.
2. **Checker facts are not a complete backend contract.** Inventory which decisions each checker exposes. Do not move spelling-based guessing into a new IR pass.
3. **Solid's view compiler is a JavaScript compiler integration, not an existing universal view IR.** JSX is useful for JS; “universal” does not mean “any implementation language.” A structured/live/Rust interface is separate work.
4. **Live execution needs an explicit language boundary.** CSP-safe closure construction cannot execute arbitrary new JS or Rust host source. Host functions must already exist, or belong to a supported interpreted subset.
5. **Rust runtime parity is the critical path.** Async graph states, actions, transitions, disposal, errors, SSR, and hydration need semantic tests. Code generation cannot repair runtime differences.

**Architecture changes:** Use a dependency graph, not one pipeline. Add module/signature collection, host type checking, source provenance, and a client/server planning stage. Separate a small resolved reactive plan from host expression lowering. Lower views before final printing; retain the production Oxc AST handoff (the reference path uses JSX text). Separate language/runtime, renderer, deployment, and live/compiled choices.

**Build order:** (1) pin and test the current JS path; (2) make one decision flow from checker facts to emission; (3) introduce a private minimal reactive plan and compare behavior; (4) support one explicit host boundary plus diagnostics/types; (5) prove a small CSR live evaluator with registered host functions; (6) separately test Rust runtime behavior against JS; (7) attempt Rust compiled output only after that gate. Defer live Rust and a shared Solid view interface until evidence justifies them.

## Verified corrections after delayed source delivery

The delayed results arrived and confirmed this report was written. These points supersede any more tentative wording below:

- **Reference versus production handoff:** the reference path calls Solid's transform on each generated module, sets generate to universal/dom/ssr, enables hydration except for universal, and chooses the test string renderer for universal (reactivescript/ref/compile/jsx.ts:4–13). The production compiler contract instead requires an Oxc Program handoff to compile_program, not generated JSX text (reactivescript/spec/11-compiler.md:17–39; reactivescript/compiler/README.md:8). Preserve that distinction: do not introduce a text round trip into the production path merely to fit P5/P6.
- **Source spans can affect generated behavior.** The production design records that Solid's SSR props hoisting uses span order. It therefore uses lowered-layout spans and remaps them back to RX source (reactivescript/spec/11-compiler.md:48–62). Source provenance is a correctness issue, not merely nicer error messages. A new frontend must preserve this contract and test equivalent AST/text behavior where applicable.
- **The mode inventory was incomplete.** CP-1b includes dynamic alongside dom, ssr, and universal; hydratable is a separate choice (reactivescript/spec/11-compiler.md:23–28). Investigate dynamic before designing a fresh direct-construction backend. Do not equate a compiler's dynamic JS output with a no-eval evaluator or a Rust renderer plan.
- **Type projection already has mapping infrastructure.** project.rs describes matching TS/Rust projections and source mappings at lines 1–4; Mapping and Range are defined at lines 26–43. Reuse and compose those mappings through the frontends rather than describe all diagnostic support as missing.
- **Rust's 57.4% is not feature coverage.** It means 1,148 exact trace matches out of 2,000 generated programs; all 667 generated action programs fail. The runtime has no renderer. This supports a hard runtime-behavior gate, not a schedule estimate (rust-solid/docs/STATUS.md, Final result and Implemented sections; full excerpt in Appendix D).
- **Ryan's position is verified.** Issue #1 explicitly supports resolved facts and a small paired-test experiment, but not a stable shared IR or a second frontend commitment. It also says whole-program RX checks do not belong inside Solid's per-module transform. Keep the shared RX semantic layer outside Solid's frontend entry point.

### Further implementation checks

- The production handoff is verified in code: reactivescript/compiler/src/emit.rs:1706–1726 imports and calls compile_program. The intermediate target tree already exists: compiler/src/js.rs:1–2 describes the JS+JSX tree built by emit.rs and converted by oxc.rs. Therefore P4 is missing only in the proposed host-neutral/resolved sense; it would be misleading to say there is no intermediate representation at all. Reuse this JS target tree rather than replace it with another generic printer.
- Solid exposes compile_program in solid-next/packages/compiler/src/compiler.rs:246; Generate includes Universal and Dynamic at lines 21–22, and hydratable is a separate option at line 129. Its public AST entry has a dedicated integration test (packages/compiler/tests/compile_program.rs). The existing AST seam is stronger evidence than a proposed new string interface.
- CP-6's concrete vocabulary should drive the first plan: regions, symbols, computations and nesting; tracked/snapshot/pre reads; latest/pending probes; field reads; ordinary/path/optimistic/refresh/affects writes; resolved calls. See reactivescript/spec/11-compiler.md:182–208. In particular, preserve snapshot behavior for source seeds and value parameters, and the distinction between effect inputs and apply. These are better first acceptance tests than a broad abstract effect enum.
- Existing differential testing already includes native Solid universal output alongside compiled TSX/RX and interpreted TSX/RX (frontend/docs/FUZZ.md:25–26). Credit and extend that harness; do not assume it is only a same-emitter AST comparison. Check whether the interpreted legs use the proposed real-Solid runtime before treating them as the finished JS-live target.
- Rust runtime gate citations are precise: rust-solid/docs/STATUS.md:10 gives the match rate, line 24 records all 667 action cases failing, and line 39 says no renderer was added.

### One omitted seam: styles

The architecture should account for scoped styles, not only markup. CP-1d describes a separate compile_style interface using structured Element values, independent of the TSRX/Oxc frontend (reactivescript/spec/11-compiler.md:64 onward); CP-7 records that RX feeds view elements to it (lines 218–220). Reusing this existing analysis seam may be a smaller and more realistic shared step than extracting an entire view IR. Preserve scope IDs, generated attributes, CSS assets and server/client agreement through live and compiled paths. Confirm the exact exported API in the pinned Solid version before depending on it.

### Final verified pipeline details

**Production:** RX AST → JS/JSX target tree (compiler/src/js.rs:1–2) → Oxc Program (compiler/src/emit.rs:1708–1712) → Solid compile_program (emit.rs:1726) → generated JS plus source map. **Reference:** generated module strings → transform with target/hydration options → returned code (ref/compile/jsx.ts:9–13). The proposal should show both rather than label all existing JS emission “print JS+JSX.”

Solid's CompileOutput explicitly contains code, source_map, css, and css_hash (solid-next/packages/compiler/src/compiler.rs:193–200). Its AST entry says syntax selection is not consulted, spans are not rewritten, CSS fields are absent, and callers must use the same Oxc release (lines 240–245). It checks that source equals program.source_text (lines 257–260). These are concrete integration constraints, including another version pin. Scoped-style output must remain a separate seam for this route. Dynamic uses an AST transform (lines 381–394); the inspected API returns generated code, not a live closure/tree result.

RX's current target switch selects only Universal/Dom/Ssr and enables hydration except for Universal (reactivescript/compiler/src/emit.rs:1715–1722). Thus “Solid supports dynamic” does not mean “RX currently exposes dynamic.” Keep those claims separate.

The proposed emitter criticism is verified: ref/compile/emit.ts:435 re-infers action behavior; line 436 checks for await; line 465 implements hasAwait using JSON.stringify and a substring test. A structured, scope-aware analysis is preferable. First establish exactly what each caller needs: an await somewhere in a subtree is not necessarily an await in the enclosing execution scope. Replace each heuristic with the correct decision, not merely a cached version of the same scan.

The frontend fuzzer is already a strong baseline, but not a perfect interpreter oracle. frontend/docs/FUZZ.md:37–42 records 179/200 agreement across all five legs and 21 interpreter-versus-compiled differences, with no adapter or native-versus-compiled differences in that fixed sample. Preserve this distinction and the documented pins. A new live target should be compared with native/compiled behavior on the common subset; do not copy the interpreter's known differences or relabel its allowlist as successful parity. The generated subset and constraints are documented at lines 8–21.

A live evaluator is also a new runtime layer. CP-6 facts are compile-time only (reactivescript/spec/11-compiler.md:180), and Ryan's comment preserves the compiled language's “nothing beyond Solid” runtime goal. Keep the live evaluator as an explicit optional target/tooling layer; do not imply its plan interpreter is already part of that upstream runtime contract.

## 1. Scope and evidence

> **Verification scope:** Initial source delivery was delayed. The verified corrections above reflect the results subsequently inspected. Appendix search matches are supporting evidence, not an exhaustive code audit; claims about missing APIs or absence of features remain deliberately limited.


This is a design review, not an implementation change. Source paths are relative to /Users/devagr/rx-tsx-refresh. Appendix A records exact file:line search matches from this checkout. Isolated matches are entry points, not proof of an entire feature; recommendations below distinguish proposed contracts from existing guarantees.

RX checkout and pre-existing working-tree state:

```text
fdbcad921c6bc1cae59cbebe9905eeabc480e88f
```

CP-6 frames resolution facts as checker decisions to consume during lowering, not a stable shared IR or a promise of another frontend. CP-8/type projection belongs in the architecture, not a tooling footnote. `reactivescript/spec/11-compiler.md:95`, `reactivescript/spec/11-compiler.md:96`, `reactivescript/spec/11-compiler.md:175` [E1]

The TS and Rust implementations need separate audits. “Shared checker” should mean a shared language contract, not imply that two implementations are one. Confirm fact coverage in both before P4 depends on it. `reactivescript/compiler/src/model.rs:1`, `reactivescript/compiler/src/emit.rs:3`, `reactivescript/compiler/src/emit.rs:163` [E4] [E8: verification gap; no matching evidence]

### View handoff: preserve the real boundary

RX's reference JS integration is ref/compile/jsx.ts, including lowerViews. The actual calls/options are recorded in E2; Solid's API/options are in E5. The useful boundary is emitted JavaScript/JSX into Solid's JavaScript view transformation, then generated JavaScript into the build. It is not RX AST or a host-neutral reactive program entering Solid. `reactivescript/ref/compile/jsx.ts:1`, `reactivescript/ref/compile/jsx.ts:2`, `reactivescript/ref/compile/jsx.ts:4` [E2] `solid-next/packages/compiler/src/dom/spread.rs:30`, `solid-next/packages/compiler/src/dom/spread.rs:31`, `solid-next/packages/compiler/src/dom/spread.rs:32` [E5]

Do not treat dom, ssr, universal, and hydratable as four interchangeable targets. Distinguish rendering modes from hydration configuration and check supported combinations against the pinned API. “Universal” concerns a renderer interface in generated JS; it does not by itself provide Rust output, an executable view tree, or a live-evaluator plan. A compiler implemented in Rust is not a compiler that emits Rust.

Trace the Rust RX CLI/application route separately. A TypeScript helper does not establish the route for every entry point. E4/E7 locate integration points; the baseline documentation should record the actual calls and options for the route used. `reactivescript/compiler/src/app.rs:1`, `reactivescript/compiler/src/app.rs:2`, `reactivescript/compiler/src/app.rs:3` [E7]

## 2. Pass boundaries

### P0: parsing is fine; provenance starts here

Keep parsing frontend-specific. Every node needs an origin: file, range, and expansion/lowering history. Preserve host source/trivia where host modules will be retained. Source maps are not an emitter-only feature. Rust macros need an error-location policy for both embedded syntax and generated Rust.

### P1: collect declarations and discover boundaries

P1 can collect imports/exports, reactive roots, host fragments, explicit boundaries, and locations. It cannot settle these by syntax alone:

- whether a host function is safe in a memo or markup;
- what reactive values it captures or reads;
- its inferred public host signature;
- client/server placement;
- whether its values and operations have a Rust equivalent.

Use an explicit boundary for the first mixed-file prototype. Keep host code intact and refer to it by symbol. Preliminary signatures may be useful, but finalize generated .d.rx after resolution/type checking. Avoid a second uncontrolled type-inference engine in the splitter.

Yield's attempt() is a promising explicit boundary, not a purity certificate. Its callback can capture mutable state, do IO, or return host-specific objects. Define capture, exception, async, and lifetime behavior; inspect the current syntax before expanding its meaning. `frontend/yield/lower.ts:5`, `frontend/yield/lower.ts:8`, `frontend/yield/lower.ts:9` [E12] `frontend/docs/YIELD.md:21`, `frontend/docs/YIELD.md:43`, `frontend/docs/YIELD.md:44` [E13]

A Rust rx::component! macro needs a bridge contract for names, types, captures, ownership, and effects. Having Rust host functions in lexical scope does not automatically give the RX checker their Rust types. Check the actual macro-expansion/type-checking order before requiring early RX passes to know every host type.

### P2: normalize syntax and report syntax refusals

Separate P2 is useful for tests/adapters; P1/P2 need not be separate traversals. Reject unsupported syntax here with original source locations. Reject unresolved symbols, impure calls, host-type mismatches, and target capability gaps later, when the information exists.

The current frontends' RX AST lowering is a useful seam, not a stable upstream promise. Keep a small version adapter around it. `frontend/tsx/lower.ts:3`, `frontend/tsx/lower.ts:9`, `frontend/tsx/lower.ts:17` [E11] `frontend/yield/lower.ts:5`, `frontend/yield/lower.ts:8`, `frontend/yield/lower.ts:9` [E12]

### P3: expose several checks, not one black box

Represent these dependencies explicitly:

1. Module graph and public signatures, including host declarations and the selected prelude.
2. RX binding resolution and semantic checks.
3. Host type checking/projection, with errors mapped to the frontend source.
4. Finalized resolution facts and boundary checks.

These may overlap or need two phases across imports. Explicit signatures can break cycles cheaply; do not assume either a single pass or a general fixed-point solver. TypeScript projection is an existing mechanism to build on. Calling the RX checker is not a replacement. Inspect the projected subset and error mapping before claiming complete type checking. `reactivescript/compiler/src/project.rs:1`, `reactivescript/compiler/src/project.rs:4`, `reactivescript/compiler/src/project.rs:10` [E6] `reactivescript/spec/11-compiler.md:95`, `reactivescript/spec/11-compiler.md:96`, `reactivescript/spec/11-compiler.md:175` [E1]

Type correctness, reactive safety, and host effect safety are different results. A well-typed host function can still mutate globals or read time.

### P4: small private resolved reactive plan

P4 is the right place to stop backends rediscovering reactive meaning. It does not yet justify a large general-purpose IR. Start with the smallest plan that eliminates one duplicated decision in current emission. E3 identifies scan/inference sites; inspect Rust independently. `reactivescript/ref/compile/emit.ts:9`, `reactivescript/ref/compile/emit.ts:29`, `reactivescript/ref/compile/emit.ts:90` [E3] `reactivescript/compiler/src/model.rs:1`, `reactivescript/compiler/src/emit.rs:3`, `reactivescript/compiler/src/emit.rs:163` [E4]

AST-to-JS emission is not inherently a flaw. Repeating semantic recognition is the flaw. A resolved AST plus complete facts can be the first good design. Do not add an IR just to make the diagram symmetric.

### Add deployment planning after resolution

Host/reactive separation and server/client separation are different. Plan server-function identities/stubs, transport codecs, environment availability, reachable code, and server/client view entries after symbol resolution. This can be an application-build phase rather than a mandatory step for a standalone pure module.

SSR and hydration need paired metadata and deterministic identities. Independently valid server and browser programs can still fail to hydrate together. Server functions, SSR, hydration, and server components are distinct features; none proves the others exist. Use the actual RX contracts. `reactivescript/spec/10-server.md:1`, `reactivescript/spec/10-server.md:3`, `reactivescript/spec/10-server.md:5` [E9] `reactivescript/spec/12-server-functions.md:4`, `reactivescript/spec/12-server-functions.md:156`, `reactivescript/spec/12-server-functions.md:160` [E10] `reactivescript/compiler/src/app.rs:1`, `reactivescript/compiler/src/app.rs:2`, `reactivescript/compiler/src/app.rs:3` [E7]

### P5/P6: keep logical boundaries; move final printing

Prefer:

**resolved reactive plan → target program with view nodes → target view lowering → final print/link/map**.

The reference JS adapter can keep printing JSX and letting Solid reparse it. The production Rust path should retain its direct Oxc Program handoff; these are distinct integrations. Do not require that text round trip for Rust/live execution, or call a print step “final” before another compiler rewrites its output.

Solid may depend on JS expression shape. The adapter must preserve accessor shape, evaluation timing, tracking boundaries, and control flow. Being “JSX-shaped” is necessary for that route, not enough to guarantee equivalent behavior.

## 3. What P4 should contain

### Start with decisions downstream actually needs

- Module, declaration, and binding identities; resolved imports/exports; runtime/prelude requirements.
- Reactive operations with explicit meanings: reads/writes, derivations, effects, actions, batching/transition boundaries, async behavior, where the language distinguishes them.
- Resolved reference/call categories and evaluation order. No downstream recognition of source names to recover meaning.
- Ownership/disposal/cleanup scopes where the language establishes them. Keep target-specific Rust lifetimes out of the common plan.
- Expressions with defined RX operations, or explicitly host-tagged expression nodes with a target capability requirement.
- Structured views: tags/components/fragments, props/spreads, children, events/refs, dynamic slots, and identity/control-flow metadata where needed.
- Source origins and structured diagnostic references.
- Supported-capability information so unsupported targets fail clearly.

Do not copy every inferred detail onto every node. Reference an owned resolution record by node/binding ID, or materialize only decisions lowering needs. Facts must stay tied to the AST and version that produced them.

### Relationship to CP-6

Derive the plan from checker decisions; retain origin/fact references for debugging. Do not hand each backend an unresolved AST plus a bag of facts to interpret differently. A backend should consume a resolved call category, not inspect the callee spelling.

Do not assume CP-6 already provides every desired field. Write a decision inventory: producer, consumer, missing cases, parity tests. For repeated await scans/action inference, determine whether the checker already knows the answer or needs a new fact. A small upstream fact is a better first change than a stable multi-language schema. `reactivescript/spec/11-compiler.md:95`, `reactivescript/spec/11-compiler.md:96`, `reactivescript/spec/11-compiler.md:175` [E1] `reactivescript/ref/compile/emit.ts:9`, `reactivescript/ref/compile/emit.ts:29`, `reactivescript/ref/compile/emit.ts:90` [E3]

### Host neutrality: make two different promises

Portable RX semantics and arbitrary host expressions are separate contracts. Define the portable subset deliberately: numeric behavior, equality, truthiness, strings, missing/null values, collections, mutation/object identity, exceptions/errors, calls, function identity, and evaluation order. Rust integers, ownership, optional values, and borrowing are not translations of arbitrary JS behavior.

Raw JS inside an “opaque neutral expression” node remains a JS host island. Either implement the RX operation on each host, refuse the target with a useful error, or require target-specific implementations behind one declared interface.

Use host-specific preludes with types, effects/allowed contexts, and runtime implementations. Test equality used to suppress reactive updates: changing that rule changes observable behavior even when final values match.

## 4. Views and target feasibility

| Target | First realistic route | Gate/new work |
|---|---|---|
| JS compiled | Production: JS/JSX target tree → Oxc Program → Solid; reference: JSX text → transform | Preserve AST seam/mappings; separate CSR and SSR/hydration tests |
| JS live | Restricted plan → evaluator-created closures → real Solid primitives and direct renderer operations | Host registry; expression subset; scopes/disposal; live views |
| Rust compiled | Portable plan subset → Rust runtime calls + Rust view adapter | Runtime semantics; ownership/value bridge; renderer |
| Rust live | Restricted plan evaluated with precompiled Rust host functions | Not arbitrary Rust source; capture/lifetime design; likely last |

These are not four interchangeable P5 functions. Separate language/runtime, compiled/live, renderer, and deployment axes. Live CSR support says nothing about live SSR/hydration.

### Reusing Solid

Reuse Solid's existing JS compiler first. Reusing its view analysis for another consumer is plausible research, not an interface to depend on today. First identify a small result independent of JS AST construction, runtime imports, DOM APIs, and closure shape; then demonstrate two consumers.

A shared view plan may need static shape, dynamic slots and evaluation rules, insert/update operations, event/ref hooks, boundaries, and SSR/hydration metadata. That is much more than an element tree. Extracting it may cost more than a small separate Rust adapter.

For live JS, h() is not enough unless its contract includes tracking, updates, cleanup, events, refs, context, keyed identity, and boundaries. Compare it with compiled behavior. Start CSR-only and state omissions. Template cloning is an optimization after correct construction and updates.

### CSP-safe live execution

Creating closures that interpret a known plan can avoid eval. Compiling newly supplied arbitrary host JS source into native closures is not magically available under that constraint. Bind host calls to already compiled/bundled functions through a registry. Treat source-entered expressions as the evaluator's restricted language.

For Rust, Box<dyn Fn> is a storage choice, not a design. Stateful captures may require other closure traits/interior mutability; lifetimes, disposal, thread affinity, and async ownership must match the runtime. The live evaluator cannot execute arbitrary new Rust source without another compiler/JIT/interpreter.

“No eval” is also not a sandbox. Registered host functions can still expose network, filesystem, or secrets. If input is untrusted, permissions/capabilities are separate work.

## 5. Missing system concerns

### Modules/builds

Define module identity and initialization order, cycles, exported signatures, separate compilation, and host/reactive dependencies. Generated imports must not run a module twice. Include RX/frontend/Solid/runtime versions and lowering options in cache keys.

Generated declarations need provenance. Distinguish authored boundary contracts from inferred output. Cross-language implementations need compatible interfaces, not just matching names.

### Diagnostics, source maps, incremental/LSP use

Every pass accepts source identity and returns structured errors. Preserve mappings across frontend normalization, host projections, JS/Rust emission, Solid transformation, and bundling. Show original user code, not only temporary JSX or Rust.

Editor checks need partial/erroneous programs and must not require successful emission or a renderer. Use per-module artifacts/queries and explicit dependencies. Stable IDs/invalidation are useful; one giant resolved-app object as the only interface is not.

### Host effects and boundaries

Start with a small explicit effect contract: pure computation, tracked reactive reads, writes, async work, IO, and allowed execution phases. “Does not write” is not enough for memo safety: time, randomness, IO, and mutable host reads can invalidate caching.

Define error conversion, cancellation/disposal, pending values, ownership, and transport eligibility at boundaries. Client-only operations in SSR need placement rules or errors, not accidental runtime failures.

### Server functions and SSR

Test stable function identities, argument/result codecs, error transport, validation/auth integration, and exclusion of server-only dependencies from browser bundles. Do not serialize arbitrary closures/host objects. The existing server/SSR specs are starting contracts, not a server-component architecture. This review does not claim an exhaustive proof of absence of experiments across either repository. `reactivescript/spec/10-server.md:1`, `reactivescript/spec/10-server.md:3`, `reactivescript/spec/10-server.md:5` [E9] `reactivescript/spec/12-server-functions.md:4`, `reactivescript/spec/12-server-functions.md:156`, `reactivescript/spec/12-server-functions.md:160` [E10]

## 6. Risks and safeguards

1. **Internal AST churn:** small adapters, pinned revisions, schema/lowering tests. CP-6 is not a stable frontend API; do not ask upstream to freeze it prematurely.
2. **Checker drift:** compare resolved decisions and errors between implementations, not just AST serialization. Version facts with their producer.
3. **Runtime drift:** compare traces of updates, effect order, batching, errors, pending/resolved transitions, disposal, and cleanup. Final values miss bugs.
4. **Rust async model:** treat the status document as a gate, not a percentage-based schedule. Simultaneous graph views cannot be deferred to a compiler or renderer. State honestly if an early subset excludes async/actions. `rust-solid/docs/STATUS.md:3`, `rust-solid/docs/STATUS.md:19`, `rust-solid/docs/STATUS.md:20` [E15]
5. **Solid churn:** pin options and maintain compatibility tests for JSX shape, events, component props, control flow, escaping, and hydration identity.
6. **Common-mode fuzzing:** the existing five-leg harness already includes native Solid, compiled TSX/RX, and interpreted TSX/RX. Reuse it. Some legs can still share bugs or omit cases; expand coverage and independently check spec edge cases before claiming complete runtime parity. `frontend/docs/FUZZ.md:3`, `frontend/docs/FUZZ.md:21`, `frontend/docs/FUZZ.md:25` [E14]
7. **IR scope creep:** each neutral operation has a portability cost. Prefer explicit refusal to silent approximation. Delay optimization until evaluation order/effects are firm.

## 7. Build order and acceptance gates

### 0 — Freeze a tested baseline

Record exact revisions and compile commands. Trace reference TS and Rust CLI routes separately. Build a small corpus for bindings, actions, async, views, SSR, and hydration where supported. Record refusals. Gate: repeatable existing JS behavior.

### 1 — Remove one semantic re-derivation

Choose an actual emitter decision. Supply it from checker facts; test aliases, shadowing, and equivalent syntax. Gate: no emitter spelling/shape heuristic for that decision, unchanged supported behavior, parity in the checker implementations used.

### 2 — Introduce the smallest private plan

Add a narrow seam behind the JS backend; retain existing expression/view structures where practical. Compare output and behavior. Gate: a real simplification or removed duplication. If resolved AST plus facts is sufficient, stop there.

### 3 — One explicit host/reactive boundary

Preserve host code, require explicit host signatures/effects where needed, map errors to original source, and prove imports/projection. Gate: invalid host calls are rejected for the right reason at the right source location. Do not start by extracting arbitrary functions from arbitrary mixed files.

### 4 — Small JS-live CSR proof

Use registered precompiled hosts and real Solid primitives. Begin with simple expressions, state, derivations, a small view subset, and disposal. Compare traces with compiled JS. Add actions, async, control flow, and boundaries separately. Gate: a restricted but honest no-eval path.

### 5 — Rust runtime feasibility, separately

Build cross-runtime behavior tests before a Rust backend. Cover ownership/disposal, then action/transition/async semantics. Runtime-only work can run in parallel without blocking JS improvements. Gate: a clearly documented subset with matching observable behavior.

### 6 — Rust compiled subset

Compile only the proven portable subset. First test runtime operations and host ownership boundaries, then a small renderer adapter. Gate: generated Rust compiles and matches the stated JS/RX contract.

### 7 — Shared view analysis and Rust live, only if justified

Compare extraction of Solid analysis with a small separate adapter. Request structured output with a running example and clear consumer. Rust live follows a proven plan/value model and runtime; neither is needed to justify steps 0–4.

## 8. Ownership and what to ask Ryan

**RX upstream:** authoritative facts; removal of semantic re-inference; focused mapping/diagnostic improvements; projection/server-contract fixes; semantic tests. Offer changes useful to today's compiler without demanding a stable IR.

**Our frontend repo:** syntax/refusals, origin maps, explicit host-boundary experiments, version adapters, differential tests, and initially the private plan/live evaluator. Avoid duplicating RX semantics just to avoid every upstream AST change.

**Our Rust runtime repo:** runtime behavior, ownership/disposal, async/action/transition model, renderer contract. Compilation follows proven capability.

**Solid upstream, later:** one concrete analysis seam backed by a prototype and measured need, not a request for universal Rust/live output.

Useful first question: “Can we add this specific resolved fact and make the existing emitter consume it, with these tests?” Not: “Will you commit to our stable shared IR for multiple frontends and four targets?” CP-6 explains the distinction. `reactivescript/spec/11-compiler.md:95`, `reactivescript/spec/11-compiler.md:96`, `reactivescript/spec/11-compiler.md:175` [E1]

## 9. What I would fundamentally change

Draw three cooperating layers rather than a uniform pass conveyor:

1. **Frontend + host integration:** source, signatures/scopes, origin maps, projections, explicit boundaries.
2. **RX semantics:** resolution/facts and a small private reactive plan with capability checks.
3. **Target application build:** deployment planning, runtime lowering, view lowering, final output/maps.

Maintain one production route and gated experiments. Success is not fitting all four targets into a table. It is one authoritative owner for each semantic decision, clear failure for unsupported cases, and reuse that does not change program meaning.

## Appendix A — Exact source evidence

Matching lines below are recorded verbatim. Paths are relative to /Users/devagr/rx-tsx-refresh. Some are declarations/search entry points rather than complete proofs; inspect surrounding code before changing a contract. API searches are not an exhaustive proof of absence of other modes.

### E1 — Compiler specification

- `reactivescript/spec/11-compiler.md:95` — runtime compilation moved off text projection ("no generated Solid-JSX
- `reactivescript/spec/11-compiler.md:96` — text is parsed", `frontend-notes.md`) because a projection loses
- `reactivescript/spec/11-compiler.md:175` — ## CP-6 — The resolved model (between check and lower)
- `reactivescript/spec/11-compiler.md:178` — here.** The checker's resolution, kept as facts, so that lowering (and any
- `reactivescript/spec/11-compiler.md:179` — other analysis) reads what the checker decided instead of recognising source
- `reactivescript/spec/11-compiler.md:182` — - **CP-6a (the facts).** Per module: its *regions* (03: the program, each
- `reactivescript/spec/11-compiler.md:194` — - **CP-6b (read modes).** A read of a source, equation, props or context
- `reactivescript/spec/11-compiler.md:200` — - **CP-6c (writes and calls).** A write is `x := e` (W-1, with whether it
- `reactivescript/spec/11-compiler.md:204` — - **CP-6d (one walk, two implementations).** The facts are recorded by the
- `reactivescript/spec/11-compiler.md:209` — - **CP-6e (not a format).** No one outside the crate depends on it: it is
- `reactivescript/spec/11-compiler.md:210` — not a stable IR and not a commitment to a second front end (issue #1).
- `reactivescript/spec/11-compiler.md:216` — module, check and signature stages and CP-6's model, a port of
- `reactivescript/spec/11-compiler.md:265` — ## CP-8 — Spans and the projection (for editors)
- `reactivescript/spec/11-compiler.md:268` — An editor's features are TypeScript's, asked of the TSX projection (13
- `reactivescript/spec/11-compiler.md:269` — TY-1c), so every position has to cross between `.rx` and the projection.
- `reactivescript/spec/11-compiler.md:271` — - **CP-8a (spans).** The crate's AST records the byte range each node was
- `reactivescript/spec/11-compiler.md:277` — - **CP-8b (what a span promises).** Inside the source and inside its
- `reactivescript/spec/11-compiler.md:282` — - **CP-8c (the projection).** The crate projects a checked program as
- `reactivescript/spec/11-compiler.md:284` — records mappings: a piece of the projection that is a piece of the `.rx`,
- `reactivescript/spec/11-compiler.md:286` — tag and attribute the projection copies. `rxc project app.rx` prints the

### E2 — RX view handoff

- `reactivescript/ref/compile/jsx.ts:1` — // Views are JSX; Solid's own compiler (@solidjs/compiler, from the next branch) lowers them for each target, so the
- `reactivescript/ref/compile/jsx.ts:2` — // DOM, the server and the test renderer run exactly the code shape Solid's compiler emits — hydration keys, marker
- `reactivescript/ref/compile/jsx.ts:4` — import { transform } from "@solidjs/compiler";
- `reactivescript/ref/compile/jsx.ts:5` — import { fileURLToPath } from "node:url";
- `reactivescript/ref/compile/jsx.ts:6` — export type Target = "universal" | "dom" | "ssr";
- `reactivescript/ref/compile/jsx.ts:7` — export const STRING_RENDERER = fileURLToPath(new URL("./string-renderer.ts", import.meta.url));
- `reactivescript/ref/compile/jsx.ts:8` — /** Each module's JSX → JavaScript for `target` (dom and ssr with hydration; universal over the test renderer). */
- `reactivescript/ref/compile/jsx.ts:9` — export function lowerViews(files: Map<string, string>, target: Target): Map<string, string> {
- `reactivescript/ref/compile/jsx.ts:12` — const r = transform(code, { filename: name.replace(/\.mjs$/, ".jsx"), generate: target, hydratable: target !== "universal", moduleName: target === "universal" ? STRING_RENDERER : "@solidjs/web" });

### E3 — TypeScript emitter

- `reactivescript/ref/compile/emit.ts:9` — import { inferredAction } from "../src/infer.ts";
- `reactivescript/ref/compile/emit.ts:29` — const J = (v: unknown) => v === undefined ? "undefined" : JSON.stringify(v);
- `reactivescript/ref/compile/emit.ts:90` — export function compileDynamic(stmts: Stmt[]): string { const g = new Gen(usage({ decls: [], view: [] }, [stmts])); const env = new Env(null); return inferredAction(stmts) ? g.stmts([{ k: "action", body: stmts }], env, { imp: true, dyn: true }, 0) : g.stmts(stmts, env, { imp: true, dyn: true }, 0); }   // AC-1b: a handler row is a handler's body
- `reactivescript/ref/compile/emit.ts:161` — case "action": return { kind: "act", js: mg(alias) };
- `reactivescript/ref/compile/emit.ts:171` — case "action": return { kind: "act", js };
- `reactivescript/ref/compile/emit.ts:239` — if (d.k === "action") env.vars.set(d.name, { kind: "act", js: mg(d.name) });
- `reactivescript/ref/compile/emit.ts:255` — // hoisted to module level (SF-7a), throws the class an action's catch tests
- `reactivescript/ref/compile/emit.ts:262` — for (const d of decls) if (d.k === "action") out.push(`${pad}const ${mg(d.name)} = __rt.action(function* (${d.params.map(mg).join(", ")}) {\n${this.stmts(d.body, this.params(env, d.params), { imp: true, gen: true }, ind + 1)}\n${pad}});\n${pad}__rt.reg(${J(d.name)}, { value: ${mg(d.name)} });`);
- `reactivescript/ref/compile/emit.ts:417` — if (ctx.imp && this.hasAwait(e.e)) throw new CompileError("`await … catch` inside an expression of imperative scope (AWAIT_IN_EXPRESSION, AC-1)");
- `reactivescript/ref/compile/emit.ts:435` — if (e.stmts && inferredAction(e.stmts)) return `(${ps}) => __rt.action(function* () {\n${this.stmts(e.stmts, inner, { imp: true, gen: true, dyn: ctx.dyn, effect: ctx.effect }, 1)}\n})()`;   // AC-1b: an inferred action lowers as `action { … }` does, to Solid's action()
- `reactivescript/ref/compile/emit.ts:436` — if (e.stmts) { const async = this.hasAwait(e.stmts); return `${async ? "async " : ""}(${ps}) => {\n${this.stmts(e.stmts, inner, { imp: true, async, dyn: ctx.dyn, effect: ctx.effect }, 0)}\n}`; }
- `reactivescript/ref/compile/emit.ts:465` — private hasAwait(ss: unknown): boolean { const s = JSON.stringify(ss); return s.includes('"k":"await"'); }
- `reactivescript/ref/compile/emit.ts:499` — case "action": out.push(`${pad}__rt.action(function* () {\n${this.stmts(s.body, env, { imp: true, gen: true, dyn: ctx.dyn }, ind + 1)}\n${pad}})();`); break;

### E4 — Rust compiler facts and emission

- `reactivescript/compiler/src/model.rs:1` — //! The resolved model (spec/11 CP-6, issue #1): what the checker resolved, as facts a lowering or another analysis consumes
- `reactivescript/compiler/src/emit.rs:3` — //! target (`lower_views`, CP-1b). Lexical scopes become JS scopes: every region is a JS function, every declaration a
- `reactivescript/compiler/src/emit.rs:163` — fn has_await_json(v: &Value) -> bool {
- `reactivescript/compiler/src/emit.rs:199` — if let Decl::Import { resolved: Some(r), .. } = d {
- `reactivescript/compiler/src/emit.rs:340` — if let Decl::Import { resolved: None, from, names, .. } = d {
- `reactivescript/compiler/src/emit.rs:364` — let found = self.mod_decls.iter().any(|d| matches!(d, Decl::Import { resolved: None, from, names, .. } if !from.starts_with('.') && names.iter().any(|n| &n.alias == fname)));
- `reactivescript/compiler/src/emit.rs:400` — Decl::Import { resolved: None, names, from, declared_errors, .. } => {
- `reactivescript/compiler/src/emit.rs:579` — let Decl::Import { resolved: Some(r), names, .. } = d else { continue };
- `reactivescript/compiler/src/emit.rs:604` — Decl::Import { resolved: Some(_), .. } => {}
- `reactivescript/compiler/src/emit.rs:638` — let Decl::Import { resolved: None, names, from, declared_errors, .. } = d else { continue };
- `reactivescript/compiler/src/emit.rs:1203` — if ctx.imp && has_await_json(&x.to_json()) {
- `reactivescript/compiler/src/emit.rs:1292` — let is_async = has_await_json(&Value::Array(ss.iter().map(|s| s.to_json()).collect()));
- `reactivescript/compiler/src/check.rs:3` — //! resolve through the static application tree (RG-7b). The walk also records the resolved model (CP-6, `model.rs`).
- `reactivescript/compiler/src/check.rs:1079` — if matches!(d, Decl::Import { resolved: Some(_), .. }) {
- `reactivescript/compiler/src/check.rs:1084` — if matches!(d, Decl::Import { resolved: Some(_), .. } | Decl::Import { declared: Some(_), .. }) {
- `reactivescript/compiler/src/check.rs:1273` — let Decl::Import { names, from, pure, line, fails, resolved, .. } = d else { return };
- `reactivescript/compiler/src/check.rs:1277` — let sig = sigs.get(resolved.as_ref().unwrap());

### E5 — Solid compiler API and modes

- `solid-next/packages/compiler/src/dom/spread.rs:30` — // compile time; hydratable roots must replay events (Babel parity).
- `solid-next/packages/compiler/src/dom/spread.rs:31` — if self.hydratable {
- `solid-next/packages/compiler/src/dom/spread.rs:32` — self.has_hydratable_event = true;
- `solid-next/packages/compiler/src/dom/attrs.rs:85` — /// No output at all (`attr={false}`, empty `prop:`, hydratable-only
- `solid-next/packages/compiler/src/dom/attrs.rs:266` — if self.hydratable && plan.key == "$ServerOnly" {
- `solid-next/packages/compiler/src/dom/children.rs:70` — let per_slot = !self.hydratable && self.dynamic_slot_count(&element.children) > 1;
- `solid-next/packages/compiler/src/dom/children.rs:74` — let html_tag_walk = self.hydratable && tag_name == "html";
- `solid-next/packages/compiler/src/dom/children.rs:187` — // In dev hydratable mode the walk validates the tag
- `solid-next/packages/compiler/src/dom/children.rs:276` — let shared_marker_name = if !self.hydratable
- `solid-next/packages/compiler/src/dom/children.rs:333` — && self.hydratable
- `solid-next/packages/compiler/src/dom/children.rs:377` — let value = if self.hydratable && self.classify().is_dynamic_child_slot(child) {
- `solid-next/packages/compiler/src/dom/children.rs:415` — /// child that ends the parent's template content. In hydratable mode any
- `solid-next/packages/compiler/src/dom/children.rs:423` — let per_slot_markers = !self.hydratable && self.dynamic_slot_count(children) > 1;
- `solid-next/packages/compiler/src/dom/children.rs:435` — let qualifies = self.hydratable
- `solid-next/packages/compiler/src/dom/children.rs:602` — if self.hydratable {
- `solid-next/packages/compiler/src/dom/children.rs:674` — // Babel: `markers = config.hydratable && multi` — a lone meaningful
- `solid-next/packages/compiler/src/dom/children.rs:857` — /// lookup for a direct child of a hydratable `<html>` element.
- `solid-next/packages/compiler/src/dom/children.rs:1019` — if !self.hydratable || !self.dev {
- `solid-next/packages/compiler/src/dom/set_attr.rs:12` — pub(crate) struct SetAttrOptions<'a> {
- `solid-next/packages/compiler/src/dom/set_attr.rs:123` — if self.hydratable {
- `solid-next/packages/compiler/src/dom/set_attr.rs:144` — // through the runtime in hydratable builds so the hydration claim
- `solid-next/packages/compiler/src/dom/set_attr.rs:148` — // `<select value>` always goes through it, hydratable or not: a
- `solid-next/packages/compiler/src/dom/set_attr.rs:155` — if (self.hydratable && (is_locked || namespace != Some("prop")))
- `solid-next/packages/compiler/src/dom/events.rs:26` — if self.hydratable {
- `solid-next/packages/compiler/src/dom/events.rs:27` — self.has_hydratable_event = true;
- `solid-next/packages/compiler/src/dom/element.rs:20` — pub(crate) hydratable: bool,
- `solid-next/packages/compiler/src/dom/element.rs:54` — /// (universal + dom renderer) mode that's the base universal module, not
- `solid-next/packages/compiler/src/dom/element.rs:58` — /// list are left as raw JSX for the driving universal transform to lower
- `solid-next/packages/compiler/src/dom/element.rs:92` — pub(crate) has_hydratable_event: bool,
- `solid-next/packages/compiler/src/dom/element.rs:105` — pub(crate) hydratable: bool,
- `solid-next/packages/compiler/src/dom/element.rs:107` — /// Dev DOM output (`dev` with `generate: "dom"`): stateful property
- `solid-next/packages/compiler/src/dom/element.rs:109` — /// assignment (Babel's `config.dev && config.generate === "dom"` in

### E6 — Type projection

- `reactivescript/compiler/src/project.rs:1` — //! TY-1 (spec/13), ported from `ref/types/project.ts`: a checked program projected to TSX that TypeScript checks, and that an
- `reactivescript/compiler/src/project.rs:4` — //! copies from the `.rx` is a mapping, generated offset to source offset, of text that is the same on both sides.
- `reactivescript/compiler/src/project.rs:10` — use indexmap::{IndexMap, IndexSet};
- `reactivescript/compiler/src/project.rs:16` — /// The helpers every projection imports (`__`), and the prelude's names (`len`, `map`, …): `ref/types/project.ts`'s PRELUDE.
- `reactivescript/compiler/src/project.rs:17` — pub const PRELUDE: &str = include_str!("prelude.ts");
- `reactivescript/compiler/src/project.rs:21` — const BUILTINS: [&str; 13] = ["len", "str", "map", "filter", "sum", "fail", "fetch", "every", "indexOf", "log", "until", "onSettled", "onFlush"];
- `reactivescript/compiler/src/project.rs:22` — fn builtin(n: &str) -> bool {
- `reactivescript/compiler/src/project.rs:26` — /// One mapping: `len` bytes at `gen` in the projection are the same text as `len` bytes at `src` in the `.rx`.
- `reactivescript/compiler/src/project.rs:28` — pub struct Mapping {
- `reactivescript/compiler/src/project.rs:29` — pub gen: u32,
- `reactivescript/compiler/src/project.rs:30` — pub src: u32,
- `reactivescript/compiler/src/project.rs:31` — pub len: u32,
- `reactivescript/compiler/src/project.rs:35` — /// expression, a statement, a declaration's line), not the same text. An editor maps through it what falls between
- `reactivescript/compiler/src/project.rs:36` — /// mappings (a type error on `(a + b)` starts at its parenthesis); it is listed innermost first.
- `reactivescript/compiler/src/project.rs:38` — pub struct Range {
- `reactivescript/compiler/src/project.rs:39` — pub gen: u32,
- `reactivescript/compiler/src/project.rs:40` — pub glen: u32,
- `reactivescript/compiler/src/project.rs:41` — pub src: u32,

### E7 — Application build

- `reactivescript/compiler/src/app.rs:1` — //! A program compiled for a bundler (spec/11 CP-4b): every module of the program `entry` starts, through Solid's
- `reactivescript/compiler/src/app.rs:2` — //! compiler for `target`, each importing its dependencies by `.rx` path, with the program's stylesheet. What `rxc app`
- `reactivescript/compiler/src/app.rs:3` — //! prints and the Node-API build (`src/node.rs`) returns to `@reactivescript/compiler/vite`.
- `reactivescript/compiler/src/app.rs:5` — use crate::emit::{compile_linked, lower_view, Target};
- `reactivescript/compiler/src/app.rs:27` — /// `spa`: a client-only build, checked under 08 CN-3d.
- `reactivescript/compiler/src/app.rs:40` — let out = compile_linked(&set, &[], true).map_err(|e| json!({ "error": format!("{entry}: not compiled: {}", e.0) }))?;
- `reactivescript/compiler/src/app.rs:45` — let l = lower_view(module, path, target, module_name, Some((path, &text))).map_err(|e| json!({ "error": e }))?;

### E8 — Checker facts

No matching lines returned. This is a verification gap, not evidence of absence.

### E9 — Server functions

- `reactivescript/spec/10-server.md:1` — # 10 — The server
- `reactivescript/spec/10-server.md:3` — **Status: OPEN (2026-10-24).** A program can be rendered on a server and
- `reactivescript/spec/10-server.md:5` — the server computes, what the browser shows while the stream arrives, what
- `reactivescript/spec/10-server.md:6` — crosses from server to client, how the client takes over, and what state a
- `reactivescript/spec/10-server.md:9` — hydratable), the reactive lowering over `ref/compile/rt-server.ts` and
- `reactivescript/spec/10-server.md:13` — browser. `S-server-1` covers what no other scenario does.
- `reactivescript/spec/10-server.md:15` — Rulings (2026-10-24): SSR is the client's mount, streamed; module state is
- `reactivescript/spec/10-server.md:16` — per request on the server; full hydration first (partial hydration later);
- `reactivescript/spec/10-server.md:17` — failures are sent to the client and panics are redacted. The rest is taken
- `reactivescript/spec/10-server.md:26` — the client would show at instant 0. A later chunk is a **landing** of a
- `reactivescript/spec/10-server.md:29` — goes through the client's frames for the mount and its landings, in
- `reactivescript/spec/10-server.md:32` — landings that reach the server within one flush arrive as one chunk, and
- `reactivescript/spec/10-server.md:34` — client would have shown the fallback first; the browser never does). The
- `reactivescript/spec/10-server.md:35` — browser never shows a frame the client would not show at some instant of
- `reactivescript/spec/10-server.md:40` — hole: it travels as data, and the client draws it when it takes over
- `reactivescript/spec/10-server.md:41` — (S-app-cart: the catalogue lands on the server, the browser keeps the
- `reactivescript/spec/10-server.md:42` — empty first paint, and the client draws the rows at hydration). That is
- `reactivescript/spec/10-server.md:46` — server that is the right behaviour — the page arrives complete, with no

### E10 — SSR/hydration

- `reactivescript/spec/12-server-functions.md:4` — questions (10 SV-7b) by S-server-3, on all four runners; after hydration
- `reactivescript/spec/12-server-functions.md:156` — directly inside the page's request event; after hydration — and on a
- `reactivescript/spec/12-server-functions.md:160` — body is in the browser bundle. (S-sf-1: four requests after hydration.)

### E11 — TSX lowering

- `frontend/tsx/lower.ts:3` — import {
- `frontend/tsx/lower.ts:9` — import {
- `frontend/tsx/lower.ts:17` — import { actionInference } from "./rx/infer.ts";
- `frontend/tsx/lower.ts:18` — import type { JsDecl } from "./rx/compiler.ts";
- `frontend/tsx/lower.ts:19` — import { decodeHTML } from "entities";
- `frontend/tsx/lower.ts:21` — export class TsxError extends Error {
- `frontend/tsx/lower.ts:27` — constructor(filename: string, source: string, span: Span, message: string) {
- `frontend/tsx/lower.ts:28` — const before = source.slice(0, span.start);
- `frontend/tsx/lower.ts:30` — const column = span.start - before.lastIndexOf("\n");
- `frontend/tsx/lower.ts:36` — this.start = span.start;
- `frontend/tsx/lower.ts:37` — this.end = span.end;
- `frontend/tsx/lower.ts:41` — export type LowerOptions = {
- `frontend/tsx/lower.ts:47` — import { verifySyntax } from "./subset.ts";
- `frontend/tsx/lower.ts:49` — export function lowerTsx(
- `frontend/tsx/lower.ts:59` — throw new TsxError(
- `frontend/tsx/lower.ts:120` — exported?: boolean;
- `frontend/tsx/lower.ts:304` — ): import("oxc-parser").ArrowFunctionExpression => {
- `frontend/tsx/lower.ts:335` — // async callback is refused at its async node, never lowered or silently converted to an action. This covers

### E12 — Yield lowering

- `frontend/yield/lower.ts:5` — // form is refused with its own diagnostic at its yield source. It reaches upstream only through tsx/rx/ and keeps
- `frontend/yield/lower.ts:8` — import { parseSync } from "oxc-parser/src-js/index";
- `frontend/yield/lower.ts:9` — import { decodeHTML } from "entities";
- `frontend/yield/lower.ts:10` — import { entryView, type Decl, type Expr, type Markup, type Program, type Stmt } from "../tsx/rx/ast.ts";
- `frontend/yield/lower.ts:11` — import { joinPath, parseDeclarations, parseProgram, type JsDecl, type ModuleSet } from "../tsx/rx/compiler.ts";
- `frontend/yield/lower.ts:24` — const SUBSET = new Set(["component", "view", "$signal", "$memo", "$event", "$optimistic", "$store", "attempt", "For", "Show"]);
- `frontend/yield/lower.ts:64` — const fail = (n: { start: number; end: number }, message: string): never => { throw new YieldError(filename, source, n, message); };
- `frontend/yield/lower.ts:83` — if (n.async) fail(n, "routines are function*, never async (solid-yield refuses async routines too)");
- `frontend/yield/lower.ts:101` — return fail(n, "after an attempt an event's read may see the value from before the call (solid-yield's transaction), where RX reads it as it stands after the wait: read before the attempt");
- `frontend/yield/lower.ts:133` — if (b.k === "waited") return fail(n, "after an attempt, read sources before the attempt");
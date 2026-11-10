import { action, affects, createMemo, createSignal, Errored, For, isPending, Loading, refresh, Show } from "solid-js";
import { assignIssue, loadIssues } from "./api";

// The async eval slice's static twin (docs/EVAL.md): every code string of eval-async.rx written statically as a native
// component, and each eval site as the keyed Show createEval is specified as. Compiled only by Solid's transform.
function evalTwin(code: () => string, pick: (code: string) => any) {
  return <Show when={code()} keyed>{(code: string) => pick(code)}</Show>;
}

export default function Board() {
  const [code, setCode] = createSignal("issues = await loadIssues();\nsource status := \"\";\naction take(id: number) {\n  affects issues;\n  try {\n    let who = await assignIssue(id);\n    refresh issues;\n    status := \"Assigned #\" + id + \" to \" + who;\n  } catch (error) {\n    status := \"Could not assign #\" + id;\n  }\n}\n<div>{errored fallback { <p>Could not load<button onClick={() => { refresh issues }}>retry</button></p> } { loading fallback { <i>Loading</i> } { <b>{pending? issues ? \"saving\" : \"ready\"}</b>{for issue in issues { <p>{issue.title}: {issue.owner || \"nobody\"}<button onClick={() => { take(issue.id) }}>take</button></p> }} } }}<em>{status}</em></div>");
  const [code2, setCode2] = createSignal("const issues = createMemo(() => loadIssues());\nreturn (<p><Errored fallback={() => <i>failed</i>}><Loading fallback={<i>counting</i>}><u>{\"\" + issues().length + \" issues\"}</u></Loading></Errored></p>);");
  const list = createMemo(() => loadIssues());
  function A1() {
    const issues = createMemo(() => loadIssues());
    const [status, setStatus] = createSignal("");
    const take = action(function* take(id: number) {
      affects(issues);
      try {
        const who: string = yield assignIssue(id);
        refresh(issues);
        setStatus("Assigned #" + id + " to " + who);
      } catch (error) {
        setStatus("Could not assign #" + id);
      }
    });
    return <div><Errored fallback={() => <p>Could not load<button onClick={() => refresh(issues)}>retry</button></p>}><Loading fallback={<i>Loading</i>}><b>{"" + (isPending(() => issues()) ? "saving" : "ready")}</b><For each={issues()}>{(issue) => <p>{issue.title}: {issue.owner || "nobody"}<button onClick={() => take(issue.id)}>take</button></p>}</For></Loading></Errored><em>{status()}</em></div>;
  }
  function B1() {
    return <ul><Loading fallback={<i>outer loading</i>}><b>{"" + (isPending(() => list()) ? "busy" : "idle")}</b><For each={list()}>{(it) => <li>{it.title}</li>}</For></Loading></ul>;
  }
  function T1() {
    const issues = createMemo(() => loadIssues());
    return (<p><Errored fallback={() => <i>failed</i>}><Loading fallback={<i>counting</i>}><u>{"" + issues().length + " issues"}</u></Loading></Errored></p>);
  }
  const pick = (c: string) => c === "issues = await loadIssues();\nsource status := \"\";\naction take(id: number) {\n  affects issues;\n  try {\n    let who = await assignIssue(id);\n    refresh issues;\n    status := \"Assigned #\" + id + \" to \" + who;\n  } catch (error) {\n    status := \"Could not assign #\" + id;\n  }\n}\n<div>{errored fallback { <p>Could not load<button onClick={() => { refresh issues }}>retry</button></p> } { loading fallback { <i>Loading</i> } { <b>{pending? issues ? \"saving\" : \"ready\"}</b>{for issue in issues { <p>{issue.title}: {issue.owner || \"nobody\"}<button onClick={() => { take(issue.id) }}>take</button></p> }} } }}<em>{status}</em></div>" ? <A1 /> : c === "<ul>{loading fallback { <i>outer loading</i> } { <b>{pending? list ? \"busy\" : \"idle\"}</b>{for it in list { <li>{it.title}</li> }} }}</ul>" ? <B1 /> : c === "const issues = createMemo(() => loadIssues());\nreturn (<p><Errored fallback={() => <i>failed</i>}><Loading fallback={<i>counting</i>}><u>{\"\" + issues().length + \" issues\"}</u></Loading></Errored></p>);" ? <T1 /> : undefined;
  return (
    <section>
      <button onClick={() => setCode("issues = await loadIssues();\nsource status := \"\";\naction take(id: number) {\n  affects issues;\n  try {\n    let who = await assignIssue(id);\n    refresh issues;\n    status := \"Assigned #\" + id + \" to \" + who;\n  } catch (error) {\n    status := \"Could not assign #\" + id;\n  }\n}\n<div>{errored fallback { <p>Could not load<button onClick={() => { refresh issues }}>retry</button></p> } { loading fallback { <i>Loading</i> } { <b>{pending? issues ? \"saving\" : \"ready\"}</b>{for issue in issues { <p>{issue.title}: {issue.owner || \"nobody\"}<button onClick={() => { take(issue.id) }}>take</button></p> }} } }}<em>{status}</em></div>")}>one</button>
      <button onClick={() => setCode("<ul>{loading fallback { <i>outer loading</i> } { <b>{pending? list ? \"busy\" : \"idle\"}</b>{for it in list { <li>{it.title}</li> }} }}</ul>")}>two</button>
      <button onClick={() => setCode("")}>none</button>
      <button onClick={() => refresh(list)}>reload</button>
      <Errored fallback={() => <p>list failed<button onClick={() => refresh(list)}>again</button></p>}><div>{evalTwin(() => code(), pick)}</div></Errored>
      <aside>{evalTwin(() => code2(), pick)}</aside>
    </section>
  );
}

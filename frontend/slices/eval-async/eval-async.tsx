import { createMemo, createSignal, Errored, refresh } from "solid-js";
import { createEval } from "reactivescript-tsx/eval";
import { assignIssue, loadIssues } from "./api";

// The async eval slice (docs/EVAL.md, "Async data") in Solid TSX: the twin of eval-async.rx, emitting the same plan.
export default function Board() {
  const [code, setCode] = createSignal("issues = await loadIssues();\nsource status := \"\";\naction take(id: number) {\n  affects issues;\n  try {\n    let who = await assignIssue(id);\n    refresh issues;\n    status := \"Assigned #\" + id + \" to \" + who;\n  } catch (error) {\n    status := \"Could not assign #\" + id;\n  }\n}\n<div>{errored fallback { <p>Could not load<button onClick={() => { refresh issues }}>retry</button></p> } { loading fallback { <i>Loading</i> } { <b>{pending? issues ? \"saving\" : \"ready\"}</b>{for issue in issues { <p>{issue.title}: {issue.owner || \"nobody\"}<button onClick={() => { take(issue.id) }}>take</button></p> }} } }}<em>{status}</em></div>");
  const [code2, setCode2] = createSignal("const issues = createMemo(() => loadIssues());\nreturn (<p><Errored fallback={() => <i>failed</i>}><Loading fallback={<i>counting</i>}><u>{\"\" + issues().length + \" issues\"}</u></Loading></Errored></p>);");
  const list = createMemo(() => loadIssues());
  return (
    <section>
      <button onClick={() => setCode("issues = await loadIssues();\nsource status := \"\";\naction take(id: number) {\n  affects issues;\n  try {\n    let who = await assignIssue(id);\n    refresh issues;\n    status := \"Assigned #\" + id + \" to \" + who;\n  } catch (error) {\n    status := \"Could not assign #\" + id;\n  }\n}\n<div>{errored fallback { <p>Could not load<button onClick={() => { refresh issues }}>retry</button></p> } { loading fallback { <i>Loading</i> } { <b>{pending? issues ? \"saving\" : \"ready\"}</b>{for issue in issues { <p>{issue.title}: {issue.owner || \"nobody\"}<button onClick={() => { take(issue.id) }}>take</button></p> }} } }}<em>{status}</em></div>")}>one</button>
      <button onClick={() => setCode("<ul>{loading fallback { <i>outer loading</i> } { <b>{pending? list ? \"busy\" : \"idle\"}</b>{for it in list { <li>{it.title}</li> }} }}</ul>")}>two</button>
      <button onClick={() => setCode("")}>none</button>
      <button onClick={() => refresh(list)}>reload</button>
      <Errored fallback={() => <p>list failed<button onClick={() => refresh(list)}>again</button></p>}><div>{createEval(() => code(), { list, loadIssues, assignIssue })}</div></Errored>
      <aside>{createEval(() => code2(), { loadIssues }, { syntax: "tsx" })}</aside>
    </section>
  );
}

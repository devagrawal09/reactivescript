import { action, createSignal } from "solid-js";
import { createEval } from "reactivescript-tsx/eval";
import { save } from "./api";

// The eval slice (docs/EVAL.md) in Solid TSX: the twin of eval.rx, emitting the same plan.
export default function Studio() {
  const [code, setCode] = createSignal("source clicks := 0;\n<p><button onClick={() => { clicks := clicks + 1 }}>more</button>{\"clicks \" + clicks}<button onClick={() => { bump(1) }}>bump</button>{\" count \" + count}</p>");
  const [code2, setCode2] = createSignal("return (<p><button onClick={() => bump(10)}>ten</button>{\"n is \" + n()}</p>);");
  const [formula, setFormula] = createSignal("\"n=\" + count");
  const [count, setCount] = createSignal(0);
  const [status, setStatus] = createSignal("");
  const bump = action(function* bump(n: number) {
    setCount(count() + n);
  });
  const store = action(function* store(n: number) {
    try {
      const r: string = yield save(n);
      setStatus(r);
    } catch (error) {
      setStatus("failed");
    }
  });
  const label = createEval(() => formula(), { count }, { type: "string" });
  return (
    <section>
      <button onClick={() => setCode("source clicks := 0;\n<p><button onClick={() => { clicks := clicks + 1 }}>more</button>{\"clicks \" + clicks}<button onClick={() => { bump(1) }}>bump</button>{\" count \" + count}</p>")}>one</button>
      <button onClick={() => setCode("source saved := \"none\";\nsource shown = saved;\naction keep(n: number) {\n  optimistic shown := \"saving\";\n  try {\n    let r = await save(n);\n    saved := r;\n  } catch (error) {\n    saved := \"error\";\n  }\n}\n<p><button onClick={() => { keep(count) }}>keep</button>{\"saved \" + shown}<button onClick={() => { store(count) }}>store</button></p>")}>two</button>
      <button onClick={() => setCode("source items := { list: [{ id: 1, name: \"a\" }, { id: 2, name: \"b\" }] };\n<ul>{for it in items.list { <li>{it.name + count}</li> }}{if count > 1 { <b>big</b> } else { <s>small</s> }}</ul>")}>three</button>
      <button onClick={() => setCode("")}>none</button>
      <button onClick={() => setCode2(code2() === "return (<p><button onClick={() => bump(10)}>ten</button>{\"n is \" + n()}</p>);" ? "const [t, setT] = createSignal(\"x\");\nreturn (<p><button onClick={() => setT(t() + \"x\")}>grow</button>{t() + n()}</p>);" : "return (<p><button onClick={() => bump(10)}>ten</button>{\"n is \" + n()}</p>);")}>swap</button>
      <button onClick={() => setFormula("count > 3 ? \"big\" : \"small\"")}>formula</button>
      <div>{createEval(() => code(), { count, bump, store, save })}</div>
      <aside>{createEval(() => code2(), { n: count, bump }, { syntax: "tsx" })}</aside>
      <i>{label()}</i>
      <em>{status()}</em>
    </section>
  );
}

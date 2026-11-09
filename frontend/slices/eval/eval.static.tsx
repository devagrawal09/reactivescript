import { action, createMemo, createOptimistic, createSignal, createStore, For, Show } from "solid-js";
import { save } from "./api";

// The eval slice's static twin (docs/EVAL.md): every code string of eval.rx written statically as a native component,
// and each eval site as the keyed Show createEval is specified as. Compiled only by Solid's transform.
function evalTwin(code: () => string, pick: (code: string) => any) {
  return <Show when={code()} keyed>{(code: string) => pick(code)}</Show>;
}

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
  // The value site: a memo of the formula's expression, read after the formula, as createEval's memo reads it.
  const label = createMemo(() => {
    const f = formula();
    if (f === "\"n=\" + count") return "n=" + count();
    if (f === "count > 3 ? \"big\" : \"small\"") return count() > 3 ? "big" : "small";
    throw new Error("no static twin for " + f);
  });
  function P1() {
    const [clicks, setClicks] = createSignal(0);
    return <p><button onClick={() => setClicks(clicks() + 1)}>more</button>{"clicks " + clicks()}<button onClick={() => bump(1)}>bump</button>{" count " + count()}</p>;
  }
  function P2() {
    const [saved, setSaved] = createSignal("none");
    const [shown, setShown] = createOptimistic(() => saved());
    const keep = action(function* keep(n: number) {
      setShown("saving");
      try {
        const r: string = yield save(n);
        setSaved(r);
      } catch (error) {
        setSaved("error");
      }
    });
    return <p><button onClick={() => keep(count())}>keep</button>{"saved " + shown()}<button onClick={() => store(count())}>store</button></p>;
  }
  function P3() {
    const [items, setItems] = createStore({ list: [{ id: 1, name: "a" }, { id: 2, name: "b" }] });
    return <ul><For each={items.list}>{(it) => <li>{it.name + count()}</li>}</For><Show when={count() > 1} fallback={<s>small</s>}><b>big</b></Show></ul>;
  }
  function T1() {
    const n = count;
    return (<p><button onClick={() => bump(10)}>ten</button>{"n is " + n()}</p>);
  }
  function T2() {
    const n = count;
    const [t, setT] = createSignal("x");
    return (<p><button onClick={() => setT(t() + "x")}>grow</button>{t() + n()}</p>);
  }
  const pick = (c: string) => c === "source clicks := 0;\n<p><button onClick={() => { clicks := clicks + 1 }}>more</button>{\"clicks \" + clicks}<button onClick={() => { bump(1) }}>bump</button>{\" count \" + count}</p>" ? <P1 /> : c === "source saved := \"none\";\nsource shown = saved;\naction keep(n: number) {\n  optimistic shown := \"saving\";\n  try {\n    let r = await save(n);\n    saved := r;\n  } catch (error) {\n    saved := \"error\";\n  }\n}\n<p><button onClick={() => { keep(count) }}>keep</button>{\"saved \" + shown}<button onClick={() => { store(count) }}>store</button></p>" ? <P2 /> : c === "source items := { list: [{ id: 1, name: \"a\" }, { id: 2, name: \"b\" }] };\n<ul>{for it in items.list { <li>{it.name + count}</li> }}{if count > 1 { <b>big</b> } else { <s>small</s> }}</ul>" ? <P3 /> : c === "return (<p><button onClick={() => bump(10)}>ten</button>{\"n is \" + n()}</p>);" ? <T1 /> : c === "const [t, setT] = createSignal(\"x\");\nreturn (<p><button onClick={() => setT(t() + \"x\")}>grow</button>{t() + n()}</p>);" ? <T2 /> : undefined;
  return (
    <section>
      <button onClick={() => setCode("source clicks := 0;\n<p><button onClick={() => { clicks := clicks + 1 }}>more</button>{\"clicks \" + clicks}<button onClick={() => { bump(1) }}>bump</button>{\" count \" + count}</p>")}>one</button>
      <button onClick={() => setCode("source saved := \"none\";\nsource shown = saved;\naction keep(n: number) {\n  optimistic shown := \"saving\";\n  try {\n    let r = await save(n);\n    saved := r;\n  } catch (error) {\n    saved := \"error\";\n  }\n}\n<p><button onClick={() => { keep(count) }}>keep</button>{\"saved \" + shown}<button onClick={() => { store(count) }}>store</button></p>")}>two</button>
      <button onClick={() => setCode("source items := { list: [{ id: 1, name: \"a\" }, { id: 2, name: \"b\" }] };\n<ul>{for it in items.list { <li>{it.name + count}</li> }}{if count > 1 { <b>big</b> } else { <s>small</s> }}</ul>")}>three</button>
      <button onClick={() => setCode("")}>none</button>
      <button onClick={() => setCode2(code2() === "return (<p><button onClick={() => bump(10)}>ten</button>{\"n is \" + n()}</p>);" ? "const [t, setT] = createSignal(\"x\");\nreturn (<p><button onClick={() => setT(t() + \"x\")}>grow</button>{t() + n()}</p>);" : "return (<p><button onClick={() => bump(10)}>ten</button>{\"n is \" + n()}</p>);")}>swap</button>
      <button onClick={() => setFormula("count > 3 ? \"big\" : \"small\"")}>formula</button>
      <div>{evalTwin(() => code(), pick)}</div>
      <aside>{evalTwin(() => code2(), pick)}</aside>
      <i>{label()}</i>
      <em>{status()}</em>
    </section>
  );
}

import { action, createMemo, createSignal, dynamicComponent, Errored, For, Loading, refresh } from "solid-js";
import { loadList, claim, Detail$server, Summary$server } from "./tracker-frames.server.tsx";

function ClaimButton(props: { id: number; assignee: string; take: (id: number) => void }) {
  return <button onClick={() => props.take(props.id)}>{"" + (props.assignee === "" ? "take" : "taken by " + props.assignee)}</button>;
}

export default function Tracker() {
  const [mode, setMode] = createSignal("all");
  const [selected, setSelected] = createSignal(1);
  const [status, setStatus] = createSignal("");
  const issues = createMemo(() => loadList());
  const issue = createMemo(() => Detail$server(selected()));
  const open = createMemo(() => Summary$server());
  const visible = createMemo(() => issues().filter((row) => mode() === "all" || row.assignee === ""));
  const Detail = dynamicComponent(() => issue());
  const Summary = dynamicComponent(() => open());
  const take = action(function* (id: number) {
    try {
      const who: string = yield claim(id);
      refresh(issues);
      refresh(issue);
      refresh(open);
      setStatus("Assigned #" + id + " to " + who);
    } catch (e) {
      setStatus("Could not assign #" + id);
    }
  });
  return (
    <section>
      <button onClick={() => setMode(mode() === "all" ? "open" : "all")}>{"Filter: " + mode()}</button>
      <Errored fallback={(e) => <p>Could not load</p>}>
        <Loading fallback={<i>Loading…</i>}>
          <Summary />
          <For each={visible()}>{(row) => <p>{row.title}<button onClick={() => setSelected(row.id)}>show</button></p>}</For>
          <Detail ClaimButton={(p: { id: number; assignee: string }) => <ClaimButton id={p.id} assignee={p.assignee} take={take} />} />
        </Loading>
      </Errored>
      <em>{status()}</em>
    </section>
  );
}

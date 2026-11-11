import { action, createMemo, createSignal, Errored, For, Loading, refresh } from "solid-js";
import { getIssue, listIssues, countOpen, assignIssue } from "./db";

async function loadList() {
  "use server";
  const xs = await listIssues();
  return xs;
}
async function loadIssue(id: number) {
  "use server";
  const i = await getIssue(id);
  return { id: i.id, title: i.title, body: i.body, assignee: i.assignee };
}
async function loadSummary() {
  "use server";
  const n = await countOpen();
  return n;
}
async function claim(id: number) {
  "use server";
  const who = await assignIssue(id);
  return who;
}

function ClaimButton(props: { id: number; assignee: string; take: (id: number) => void }) {
  return <button onClick={() => props.take(props.id)}>{"" + (props.assignee === "" ? "take" : "taken by " + props.assignee)}</button>;
}

function Detail(props: { issue: { id: number; title: string; body: string; assignee: string }; take: (id: number) => void }) {
  return <article><h2>{props.issue.title}</h2><p>{props.issue.body}</p><ClaimButton id={props.issue.id} assignee={props.issue.assignee} take={props.take} /></article>;
}

function Summary(props: { open: number }) {
  return <p>{"" + props.open + " open"}</p>;
}

export default function Tracker() {
  const [mode, setMode] = createSignal("all");
  const [selected, setSelected] = createSignal(1);
  const [status, setStatus] = createSignal("");
  const issues = createMemo(() => loadList());
  const issue = createMemo(() => loadIssue(selected()));
  const open = createMemo(() => loadSummary());
  const visible = createMemo(() => issues().filter((row) => mode() === "all" || row.assignee === ""));
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
          <Summary open={open()} />
          <For each={visible()}>{(row) => <p>{row.title}<button onClick={() => setSelected(row.id)}>show</button></p>}</For>
          <Detail issue={issue()} take={take} />
        </Loading>
      </Errored>
      <em>{status()}</em>
    </section>
  );
}

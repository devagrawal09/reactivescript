import { getIssue, listIssues, countOpen, assignIssue } from "./db";

export async function loadList() {
  "use server";
  const xs = await listIssues();
  return xs;
}
export async function loadIssue(id: number) {
  "use server";
  const i = await getIssue(id);
  return { id: i.id, title: i.title, body: i.body, assignee: i.assignee };
}
export async function loadSummary() {
  "use server";
  const n = await countOpen();
  return n;
}
export async function claim(id: number) {
  "use server";
  const who = await assignIssue(id);
  return who;
}

export async function Detail$server(selected: number) {
  "use server";
  const issue = await loadIssue(selected);
  return (props: { ClaimButton: (p: { id: number; assignee: string }) => any }) => (
    <article><h2>{issue.title}</h2><p>{issue.body}</p><props.ClaimButton id={issue.id} assignee={issue.assignee} /></article>
  );
}

export async function Summary$server() {
  "use server";
  const open = await loadSummary();
  return () => <p>{"" + open + " open"}</p>;
}

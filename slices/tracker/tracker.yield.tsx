import { $event, $memo, $optimistic, $signal, $store, attempt, component, For, Show, view } from "solid-yield";
import { assignIssue } from "./api";

export default component(function* Tracker() {
  const [issues, setIssues] = yield* $store({
    list: [
      { id: 1, title: "Crash on save", assignee: "" },
      { id: 2, title: "Slow search", assignee: "ana" },
      { id: 3, title: "Typo in footer", assignee: "" },
    ],
  });
  const [shown, setShown] = yield* $optimistic(function* () { return yield* issues.list; });
  const [mode, setMode] = yield* $signal("all");
  const [status, setStatus] = yield* $signal("");
  const visible = yield* $memo(function* () {
    const current = yield* mode;
    return (yield* shown).filter((issue) => current === "all" || issue.assignee === "");
  });
  const unassigned = yield* $memo(function* () {
    return (yield* shown).filter((issue) => issue.assignee === "").length;
  });
  const claim = $event(function* (id: number) {
    yield* setShown((list) => list.map((issue) => (issue.id === id ? { id: issue.id, title: issue.title, assignee: "me" } : issue)));
    const owner = yield* attempt(() => assignIssue(id), function* () {
      yield* setStatus("Could not assign #" + id);
    });
    if (owner !== undefined) {
      yield* setIssues((draft) => {
        draft.list[draft.list.findIndex((issue) => issue.id === id)].assignee = owner;
      });
      yield* setStatus("");
    }
  });
  const toggle = $event(function* () {
    yield* setMode((yield* mode) === "all" ? "open" : "all");
  });
  return view(function* () {
    return (
      <section>
        <button onClick={yield* toggle}>Filter: {yield* mode}</button>
        <b>{yield* unassigned} open</b>
        {yield* Show({
          when: function* () { return (yield* visible).length > 0; },
          fallback: function* () { return <i>Nothing to triage</i>; },
          children: function* () {
            return <>{yield* For({
              each: visible,
              children: function* (issue) {
                const take = $event(function* () { yield* claim(yield* issue.id); });
                return view(function* () {
                  return (
                    <p>
                      {yield* issue.title}: {(yield* issue.assignee) || "nobody"}
                      <button onClick={yield* take}>take</button>
                    </p>
                  );
                });
              },
            })}</>;
          },
        })}
        <em>{yield* status}</em>
      </section>
    );
  });
});

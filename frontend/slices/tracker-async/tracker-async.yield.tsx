// The yield twin of tracker-async.tsx. It is REFUSED, by design (docs/YIELD.md, "Refused"; plan/docs/PLAN-V2.md,
// "v2.1: async data"): the yield frontend lowers no async data, and solid-yield's documented dialect (fcc100e, the
// syntax design the frontend follows) names no isPending and no affects, so the indicator and the pending mark have no
// yield spelling. The frontend refuses each async import at its specifier, in import order: `affects` ("not in the
// yield subset"), `Errored` ("Errored and typed failures are not in the yield subset yet"), `isPending` ("not in the
// yield subset"), `Loading` ("Loading needs async sources, …") and `refresh` ("refresh needs a question source, …");
// past the imports, the async `$memo` is refused too ("async memos (attempt in $memo) are not in the yield subset").
// slices/tracker-async.test.ts pins each refusal at its site.
import { $event, $memo, $signal, affects, attempt, component, Errored, For, isPending, Loading, refresh, view } from "solid-yield";
import { assignIssue, loadIssues } from "./api";

export default component(function* TrackerAsync() {
  const issues = yield* $memo(function* () { return yield* attempt(() => loadIssues()); });
  const [status, setStatus] = yield* $signal("");
  const claim = $event(function* (id: number) {
    yield* affects(issues);
    const owner = yield* attempt(() => assignIssue(id), function* () {
      yield* setStatus("Could not assign #" + id);
    });
    if (owner !== undefined) {
      yield* refresh(issues);
      yield* setStatus("Assigned #" + id + " to " + owner);
    }
  });
  const retry = $event(function* () { yield* refresh(issues); });
  return view(function* () {
    return (
      <section>
        {yield* Errored({
          fallback: function* () { return <p>Could not load issues<button onClick={yield* retry}>retry</button></p>; },
          children: function* () {
            return <>{yield* Loading({
              fallback: function* () { return <i>Loading issues…</i>; },
              children: function* () {
                return <>
                  <b>{(yield* isPending(issues)) ? "saving…" : "ready"}</b>
                  {yield* For({
                    each: issues,
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
                  })}
                </>;
              },
            })}</>;
          },
        })}
        <em>{yield* status}</em>
      </section>
    );
  });
});

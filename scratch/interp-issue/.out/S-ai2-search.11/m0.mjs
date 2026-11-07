// compiled by ReactiveScript ref/compile from search.rx — do not edit
let c$TooShort;
function g$TooShort(__rt) {
	const __B = __rt.B;
	return c$TooShort ??= __rt.errorClass("TooShort", ["q"], (v$q) => "too short: " + __rt.fmt(v$q));
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$search = __rt.api("search");
	__rt.reg("search", { value: v$search });
	const v$len = __B.len;
	__rt.reg("len", { value: v$len });
	const v$TooShort = g$TooShort(__rt);
	const v$setQuery = __rt.action(function* (v$q) {
		w$query.set(v$q);
	});
	__rt.reg("setQuery", { value: v$setQuery });
	const [v$query, w$query] = __rt.source("query", __rt.untrack(() => ""));
	__rt.reg("query", {
		get: v$query,
		w: w$query
	});
	const v$results = __rt.keyed("results", "id", () => __rt.eq(v$query(), "") ? [] : v$len(v$query()) < 2 ? __rt.throw(v$TooShort(v$query())) : __rt.awaited(v$search(v$query())));
	__rt.reg("results", { get: v$results });
	const v$count = __rt.memo("count", (__prev) => v$len(v$results()), undefined);
	__rt.reg("count", { get: v$count });
	return {
		"TooShort": v$TooShort,
		"query": v$query,
		"setQuery": v$setQuery,
		"results": v$results,
		"count": v$count
	};
}

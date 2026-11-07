// compiled by ReactiveScript ref/compile from issues.rx — do not edit
let c$NotFound;
function g$NotFound(__rt) {
	const __B = __rt.B;
	return c$NotFound ??= __rt.errorClass("NotFound", ["id"], (v$id) => "issue #" + __rt.fmt(v$id) + " not found");
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$fetchIssues = __rt.api("fetchIssues");
	__rt.reg("fetchIssues", { value: v$fetchIssues });
	const v$fetchIssue = __rt.api("fetchIssue");
	__rt.reg("fetchIssue", { value: v$fetchIssue });
	const v$assign = __rt.api("assign");
	__rt.reg("assign", { value: v$assign });
	const v$map = __B.map;
	__rt.reg("map", { value: v$map });
	const v$NotFound = g$NotFound(__rt);
	function v$found(v$d, v$id) {
		return __rt.eq(v$d, null) ? __rt.throw(v$NotFound(v$id)) : v$d;
	}
	function v$withAssignee(v$list, v$id, v$user) {
		return v$map(v$list, (v$i) => __rt.eq(v$i?.id, v$id) ? {
			...v$i,
			"assignee": v$user
		} : v$i);
	}
	const v$setFilter = __rt.action(function* (v$f) {
		w$filter.set(v$f);
	});
	__rt.reg("setFilter", { value: v$setFilter });
	const v$select = __rt.action(function* (v$id) {
		w$selected.set(v$id);
		w$assignError.set("");
	});
	__rt.reg("select", { value: v$select });
	const v$assignToMe = __rt.action(function* (v$id, v$user) {
		w$assignError.set("");
		w$issues.guess((v$list) => v$withAssignee(v$list, v$id, v$user));
		try {
			yield __rt.awaited(v$assign(v$id, v$user));
			w$issues.set((v$list) => v$withAssignee(v$list, v$id, v$user));
		} catch (v$e) {
			w$assignError.set(v$e?.message);
		}
	});
	__rt.reg("assignToMe", { value: v$assignToMe });
	const [v$filter, w$filter] = __rt.source("filter", __rt.untrack(() => "open"));
	__rt.reg("filter", {
		get: v$filter,
		w: w$filter
	});
	const [v$issues, w$issues] = __rt.question("issues", (__prev) => __rt.awaited(v$fetchIssues(v$filter())), undefined, {
		optimistic: true,
		structured: false
	}, "id");
	__rt.reg("issues", {
		get: v$issues,
		w: w$issues
	});
	const [v$selected, w$selected] = __rt.source("selected", __rt.untrack(() => null));
	__rt.reg("selected", {
		get: v$selected,
		w: w$selected
	});
	const [v$assignError, w$assignError] = __rt.source("assignError", __rt.untrack(() => ""));
	__rt.reg("assignError", {
		get: v$assignError,
		w: w$assignError
	});
	const a$detail$0 = __rt.memo("detail", () => !__rt.eq(v$selected(), null) ? __rt.awaited(v$fetchIssue(v$selected())) : undefined, undefined);
	__rt.hoisted("detail", a$detail$0);
	const v$detail = __rt.memo("detail", (__prev) => __rt.eq(v$selected(), null) ? null : v$found(a$detail$0(), v$selected()), undefined);
	__rt.reg("detail", { get: v$detail });
	return {
		"NotFound": v$NotFound,
		"filter": v$filter,
		"issues": v$issues,
		"selected": v$selected,
		"assignError": v$assignError,
		"detail": v$detail,
		"setFilter": v$setFilter,
		"select": v$select,
		"assignToMe": v$assignToMe
	};
}

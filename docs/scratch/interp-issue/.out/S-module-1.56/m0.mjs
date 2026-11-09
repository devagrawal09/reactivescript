// compiled by ReactiveScript ref/compile from store.rx — do not edit
let c$NotFound;
function g$NotFound(__rt) {
	const __B = __rt.B;
	return c$NotFound ??= __rt.errorClass("NotFound", ["id"], (v$id) => "no user " + __rt.fmt(v$id));
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$NotFound = g$NotFound(__rt);
	function v$initials(v$name) {
		return v$name?.slice(0, 1);
	}
	const v$select = __rt.action(function* (v$id) {
		w$selected.set(v$id);
	});
	__rt.reg("select", { value: v$select });
	const [v$selected, w$selected] = __rt.source("selected", __rt.untrack(() => 1));
	__rt.reg("selected", {
		get: v$selected,
		w: w$selected
	});
	const v$user = __rt.memo("user", (__prev) => v$selected() > 0 ? __rt.awaited(__B.fetch("u:" + v$selected())) : __rt.throw(v$NotFound(v$selected())), undefined);
	__rt.reg("user", { get: v$user });
	return {
		"NotFound": v$NotFound,
		"selected": v$selected,
		"user": v$user,
		"select": v$select,
		"initials": v$initials
	};
}

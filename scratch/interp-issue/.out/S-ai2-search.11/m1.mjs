// compiled by ReactiveScript ref/compile from detail.rx — do not edit
let c$NotFound;
function g$NotFound(__rt) {
	const __B = __rt.B;
	return c$NotFound ??= __rt.errorClass("NotFound", ["id"], (v$id) => "item " + __rt.fmt(v$id) + " not found");
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$fetchItem = __rt.api("fetchItem");
	__rt.reg("fetchItem", { value: v$fetchItem });
	const v$NotFound = g$NotFound(__rt);
	function v$found(v$it, v$id) {
		return __rt.eq(v$it, null) ? __rt.throw(v$NotFound(v$id)) : v$it;
	}
	const v$select = __rt.action(function* (v$id) {
		w$selected.set(v$id);
	});
	__rt.reg("select", { value: v$select });
	const v$retry = __rt.action(function* () {
		__rt.refresh("item", v$item);
	});
	__rt.reg("retry", { value: v$retry });
	const [v$selected, w$selected] = __rt.source("selected", __rt.untrack(() => null));
	__rt.reg("selected", {
		get: v$selected,
		w: w$selected
	});
	const a$item$0 = __rt.memo("item", () => !__rt.eq(v$selected(), null) ? __rt.awaited(v$fetchItem(v$selected())) : undefined, undefined);
	__rt.hoisted("item", a$item$0);
	const v$item = __rt.memo("item", (__prev) => __rt.eq(v$selected(), null) ? null : v$found(a$item$0(), v$selected()), undefined);
	__rt.reg("item", { get: v$item });
	return {
		"NotFound": v$NotFound,
		"selected": v$selected,
		"select": v$select,
		"retry": v$retry,
		"item": v$item
	};
}

// compiled by ReactiveScript ref/compile from cart.rx — do not edit
import __m0 from "./m0.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$products = __i0["products"];
	const v$coupon = __i0["coupon"];
	const v$checkout = __rt.api("checkout");
	__rt.reg("checkout", { value: v$checkout });
	function v$qtyOf(v$id) {
		return v$cart()?.find((v$l) => __rt.eq(v$l?.id, v$id))?.qty || 0;
	}
	const v$setQty = __rt.action(function* (v$id, v$n) {
		if (v$n < 0) {
			return;
		} else {}
		w$cart.set((v$ls) => __rt.eq(v$n, 0) ? v$ls?.filter((v$l) => !__rt.eq(v$l?.id, v$id)) : v$ls?.some((v$l) => __rt.eq(v$l?.id, v$id)) ? v$ls?.map((v$l) => __rt.eq(v$l?.id, v$id) ? {
			...v$l,
			"qty": v$n
		} : v$l) : [...v$ls, {
			"id": v$id,
			"qty": v$n
		}]);
	});
	__rt.reg("setQty", { value: v$setQty });
	const v$placeOrder = __rt.action(function* () {
		if (__rt.eq(__rt.snapshot(v$count), 0)) {
			return;
		} else {}
		let v$items = __rt.snapshot(v$cart);
		w$cart.guess([]);
		__rt.affects(v$cart);
		w$orderError.set("");
		try {
			let v$receipt = yield __rt.awaited(v$checkout(v$items, __rt.snapshot(v$coupon)));
			w$cart.set([]);
			w$lastOrder.set(v$receipt?.id);
		} catch (v$e) {
			w$orderError.set(v$e?.message);
		}
	});
	__rt.reg("placeOrder", { value: v$placeOrder });
	const [v$cart, w$cart] = __rt.question("cart", (__prev) => [], undefined, {
		optimistic: true,
		structured: false
	});
	__rt.reg("cart", {
		get: v$cart,
		w: w$cart
	});
	const [v$lastOrder, w$lastOrder] = __rt.source("lastOrder", __rt.untrack(() => null));
	__rt.reg("lastOrder", {
		get: v$lastOrder,
		w: w$lastOrder
	});
	const [v$orderError, w$orderError] = __rt.source("orderError", __rt.untrack(() => ""));
	__rt.reg("orderError", {
		get: v$orderError,
		w: w$orderError
	});
	const v$count = __rt.memo("count", (__prev) => v$cart()?.reduce((v$n, v$l) => v$n + v$l?.qty, 0), undefined);
	__rt.reg("count", { get: v$count });
	const v$subtotal = __rt.memo("subtotal", (__prev) => v$products()?.reduce((v$s, v$p) => v$s + v$p?.price * v$qtyOf(v$p?.id), 0), undefined);
	__rt.reg("subtotal", { get: v$subtotal });
	return {
		"cart": v$cart,
		"lastOrder": v$lastOrder,
		"orderError": v$orderError,
		"qtyOf": v$qtyOf,
		"count": v$count,
		"subtotal": v$subtotal,
		"setQty": v$setQty,
		"placeOrder": v$placeOrder
	};
}

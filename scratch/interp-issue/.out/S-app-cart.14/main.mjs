import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from cart.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fetchProducts = __rt.api("fetchProducts");
		__rt.reg("fetchProducts", { value: v$fetchProducts });
		const v$validateCoupon = __rt.api("validateCoupon");
		__rt.reg("validateCoupon", { value: v$validateCoupon });
		const v$checkout = __rt.api("checkout");
		__rt.reg("checkout", { value: v$checkout });
		function v$qtyOf(v$id) {
			return v$cart()?.find((v$l) => __rt.eq(v$l?.id, v$id))?.qty || 0;
		}
		function V$Row(v$props) {
			const __o = __rt.owner();
			const v$qty = __rt.memo("qty", (__prev) => v$qtyOf(v$props?.product?.id), undefined);
			__rt.reg("qty", { get: v$qty });
			return (() => {
				var _el$ = _$createElement("li");
				var _el$2 = _$createElement("span");
				var _el$3 = _$createElement("span");
				var _el$4 = _$createElement("button", { onClick: () => {
					v$setQty(v$props?.product?.id, __rt.snapshot(v$qty) - 1);
				} });
				var _el$5 = _$createElement("span");
				var _el$6 = _$createElement("button", { onClick: () => {
					v$setQty(v$props?.product?.id, __rt.snapshot(v$qty) + 1);
				} });
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insertNode(_el$, _el$4);
				_$insertNode(_el$, _el$5);
				_$insertNode(_el$, _el$6);
				_$insert(_el$2, () => {
					return __rt.show(v$props?.product?.name);
				});
				_$insert(_el$3, () => {
					return __rt.show(v$props?.product?.price);
				});
				_$insertNode(_el$4, _$createTextNode("-"));
				_$insert(_el$5, () => {
					return __rt.show(v$qty());
				});
				_$insertNode(_el$6, _$createTextNode("+"));
				_$effect(() => __rt.eq(v$qty(), 0), (_v$, _$p) => {
					_$setProp(_el$4, "disabled", _v$, _$p);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$7 = _$createElement("p", { class: "error" });
					var _el$8 = _$createTextNode("The shop is unavailable: ");
					_$insertNode(_el$7, _el$8);
					_$insert(_el$7, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$7;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$9 = _$createElement("section");
							var _el$10 = _$createElement("h1");
							var _el$11 = _$createTextNode("Cart (");
							var _el$12 = _$createTextNode(")");
							var _el$13 = _$createElement("ul");
							var _el$14 = _$createElement("label");
							var _el$17 = _$createTextNode("Coupon ");
							var _el$15 = _$createElement("input", { onInput: (v$e) => {
								w$coupon.set(v$e?.target?.value);
							} });
							var _el$16 = _$createElement("small");
							var _el$18 = _$createElement("p");
							var _el$19 = _$createTextNode("Subtotal ");
							var _el$20 = _$createElement("p");
							var _el$21 = _$createTextNode("Total ");
							var _el$22 = _$createElement("button", { onClick: () => {
								v$placeOrder();
							} });
							var _el$23 = _$createElement("p");
							_$insertNode(_el$9, _el$10);
							_$insertNode(_el$9, _el$13);
							_$insertNode(_el$9, _el$14);
							_$insertNode(_el$9, _el$18);
							_$insertNode(_el$9, _el$20);
							_$insertNode(_el$9, _el$22);
							_$insertNode(_el$9, _el$23);
							_$insertNode(_el$10, _el$11);
							_$insertNode(_el$10, _el$12);
							_$insert(_el$10, () => {
								return __rt.show(v$count());
							}, _el$12);
							_$insert(_el$13, _$createComponent(_$For, {
								get each() {
									return v$products();
								},
								children: (v$p) => {
									const __o = __rt.owner();
									return _$createComponent(V$Row, {
										product: v$p,
										children: []
									});
								}
							}));
							_$insertNode(_el$14, _el$17);
							_$insertNode(_el$14, _el$15);
							_$insertNode(_el$14, _el$16);
							_$insert(_el$16, () => {
								return __rt.show(__rt.isPending(() => v$discount()) ? "checking…" : __rt.latest(() => v$discount()) > 0 ? "-" + __rt.fmt(__rt.latest(() => v$discount())) + "%" : !__rt.eq(v$coupon(), "") ? "invalid code" : "");
							});
							_$insertNode(_el$18, _el$19);
							_$insert(_el$18, () => {
								return __rt.show(v$subtotal());
							}, null);
							_$insertNode(_el$20, _el$21);
							_$insert(_el$20, () => {
								return __rt.show(v$total());
							}, null);
							_$insertNode(_el$22, _$createTextNode("Checkout"));
							_$insert(_el$23, () => {
								return __rt.show(__rt.isPending(() => v$cart()) ? "Placing order…" : !__rt.eq(v$orderError(), "") ? "Failed: " + __rt.fmt(v$orderError()) : v$lastOrder() ? "Order #" + __rt.fmt(v$lastOrder()) + " placed" : "");
							});
							_$effect(() => {
								return {
									e: v$coupon(),
									t: __rt.isPending(() => v$cart()) || __rt.eq(v$count(), 0)
								};
							}, ({ e, t }, _p$) => {
								e !== _p$?.e && _$setProp(_el$15, "value", e, _p$?.e);
								t !== _p$?.t && _$setProp(_el$22, "disabled", t, _p$?.t);
							});
							return _el$9;
						})();
					})();
				}
			});
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
		const [v$products, w$products] = __rt.question("products", (__prev) => __rt.awaited(v$fetchProducts()), __rt.firstPaint(() => []), {
			optimistic: false,
			structured: false
		});
		__rt.reg("products", {
			get: v$products,
			w: w$products
		});
		const [v$cart, w$cart] = __rt.question("cart", (__prev) => [], undefined, {
			optimistic: true,
			structured: false
		});
		__rt.reg("cart", {
			get: v$cart,
			w: w$cart
		});
		const [v$coupon, w$coupon] = __rt.source("coupon", __rt.untrack(() => ""));
		__rt.reg("coupon", {
			get: v$coupon,
			w: w$coupon
		});
		const [v$lastOrder, w$lastOrder] = __rt.source("lastOrder", __rt.untrack(() => null));
		__rt.reg("lastOrder", {
			get: v$lastOrder,
			w: w$lastOrder
		});
		const v$count = __rt.memo("count", (__prev) => v$cart()?.reduce((v$n, v$l) => v$n + v$l?.qty, 0), undefined);
		__rt.reg("count", { get: v$count });
		const v$subtotal = __rt.memo("subtotal", (__prev) => v$products()?.reduce((v$s, v$p) => v$s + v$p?.price * v$qtyOf(v$p?.id), 0), undefined);
		__rt.reg("subtotal", { get: v$subtotal });
		const v$discount = __rt.memo("discount", (__prev) => __rt.eq(v$coupon(), "") ? 0 : __rt.awaited(v$validateCoupon(v$coupon())), __rt.firstPaint(() => 0));
		__rt.reg("discount", { get: v$discount });
		const v$total = __rt.memo("total", (__prev) => v$subtotal() - v$subtotal() * __rt.latest(() => v$discount()) / 100, undefined);
		__rt.reg("total", { get: v$total });
		const [v$orderError, w$orderError] = __rt.source("orderError", __rt.untrack(() => ""));
		__rt.reg("orderError", {
			get: v$orderError,
			w: w$orderError
		});
		return _$createComponent(V$App, { children: [] });
	};
}

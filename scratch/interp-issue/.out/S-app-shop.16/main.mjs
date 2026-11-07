import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
import __m1 from "./m1.mjs";
import __m2 from "./m2.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const v$products = __i0["products"];
		const v$coupon = __i0["coupon"];
		const v$discount = __i0["discount"];
		const v$setCoupon = __i0["setCoupon"];
		const __i1 = __rt.module("m1.mjs", __m1);
		const v$cart = __i1["cart"];
		const v$count = __i1["count"];
		const v$subtotal = __i1["subtotal"];
		const v$lastOrder = __i1["lastOrder"];
		const v$orderError = __i1["orderError"];
		const v$placeOrder = __i1["placeOrder"];
		const __i2 = __rt.module("m2.mjs", __m2);
		const V$Row = __i2["Row"];
		const V$Panel = __i2["Panel"];
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$total = __rt.memo("total", (__prev) => v$subtotal() - v$subtotal() * __rt.latest(() => v$discount()) / 100, undefined);
			__rt.reg("total", { get: v$total });
			return _$createComponent(V$Panel, {
				title: "The shop",
				get children() {
					var _el$ = _$createElement("section");
					var _el$2 = _$createElement("h1");
					var _el$3 = _$createTextNode("Cart (");
					var _el$4 = _$createTextNode(")");
					var _el$5 = _$createElement("ul");
					var _el$6 = _$createElement("label");
					var _el$9 = _$createTextNode("Coupon ");
					var _el$7 = _$createElement("input", { onInput: (v$e) => {
						v$setCoupon(v$e?.target?.value);
					} });
					var _el$8 = _$createElement("small");
					var _el$10 = _$createElement("p");
					var _el$11 = _$createTextNode("Subtotal ");
					var _el$12 = _$createElement("p");
					var _el$13 = _$createTextNode("Total ");
					var _el$14 = _$createElement("button", { onClick: () => {
						v$placeOrder();
					} });
					var _el$15 = _$createElement("p");
					_$insertNode(_el$, _el$2);
					_$insertNode(_el$, _el$5);
					_$insertNode(_el$, _el$6);
					_$insertNode(_el$, _el$10);
					_$insertNode(_el$, _el$12);
					_$insertNode(_el$, _el$14);
					_$insertNode(_el$, _el$15);
					_$insertNode(_el$2, _el$3);
					_$insertNode(_el$2, _el$4);
					_$insert(_el$2, () => {
						return __rt.show(v$count());
					}, _el$4);
					_$insert(_el$5, _$createComponent(_$For, {
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
					_$insertNode(_el$6, _el$9);
					_$insertNode(_el$6, _el$7);
					_$insertNode(_el$6, _el$8);
					_$insert(_el$8, () => {
						return __rt.show(__rt.isPending(() => v$discount()) ? "checking…" : __rt.latest(() => v$discount()) > 0 ? "-" + __rt.fmt(__rt.latest(() => v$discount())) + "%" : !__rt.eq(v$coupon(), "") ? "invalid code" : "");
					});
					_$insertNode(_el$10, _el$11);
					_$insert(_el$10, () => {
						return __rt.show(v$subtotal());
					}, null);
					_$insertNode(_el$12, _el$13);
					_$insert(_el$12, () => {
						return __rt.show(v$total());
					}, null);
					_$insertNode(_el$14, _$createTextNode("Checkout"));
					_$insert(_el$15, () => {
						return __rt.show(__rt.isPending(() => v$cart()) ? "Placing order…" : !__rt.eq(v$orderError(), "") ? "Failed: " + __rt.fmt(v$orderError()) : v$lastOrder() ? "Order #" + __rt.fmt(v$lastOrder()) + " placed" : "");
					});
					_$effect(() => {
						return {
							e: v$coupon(),
							t: __rt.isPending(() => v$cart()) || __rt.eq(v$count(), 0)
						};
					}, ({ e, t }, _p$) => {
						e !== _p$?.e && _$setProp(_el$7, "value", e, _p$?.e);
						t !== _p$?.t && _$setProp(_el$14, "disabled", t, _p$?.t);
					});
					return _el$;
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

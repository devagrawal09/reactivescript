import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$placeOrder = __rt.action(function* () {
				w$cart.guess([]);
				w$status.set("placing");
				try {
					let v$receipt = yield __rt.awaited(__B.fetch("checkout"));
					w$cart.set([]);
					w$orders.set(__rt.snapshot(v$orders) + 1);
					w$status.set("ok " + __rt.fmt(v$receipt));
				} catch (v$e) {
					w$status.set("failed: " + __rt.fmt(v$e?.message));
				} finally {
					w$orders.set((v$n) => v$n + 100);
				}
			});
			__rt.reg("placeOrder", { value: v$placeOrder });
			const [v$cart, w$cart] = __rt.question("cart", (__prev) => [1, 2], undefined, {
				optimistic: true,
				structured: false
			});
			__rt.reg("cart", {
				get: v$cart,
				w: w$cart
			});
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			const [v$orders, w$orders] = __rt.source("orders", __rt.untrack(() => 0));
			__rt.reg("orders", {
				get: v$orders,
				w: w$orders
			});
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" items / ");
				var _el$3 = _$createTextNode(" / ");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insert(_el$, () => {
					return __rt.show(v$cart()?.length);
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$status());
				}, _el$3);
				_$insert(_el$, () => {
					return __rt.show(v$orders());
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

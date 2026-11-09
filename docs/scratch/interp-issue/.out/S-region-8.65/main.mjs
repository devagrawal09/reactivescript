import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$tone = __rt.context("tone", () => "plain");
		__rt.reg("tone", { value: v$tone });
		function V$Dialog(v$props) {
			const __o = __rt.owner();
			const v$t = __rt.memo("t", (__prev) => __rt.useGet(v$tone, __o), undefined);
			__rt.reg("t", { get: v$t });
			return (() => {
				var _el$ = _$createElement("div");
				var _el$3 = _$createTextNode(" dialog ");
				var _el$2 = _$createElement("button", { onClick: () => {
					w$open.set(false);
				} });
				_$insertNode(_el$, _el$3);
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$t());
				}, _el$3);
				_$insert(_el$, () => {
					return __rt.show(v$n());
				}, _el$2);
				_$insertNode(_el$2, _$createTextNode("close"));
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return [(() => {
				var _el$4 = _$createElement("p");
				var _el$5 = _$createTextNode("count ");
				_$insertNode(_el$4, _el$5);
				_$insert(_el$4, () => {
					return __rt.show(v$n());
				}, null);
				return _el$4;
			})(), _$createComponent(_$Show, {
				get when() {
					return v$open();
				},
				get fallback() {
					const __o = __rt.owner();
					return null;
				},
				children: (__item) => {
					const n$open = __item;
					const __o = __rt.owner();
					return _$createComponent(__rt.Portal, { get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(V$Dialog, { children: [] });
						})();
					} });
				}
			})];
		}
		const [v$open, w$open] = __rt.source("open", __rt.untrack(() => false));
		__rt.reg("open", {
			get: v$open,
			w: w$open
		});
		const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 0));
		__rt.reg("n", {
			get: v$n,
			w: w$n
		});
		__rt.provide(v$tone, { get: __rt.memo(null, () => "loud") });
		return _$createComponent(V$App, { children: [] });
	};
}

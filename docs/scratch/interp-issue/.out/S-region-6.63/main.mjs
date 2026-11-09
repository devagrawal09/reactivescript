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
			function v$double(v$v) {
				return v$v * 2;
			}
			function v$counter(v$base, v$step) {
				const __o = __rt.owner();
				const [v$extra, w$extra] = __rt.source("extra", __rt.untrack(() => 0));
				__rt.reg("extra", {
					get: v$extra,
					w: w$extra
				});
				const v$total = __rt.memo("total", (__prev) => v$base() + v$extra() + v$step, undefined);
				__rt.reg("total", { get: v$total });
				return v$total;
			}
			const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 1));
			__rt.reg("n", {
				get: v$n,
				w: w$n
			});
			const v$d = __rt.memo("d", (__prev) => v$double(v$n()), undefined);
			__rt.reg("d", { get: v$d });
			const v$t = v$counter(v$n, __rt.untrack(() => 10));
			__rt.reg("t", { get: v$t });
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$d());
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$t());
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$a, w$a] = __rt.source("a", __rt.untrack(() => 0));
			__rt.reg("a", {
				get: v$a,
				w: w$a
			});
			const [v$b, w$b] = __rt.source("b", __rt.untrack(() => 0));
			__rt.reg("b", {
				get: v$b,
				w: w$b
			});
			const v$detailsA = __rt.memo("detailsA", (__prev) => __rt.awaited(__B.fetch("d:" + v$a())), undefined);
			__rt.reg("detailsA", { get: v$detailsA });
			const v$sum = __rt.memo("sum", (__prev) => v$b() + v$detailsA(), undefined);
			__rt.reg("sum", { get: v$sum });
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("error: ");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$3 = _$createElement("p");
							var _el$4 = _$createTextNode(":");
							var _el$5 = _$createTextNode(" sum ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$5);
							_$insert(_el$3, () => {
								return __rt.show(v$b());
							}, _el$4);
							_$insert(_el$3, () => {
								return __rt.show(v$detailsA());
							}, _el$5);
							_$insert(_el$3, () => {
								return __rt.show(v$sum());
							}, null);
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

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
			const v$save = __rt.action(function* () {
				try {
					w$x.set(1);
					yield __rt.awaited(__B.fetch("save"));
				} catch (__e) {}
			});
			__rt.reg("save", { value: v$save });
			const [v$x, w$x] = __rt.source("x", __rt.untrack(() => 0));
			__rt.reg("x", {
				get: v$x,
				w: w$x
			});
			return (() => {
				var _el$ = _$createElement("div");
				var _el$2 = _$createElement("p");
				var _el$6 = _$createTextNode(" ");
				var _el$3 = _$createElement("p");
				var _el$4 = _$createTextNode("latest ");
				var _el$7 = _$createTextNode(" ");
				var _el$5 = _$createElement("p");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$6);
				_$insertNode(_el$, _el$3);
				_$insertNode(_el$, _el$7);
				_$insertNode(_el$, _el$5);
				_$insert(_el$2, () => {
					return __rt.show(v$x());
				});
				_$insertNode(_el$3, _el$4);
				_$insert(_el$3, () => {
					return __rt.show(__rt.latest(() => v$x()));
				}, null);
				_$insert(_el$5, () => {
					return __rt.show(__rt.isPending(() => v$x()) ? "saving" : "idle");
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

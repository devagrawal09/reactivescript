import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$base, w$base] = __rt.source("base", __rt.untrack(() => 1));
			__rt.reg("base", {
				get: v$base,
				w: w$base
			});
			const [v$x, w$x] = __rt.question("x", (__prev) => v$base() * 10, undefined, {
				optimistic: false,
				structured: false
			});
			__rt.reg("x", {
				get: v$x,
				w: w$x
			});
			return (() => {
				var _el$ = _$createElement("p");
				_$insert(_el$, () => {
					return __rt.show(v$x());
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

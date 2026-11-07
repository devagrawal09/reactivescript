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
			const [v$count, w$count] = __rt.source("count", __rt.untrack(() => 0));
			__rt.reg("count", {
				get: v$count,
				w: w$count
			});
			const [v$show, w$show] = __rt.source("show", __rt.untrack(() => true));
			__rt.reg("show", {
				get: v$show,
				w: w$show
			});
			const v$double = __rt.memo("double", (__prev) => v$count() * 2, undefined);
			__rt.reg("double", { get: v$double });
			const p$double = __rt.pre(v$double);
			const v$label = __rt.memo("label", (__prev) => "prev " + __rt.preOr(p$double(), () => 0), undefined);
			__rt.reg("label", { get: v$label });
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$show() ? v$double() : "-");
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$label());
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

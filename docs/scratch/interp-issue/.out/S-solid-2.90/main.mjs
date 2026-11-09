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
			const [v$count, w$count] = __rt.source("count", __rt.untrack(() => 0));
			__rt.reg("count", {
				get: v$count,
				w: w$count
			});
			const [v$show, w$show] = __rt.source("show", __rt.untrack(() => false));
			__rt.reg("show", {
				get: v$show,
				w: w$show
			});
			const v$details = __rt.memo("details", (__prev) => __rt.awaited(__B.fetch("d:" + v$count())), undefined);
			__rt.reg("details", { get: v$details });
			const v$panel = __rt.memo("panel", (__prev) => v$show() ? v$count() : "hidden", undefined);
			__rt.reg("panel", { get: v$panel });
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
							var _el$3 = _$createElement("div");
							var _el$4 = _$createElement("p");
							var _el$5 = _$createTextNode("Count ");
							var _el$10 = _$createTextNode(" ");
							var _el$6 = _$createElement("p");
							var _el$7 = _$createTextNode("Details ");
							var _el$11 = _$createTextNode(" ");
							var _el$8 = _$createElement("p");
							var _el$9 = _$createTextNode("Panel ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$10);
							_$insertNode(_el$3, _el$6);
							_$insertNode(_el$3, _el$11);
							_$insertNode(_el$3, _el$8);
							_$insertNode(_el$4, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$count());
							}, null);
							_$insertNode(_el$6, _el$7);
							_$insert(_el$6, () => {
								return __rt.show(v$details());
							}, null);
							_$insertNode(_el$8, _el$9);
							_$insert(_el$8, () => {
								return __rt.show(v$panel());
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

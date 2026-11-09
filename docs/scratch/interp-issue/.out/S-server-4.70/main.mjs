import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const V$Row = __i0["Row"];
		function V$Note(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("p", { class: "note" });
				_$insert(_el$, () => {
					return __rt.show(v$props?.children);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$names, w$names] = __rt.source("names", __rt.untrack(() => ["Ann", "Bo"]));
			__rt.reg("names", {
				get: v$names,
				w: w$names
			});
			return [
				(() => {
					var _el$2 = _$createElement("table");
					var _el$3 = _$createElement("tbody");
					_$insertNode(_el$2, _el$3);
					_$insert(_el$3, _$createComponent(_$For, {
						get each() {
							return v$names();
						},
						children: (v$n) => {
							const __o = __rt.owner();
							return _$createComponent(V$Row, {
								name: v$n,
								children: []
							});
						}
					}));
					return _el$2;
				})(),
				_$memo(() => {
					return __rt.show(" ");
				}),
				_$createComponent(V$Note, { get children() {
					var _el$4 = _$createElement("b");
					_$insertNode(_el$4, _$createTextNode("hi"));
					return _el$4;
				} })
			];
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m2 from "./m2.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i2 = __rt.module("m2.mjs", __m2);
		const V$SearchBox = __i2["SearchBox"];
		const V$ResultsPane = __i2["ResultsPane"];
		const V$DetailPane = __i2["DetailPane"];
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("main");
				_$insert(_el$, _$createComponent(V$SearchBox, { children: [] }), null);
				_$insert(_el$, () => {
					return __rt.show(" ");
				}, null);
				_$insert(_el$, _$createComponent(V$ResultsPane, { children: [] }), null);
				_$insert(_el$, () => {
					return __rt.show(" ");
				}, null);
				_$insert(_el$, _$createComponent(V$DetailPane, { children: [] }), null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
import __m2 from "./m2.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const v$currentUser = __i0["currentUser"];
		const v$session = __i0["session"];
		const __i2 = __rt.module("m2.mjs", __m2);
		const V$IssueList = __i2["IssueList"];
		const V$DetailPanel = __i2["DetailPanel"];
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("main");
				_$insert(_el$, _$createComponent(V$IssueList, { children: [] }), null);
				_$insert(_el$, () => {
					return __rt.show(" / ");
				}, null);
				_$insert(_el$, _$createComponent(V$DetailPanel, { children: [] }), null);
				return _el$;
			})();
		}
		__rt.provide(v$currentUser, { get: __rt.memo(null, () => v$session()) });
		return _$createComponent(V$App, { children: [] });
	};
}

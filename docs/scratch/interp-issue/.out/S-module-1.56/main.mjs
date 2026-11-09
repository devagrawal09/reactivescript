import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
import __m1 from "./m1.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const v$selected = __i0["selected"];
		const v$user = __i0["user"];
		const v$select = __i0["select"];
		const __i1 = __rt.module("m1.mjs", __m1);
		const V$Card = __i1["Card"];
		const V$Name = __i1["Name"];
		const V$Badge = __i1["Badge"];
		const v$who = __i1["who"];
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("div");
				var _el$2 = _$createElement("p");
				var _el$3 = _$createTextNode("#");
				var _el$4 = _$createTextNode(" ");
				var _el$5 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$4);
				_$insertNode(_el$, _el$5);
				_$insertNode(_el$2, _el$3);
				_$insert(_el$2, () => {
					return __rt.show(v$selected());
				}, null);
				_$insert(_el$, _$createComponent(V$Card, { get children() {
					return _$createComponent(V$Name, {
						get user() {
							return v$user();
						},
						children: []
					});
				} }), _el$5);
				_$insert(_el$, _$createComponent(V$Badge, { children: [] }), null);
				return _el$;
			})();
		}
		__rt.provide(v$who, { get: __rt.memo(null, () => "Zed") });
		return _$createComponent(V$App, { children: [] });
	};
}

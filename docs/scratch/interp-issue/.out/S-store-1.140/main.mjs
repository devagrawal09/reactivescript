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
			const [v$user, w$user] = __rt.source("user", __rt.untrack(() => ({
				"name": "Ann",
				"prefs": {
					"theme": "light",
					"size": 12
				}
			})));
			__rt.reg("user", {
				get: v$user,
				w: w$user
			});
			__rt.effect(1, () => [v$user()?.prefs?.theme], ($p) => __rt.untrack(() => {
				return __B.log("theme", $p[0]);
			}));
			__rt.effect(1, () => [v$user()?.name], ($p) => __rt.untrack(() => {
				return __B.log("name", $p[0]);
			}));
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" ");
				var _el$3 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insert(_el$, () => {
					return __rt.show(v$user()?.name);
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$user()?.prefs?.theme);
				}, _el$3);
				_$insert(_el$, () => {
					return __rt.show(v$user()?.prefs?.size);
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

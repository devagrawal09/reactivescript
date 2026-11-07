import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$user, w$user] = __rt.source("user", __rt.untrack(() => ({ "name": "a" })));
			__rt.reg("user", {
				get: v$user,
				w: w$user
			});
			return (() => {
				var _el$ = _$createElement("div");
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return v$user();
					},
					get fallback() {
						const __o = __rt.owner();
						return (() => {
							var _el$2 = _$createElement("p");
							_$insertNode(_el$2, _$createTextNode("none"));
							return _el$2;
						})();
					},
					children: (__item) => {
						const n$user = __item;
						const __o = __rt.owner();
						return (() => {
							var _el$3 = _$createElement("p");
							_$insert(_el$3, () => {
								return __rt.show(n$user()?.name);
							});
							return _el$3;
						})();
					}
				}));
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

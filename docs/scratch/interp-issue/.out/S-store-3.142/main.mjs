import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$rows, w$rows] = __rt.source("rows", __rt.untrack(() => [{
				"id": 1,
				"name": "a"
			}, {
				"id": 2,
				"name": "b"
			}]));
			__rt.reg("rows", {
				get: v$rows,
				w: w$rows
			});
			const v$view = __rt.keyed("view", "id", () => __B.map(v$rows(), (v$r) => ({
				"id": v$r?.id,
				"name": v$r?.name + "!"
			})));
			__rt.reg("view", { get: v$view });
			return _$createComponent(_$For, {
				get each() {
					return v$view();
				},
				children: (v$r) => {
					const __o = __rt.owner();
					__rt.effect(1, () => [v$r?.name], ($p) => __rt.untrack(() => {
						return __B.log(v$r?.id, $p[0]);
					}));
					return (() => {
						var _el$ = _$createElement("p");
						_$insert(_el$, () => {
							return __rt.show(v$r?.name);
						});
						return _el$;
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

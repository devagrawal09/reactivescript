import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$id, w$id] = __rt.source("id", __rt.untrack(() => "a"));
			__rt.reg("id", {
				get: v$id,
				w: w$id
			});
			const v$product = __rt.memo("product", (__prev) => __rt.awaited(__B.fetch("p:" + v$id())), undefined);
			__rt.reg("product", { get: v$product });
			return (() => {
				var _el$ = _$createElement("div");
				_$insert(_el$, _$createComponent(_$Errored, {
					fallback: (__err) => (() => {
						var _el$2 = _$createElement("p");
						_$insertNode(_el$2, _$createTextNode("failed"));
						return _el$2;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$3 = _$createElement("p");
										_$insertNode(_el$3, _$createTextNode("loading"));
										return _el$3;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$4 = _$createElement("p");
											_$insert(_el$4, () => {
												return __rt.show(v$product()?.name);
											});
											return _el$4;
										})();
									})();
								}
							});
						})();
					}
				}));
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

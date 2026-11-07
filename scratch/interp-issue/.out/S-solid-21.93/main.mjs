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
			const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
			__rt.reg("id", {
				get: v$id,
				w: w$id
			});
			const v$product = __rt.memo("product", (__prev) => __rt.awaited(__B.fetch("p:" + v$id())), undefined);
			__rt.reg("product", { get: v$product });
			const v$comments = __rt.memo("comments", (__prev) => __rt.awaited(__B.fetch("c:" + v$id())), undefined);
			__rt.reg("comments", { get: v$comments });
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
							var _el$4 = _$createElement("h1");
							var _el$5 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$product()?.name);
							});
							_$insert(_el$3, _$createComponent(_$Loading, {
								get on() {
									return __rt.latest(() => v$id());
								},
								get fallback() {
									return (() => {
										var _el$6 = _$createElement("p");
										_$insertNode(_el$6, _$createTextNode("spinner"));
										return _el$6;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$7 = _$createElement("ul");
											_$insert(_el$7, () => {
												return __rt.show(v$comments());
											});
											return _el$7;
										})();
									})();
								}
							}), null);
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

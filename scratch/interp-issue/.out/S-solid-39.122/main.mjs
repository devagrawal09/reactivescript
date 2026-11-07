import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$bump = __rt.action(function* () {
				try {
					w$s.set(1);
					yield __rt.awaited(__B.fetch("hold"));
				} catch (__e) {}
			});
			__rt.reg("bump", { value: v$bump });
			const [v$s, w$s] = __rt.source("s", __rt.untrack(() => 0));
			__rt.reg("s", {
				get: v$s,
				w: w$s
			});
			const [v$mounted, w$mounted] = __rt.source("mounted", __rt.untrack(() => false));
			__rt.reg("mounted", {
				get: v$mounted,
				w: w$mounted
			});
			const v$n0 = __rt.memo("n0", (__prev) => __rt.awaited(__B.fetch("n:" + __B.str(__rt.latest(() => v$s())))), undefined);
			__rt.reg("n0", { get: v$n0 });
			return [
				(() => {
					var _el$ = _$createElement("p");
					_$insert(_el$, () => {
						return __rt.show(v$mounted() ? "on" : "off");
					});
					return _el$;
				})(),
				_$memo(() => {
					return __rt.show(" ");
				}),
				_$createComponent(_$Errored, {
					fallback: (v$e) => (() => {
						var _el$2 = _$createElement("p");
						_$insert(_el$2, () => {
							return __rt.show(v$e()?.message);
						});
						return _el$2;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(_$Show, {
								get when() {
									return v$mounted();
								},
								get fallback() {
									const __o = __rt.owner();
									return null;
								},
								children: (__item) => {
									const n$mounted = __item;
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
														return __rt.show("[" + __rt.fmt(__rt.latest(() => v$s())) + ", " + __rt.fmt(v$n0()) + "]");
													});
													return _el$4;
												})();
											})();
										}
									});
								}
							});
						})();
					}
				})
			];
		}
		return _$createComponent(V$App, { children: [] });
	};
}

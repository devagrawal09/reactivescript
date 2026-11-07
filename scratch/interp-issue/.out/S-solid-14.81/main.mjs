import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
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
			const [v$count, w$count] = __rt.source("count", __rt.untrack(() => 0));
			__rt.reg("count", {
				get: v$count,
				w: w$count
			});
			const [v$open, w$open] = __rt.source("open", __rt.untrack(() => false));
			__rt.reg("open", {
				get: v$open,
				w: w$open
			});
			const v$slow = __rt.memo("slow", (__prev) => __rt.awaited(__B.fetch("slow:" + v$count())), undefined);
			__rt.reg("slow", { get: v$slow });
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
							var _el$4 = _$createElement("p");
							var _el$5 = _$createTextNode("Count ");
							var _el$8 = _$createTextNode(" ");
							var _el$6 = _$createElement("p");
							var _el$7 = _$createTextNode("Slow ");
							var _el$9 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$8);
							_$insertNode(_el$3, _el$6);
							_$insertNode(_el$3, _el$9);
							_$insertNode(_el$4, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$count());
							}, null);
							_$insertNode(_el$6, _el$7);
							_$insert(_el$6, () => {
								return __rt.show(v$slow());
							}, null);
							_$insert(_el$3, _$createComponent(_$Show, {
								get when() {
									return v$open();
								},
								get fallback() {
									const __o = __rt.owner();
									return null;
								},
								children: (__item) => {
									const n$open = __item;
									const __o = __rt.owner();
									const v$m = __rt.memo("m", (__prev) => v$count(), undefined);
									__rt.reg("m", { get: v$m });
									return _$createComponent(_$Loading, {
										get fallback() {
											return (() => {
												var _el$10 = _$createElement("p");
												_$insertNode(_el$10, _$createTextNode("fallback"));
												return _el$10;
											})();
										},
										get children() {
											return (() => {
												const __o = __rt.owner();
												return (() => {
													var _el$11 = _$createElement("p");
													var _el$12 = _$createTextNode("count ");
													_$insertNode(_el$11, _el$12);
													_$insert(_el$11, () => {
														return __rt.show(v$m());
													}, null);
													return _el$11;
												})();
											})();
										}
									});
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

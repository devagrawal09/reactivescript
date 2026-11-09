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
			const v$open = __rt.action(function* () {
				try {
					w$x.set(true);
					yield __rt.awaited(__B.fetch("gate"));
				} catch (__e) {}
			});
			__rt.reg("open", { value: v$open });
			const [v$x, w$x] = __rt.source("x", __rt.untrack(() => false));
			__rt.reg("x", {
				get: v$x,
				w: w$x
			});
			const v$slow = __rt.memo("slow", (__prev) => __rt.awaited(__B.fetch("slow:" + __B.str(v$x()))), undefined);
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
							var _el$5 = _$createTextNode("Slow ");
							var _el$6 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$6);
							_$insertNode(_el$4, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$slow());
							}, null);
							_$insert(_el$3, _$createComponent(_$Show, {
								get when() {
									return v$x();
								},
								get fallback() {
									const __o = __rt.owner();
									return null;
								},
								children: (__item) => {
									const n$x = __item;
									const __o = __rt.owner();
									return (() => {
										var _el$7 = _$createElement("div");
										_$insert(_el$7, _$createComponent(_$Loading, {
											get fallback() {
												return (() => {
													var _el$8 = _$createElement("p");
													_$insertNode(_el$8, _$createTextNode("fallback"));
													return _el$8;
												})();
											},
											get children() {
												return (() => {
													const __o = __rt.owner();
													const v$content = __rt.memo("content", (__prev) => __rt.awaited(__B.fetch("content")), undefined);
													__rt.reg("content", { get: v$content });
													return (() => {
														var _el$9 = _$createElement("p");
														_$insert(_el$9, () => {
															return __rt.show(v$content());
														});
														return _el$9;
													})();
												})();
											}
										}));
										return _el$7;
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

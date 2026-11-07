import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fail = __B.fail;
		__rt.reg("fail", { value: v$fail });
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$raw, w$raw] = __rt.source("raw", __rt.untrack(() => "ok"));
			__rt.reg("raw", {
				get: v$raw,
				w: w$raw
			});
			const v$detail = __rt.memo("detail", (__prev) => __rt.awaited(__B.fetch("detail")), undefined);
			__rt.reg("detail", { get: v$detail });
			const v$parsed = __rt.memo("parsed", (__prev) => __rt.eq(v$raw(), "bad") ? v$fail("corrupt input") : v$raw(), undefined);
			__rt.reg("parsed", { get: v$parsed });
			return _$createComponent(__rt.TypedErrored, {
				get classes() {
					return [__rt.PANIC];
				},
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("crashed: ");
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
							var _el$5 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$parsed());
							});
							_$insert(_el$3, _$createComponent(_$Errored, {
								fallback: (v$e) => (() => {
									var _el$6 = _$createElement("p");
									var _el$7 = _$createTextNode("detail failed: ");
									_$insertNode(_el$6, _el$7);
									_$insert(_el$6, () => {
										return __rt.show(v$e()?.message);
									}, null);
									return _el$6;
								})(),
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$8 = _$createElement("p");
											_$insert(_el$8, () => {
												return __rt.show(v$detail());
											});
											return _el$8;
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

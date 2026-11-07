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
			const [v$a, w$a] = __rt.source("a", __rt.untrack(() => 0));
			__rt.reg("a", {
				get: v$a,
				w: w$a
			});
			const [v$b, w$b] = __rt.source("b", __rt.untrack(() => 0));
			__rt.reg("b", {
				get: v$b,
				w: w$b
			});
			const [v$showA, w$showA] = __rt.source("showA", __rt.untrack(() => false));
			__rt.reg("showA", {
				get: v$showA,
				w: w$showA
			});
			const [v$showB, w$showB] = __rt.source("showB", __rt.untrack(() => false));
			__rt.reg("showB", {
				get: v$showB,
				w: w$showB
			});
			const i$sa = __rt.memo("sa", (__prev) => __rt.awaited(__B.fetch("A:" + __B.str(v$a()))), undefined);
			const v$sa = __rt.catchMemo(() => i$sa(), (__e) => __rt.isA(__e, undefined), (v$e) => "?");
			__rt.reg("sa", { get: v$sa });
			const i$sb = __rt.memo("sb", (__prev) => __rt.awaited(__B.fetch("B:" + __B.str(v$b()))), undefined);
			const v$sb = __rt.catchMemo(() => i$sb(), (__e) => __rt.isA(__e, undefined), (v$e) => "?");
			__rt.reg("sb", { get: v$sb });
			return [
				(() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("/");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$sa());
					}, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$sb());
					}, null);
					return _el$;
				})(),
				_$createComponent(_$Show, {
					get when() {
						return v$showA();
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const n$showA = __item;
						const __o = __rt.owner();
						const v$ma = __rt.memo("ma", (__prev) => v$a(), undefined);
						__rt.reg("ma", { get: v$ma });
						return (() => {
							var _el$3 = _$createElement("p");
							var _el$4 = _$createTextNode("pA ");
							_$insertNode(_el$3, _el$4);
							_$insert(_el$3, () => {
								return __rt.show(v$ma());
							}, null);
							return _el$3;
						})();
					}
				}),
				_$createComponent(_$Show, {
					get when() {
						return v$showB();
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const n$showB = __item;
						const __o = __rt.owner();
						const v$mb = __rt.memo("mb", (__prev) => v$b(), undefined);
						__rt.reg("mb", { get: v$mb });
						return (() => {
							var _el$5 = _$createElement("p");
							var _el$6 = _$createTextNode("pB ");
							_$insertNode(_el$5, _el$6);
							_$insert(_el$5, () => {
								return __rt.show(v$mb());
							}, null);
							return _el$5;
						})();
					}
				})
			];
		}
		return _$createComponent(V$App, { children: [] });
	};
}

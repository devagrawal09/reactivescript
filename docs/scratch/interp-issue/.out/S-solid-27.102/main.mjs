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
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 0));
			__rt.reg("n", {
				get: v$n,
				w: w$n
			});
			const v$x = __rt.memo("x", (__prev) => __rt.awaited(__B.fetch("x:" + v$n())), undefined);
			__rt.reg("x", { get: v$x });
			const v$y = __rt.memo("y", (__prev) => __rt.awaited(__B.fetch("y:" + v$x())), undefined);
			__rt.reg("y", { get: v$y });
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
							var _el$7 = _$createTextNode(" ");
							var _el$5 = _$createElement("p");
							var _el$8 = _$createTextNode(" ");
							var _el$6 = _$createElement("i");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$7);
							_$insertNode(_el$3, _el$5);
							_$insertNode(_el$3, _el$8);
							_$insertNode(_el$3, _el$6);
							_$insert(_el$4, () => {
								return __rt.show(__B.str(__rt.isPending(() => v$x())) + "," + __B.str(v$x()));
							});
							_$insert(_el$5, () => {
								return __rt.show(__B.str(__rt.isPending(() => __rt.latest(() => v$x()))) + "," + __B.str(__rt.latest(() => v$x())));
							});
							_$insert(_el$6, () => {
								return __rt.show(v$y());
							});
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

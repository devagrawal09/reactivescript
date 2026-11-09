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
			const [v$period, w$period] = __rt.source("period", __rt.untrack(() => 1));
			__rt.reg("period", {
				get: v$period,
				w: w$period
			});
			const v$fast = __rt.deferred("fast", (__prev) => __rt.awaited(__B.fetch("f:" + v$period())), undefined);
			__rt.reg("fast", { get: v$fast });
			const v$slow = __rt.deferred("slow", (__prev) => __rt.awaited(__B.fetch("s:" + v$period())), undefined);
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
							var _el$4 = _$createElement("h1");
							var _el$5 = _$createTextNode("Period ");
							var _el$12 = _$createTextNode(" ");
							var _el$6 = _$createElement("p");
							var _el$7 = _$createTextNode("fast ");
							var _el$8 = _$createTextNode(" ");
							var _el$13 = _$createTextNode(" ");
							var _el$9 = _$createElement("p");
							var _el$10 = _$createTextNode("slow ");
							var _el$11 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$12);
							_$insertNode(_el$3, _el$6);
							_$insertNode(_el$3, _el$13);
							_$insertNode(_el$3, _el$9);
							_$insertNode(_el$4, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$period());
							}, null);
							_$insertNode(_el$6, _el$7);
							_$insertNode(_el$6, _el$8);
							_$insert(_el$6, () => {
								return __rt.show(v$fast());
							}, _el$8);
							_$insert(_el$6, () => {
								return __rt.show(__rt.isPending(() => v$fast()));
							}, null);
							_$insertNode(_el$9, _el$10);
							_$insertNode(_el$9, _el$11);
							_$insert(_el$9, () => {
								return __rt.show(v$slow());
							}, _el$11);
							_$insert(_el$9, () => {
								return __rt.show(__rt.isPending(() => v$slow()));
							}, null);
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

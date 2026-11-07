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
			const [v$b, w$b] = __rt.source("b", __rt.untrack(() => 0));
			__rt.reg("b", {
				get: v$b,
				w: w$b
			});
			const [v$k, w$k] = __rt.source("k", __rt.untrack(() => 0));
			__rt.reg("k", {
				get: v$k,
				w: w$k
			});
			const v$fast = __rt.memo("fast", (__prev) => __rt.awaited(__B.fetch("f:" + v$k())), undefined);
			__rt.reg("fast", { get: v$fast });
			const v$slow = __rt.memo("slow", (__prev) => __rt.awaited(__B.fetch("s:" + v$k() + ":" + v$b())), undefined);
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
							var _el$5 = _$createTextNode("B ");
							var _el$6 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$6);
							_$insertNode(_el$4, _el$5);
							_$insert(_el$4, () => {
								return __rt.show(v$b());
							}, null);
							_$insert(_el$3, _$createComponent(_$Loading, {
								get on() {
									return v$k();
								},
								get fallback() {
									return (() => {
										var _el$7 = _$createElement("p");
										_$insertNode(_el$7, _$createTextNode("Loading"));
										return _el$7;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return [(() => {
											var _el$8 = _$createElement("p");
											var _el$9 = _$createTextNode("Fast ");
											_$insertNode(_el$8, _el$9);
											_$insert(_el$8, () => {
												return __rt.show(v$fast());
											}, null);
											return _el$8;
										})(), (() => {
											var _el$10 = _$createElement("p");
											var _el$11 = _$createTextNode("Slow ");
											_$insertNode(_el$10, _el$11);
											_$insert(_el$10, () => {
												return __rt.show(v$slow());
											}, null);
											return _el$10;
										})()];
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

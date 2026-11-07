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
			const [v$period, w$period] = __rt.source("period", __rt.untrack(() => "q1"));
			__rt.reg("period", {
				get: v$period,
				w: w$period
			});
			const v$summary = __rt.memo("summary", (__prev) => __rt.awaited(__B.fetch("s:" + v$period())), undefined);
			__rt.reg("summary", { get: v$summary });
			const v$trend = __rt.memo("trend", (__prev) => __rt.awaited(__B.fetch("t:" + v$period())), undefined);
			__rt.reg("trend", { get: v$trend });
			const v$audit = __rt.memo("audit", (__prev) => __rt.awaited(__B.fetch("a:" + v$period())), undefined);
			__rt.reg("audit", { get: v$audit });
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
							_$insertNode(_el$3, _el$4);
							_$insert(_el$4, () => {
								return __rt.show(__rt.latest(() => v$period()));
							});
							_$insert(_el$3, _$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$5 = _$createElement("p");
										_$insertNode(_el$5, _$createTextNode("skel"));
										return _el$5;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$6 = _$createElement("div");
											var _el$7 = _$createElement("p");
											var _el$10 = _$createTextNode(" ");
											var _el$8 = _$createElement("p");
											var _el$11 = _$createTextNode(" ");
											var _el$9 = _$createElement("p");
											_$insertNode(_el$6, _el$7);
											_$insertNode(_el$6, _el$10);
											_$insertNode(_el$6, _el$8);
											_$insertNode(_el$6, _el$11);
											_$insertNode(_el$6, _el$9);
											_$insert(_el$7, () => {
												return __rt.show(v$summary());
											});
											_$insert(_el$8, () => {
												return __rt.show(v$trend());
											});
											_$insert(_el$9, () => {
												return __rt.show(v$audit());
											});
											return _el$6;
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

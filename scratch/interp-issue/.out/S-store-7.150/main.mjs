import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$ren = __rt.action(function* (v$i) {
				try {
					w$rows.guess("x", [v$i, "title"]);
					yield __rt.awaited(__B.fetch("save"));
				} catch (v$e) {}
			});
			__rt.reg("ren", { value: v$ren });
			const [v$filter, w$filter] = __rt.source("filter", __rt.untrack(() => "open"));
			__rt.reg("filter", {
				get: v$filter,
				w: w$filter
			});
			const [v$rows, w$rows] = __rt.question("rows", (__prev) => __rt.awaited(__B.fetch("l:" + v$filter())), undefined, {
				optimistic: true,
				structured: true
			}, "id");
			__rt.reg("rows", {
				get: v$rows,
				w: w$rows
			});
			const v$shown = __rt.memo("shown", (__prev) => __rt.latest(() => v$rows()), undefined);
			__rt.reg("shown", { get: v$shown });
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
						return [(() => {
							var _el$3 = _$createElement("b");
							_$insert(_el$3, () => {
								return __rt.show(__B.len(v$shown()));
							});
							return _el$3;
						})(), _$createComponent(_$Loading, {
							get on() {
								return v$filter();
							},
							get fallback() {
								return (() => {
									var _el$4 = _$createElement("p");
									_$insertNode(_el$4, _$createTextNode("loading"));
									return _el$4;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return (() => {
										var _el$5 = _$createElement("ul");
										_$insert(_el$5, _$createComponent(_$For, {
											get each() {
												return v$rows();
											},
											children: (v$t) => {
												const __o = __rt.owner();
												return (() => {
													var _el$6 = _$createElement("li");
													_$insert(_el$6, () => {
														return __rt.show(v$t?.title);
													});
													return _el$6;
												})();
											}
										}));
										return _el$5;
									})();
								})();
							}
						})];
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

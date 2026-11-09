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
		function v$rows_title(v$rs) {
			return v$rs?.map((v$r) => v$r?.title)?.join(",");
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$ren = __rt.action(function* () {
				try {
					w$rows.guess("x", [0, "title"]);
					yield __rt.awaited(__B.fetch("save"));
					__rt.refresh("rows", v$rows);
				} catch (v$e) {}
			});
			__rt.reg("ren", { value: v$ren });
			const [v$rows, w$rows] = __rt.question("rows", (__prev) => __rt.awaited(__B.fetch("l")), undefined, {
				optimistic: true,
				structured: true
			}, "id");
			__rt.reg("rows", {
				get: v$rows,
				w: w$rows
			});
			__rt.effect(1, () => [v$rows()], ($p) => __rt.untrack(() => {
				return __B.log(v$rows_title($p[0]));
			}));
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					_$insertNode(_el$, _$createTextNode("error"));
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get fallback() {
								return (() => {
									var _el$2 = _$createElement("p");
									_$insertNode(_el$2, _$createTextNode("loading"));
									return _el$2;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return (() => {
										var _el$3 = _$createElement("b");
										_$insert(_el$3, _$createComponent(_$For, {
											get each() {
												return v$rows();
											},
											children: (v$t) => {
												const __o = __rt.owner();
												return (() => {
													var _el$4 = _$createElement("i");
													_$insert(_el$4, () => {
														return __rt.show(v$t?.title);
													});
													return _el$4;
												})();
											}
										}));
										return _el$3;
									})();
								})();
							}
						});
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

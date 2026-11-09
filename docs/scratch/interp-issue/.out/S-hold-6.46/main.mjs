import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$NotFound;
function g$NotFound(__rt) {
	const __B = __rt.B;
	return c$NotFound ??= __rt.errorClass("NotFound", ["id"], (v$id) => "item " + __rt.fmt(v$id) + " not found");
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$NotFound = g$NotFound(__rt);
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Loading, {
				get on() {
					return v$sel();
				},
				get fallback() {
					return (() => {
						var _el$ = _$createElement("p");
						_$insertNode(_el$, _$createTextNode("loading…"));
						return _el$;
					})();
				},
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Errored, {
							fallback: (v$e) => (() => {
								var _el$2 = _$createElement("p");
								_$insert(_el$2, () => {
									return __rt.show(v$e()?.message);
								});
								return _el$2;
							})(),
							get children() {
								return (() => {
									const __o = __rt.owner();
									return (() => {
										var _el$3 = _$createElement("p");
										_$insert(_el$3, () => {
											return __rt.show(v$shown());
										});
										return _el$3;
									})();
								})();
							}
						});
					})();
				}
			});
		}
		const [v$sel, w$sel] = __rt.source("sel", __rt.untrack(() => 4));
		__rt.reg("sel", {
			get: v$sel,
			w: w$sel
		});
		const v$item = __rt.memo("item", (__prev) => __rt.awaited(__B.fetch("i:" + v$sel())), undefined);
		__rt.reg("item", { get: v$item });
		const v$shown = __rt.memo("shown", (__prev) => __rt.eq(v$item(), null) ? __rt.throw(v$NotFound(v$sel())) : v$item(), undefined);
		__rt.reg("shown", { get: v$shown });
		return _$createComponent(V$App, { children: [] });
	};
}

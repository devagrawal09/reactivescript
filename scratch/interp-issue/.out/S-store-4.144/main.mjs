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
			const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
			__rt.reg("id", {
				get: v$id,
				w: w$id
			});
			const [v$profile, w$profile] = __rt.question("profile", (__prev) => __rt.awaited(__B.fetch("p:" + __B.str(v$id()))), undefined, {
				optimistic: false,
				structured: false
			});
			__rt.reg("profile", {
				get: v$profile,
				w: w$profile
			});
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
							var _el$3 = _$createElement("p");
							var _el$4 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insert(_el$3, () => {
								return __rt.show(v$profile());
							}, _el$4);
							_$insert(_el$3, () => {
								return __rt.show(__rt.isPending(() => v$profile()) ? "p" : "-");
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

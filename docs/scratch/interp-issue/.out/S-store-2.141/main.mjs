import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
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
			const p$id = __rt.pre(v$id);
			const v$selected = __rt.draft(__rt.untrack(() => ({})), (v$d) => {
				{
					let __t = v$d;
					__t[__B.str(__rt.preOr(p$id(), () => 0))] = false;
				}
				{
					let __t = v$d;
					__t[__B.str(v$id())] = true;
				}
			});
			__rt.reg("selected", { get: v$selected });
			__rt.effect(1, () => [v$selected()?.["1"]], ($p) => __rt.untrack(() => {
				return __B.log("one", $p[0]);
			}));
			__rt.effect(1, () => [v$selected()?.["2"]], ($p) => __rt.untrack(() => {
				return __B.log("two", $p[0]);
			}));
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$selected()?.["1"] ? "1" : "-");
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$selected()?.["2"] ? "2" : "-");
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

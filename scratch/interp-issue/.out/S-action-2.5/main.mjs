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
			const v$rename = __rt.action(function* (v$n) {
				try {
					w$shown.guess(v$n);
					yield __rt.awaited(__B.fetch("send"));
					yield __rt.awaited(__rt.until(() => __rt.eq(v$shown(), v$n)));
					w$status.set("confirmed");
				} catch (v$e) {
					w$status.set(v$e?.message);
				}
			});
			__rt.reg("rename", { value: v$rename });
			const [v$name, w$name] = __rt.source("name", __rt.untrack(() => "Ann"));
			__rt.reg("name", {
				get: v$name,
				w: w$name
			});
			const [v$shown, w$shown] = __rt.question("shown", (__prev) => v$name(), undefined, {
				optimistic: true,
				structured: false
			});
			__rt.reg("shown", {
				get: v$shown,
				w: w$shown
			});
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$shown());
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$status());
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

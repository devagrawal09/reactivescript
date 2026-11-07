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
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			return (() => {
				var _el$ = _$createElement("button", { onClick: () => __rt.action(function* () {
					__rt.onFlush(() => {
						w$status.set("saving");
					});
					let v$r;
					try {
						v$r = yield __rt.awaited(__B.fetch("save"));
					} catch (v$e) {
						if (!__rt.isA(v$e, undefined)) throw v$e;
						v$r = v$e?.message;
					}
					w$status.set(v$r);
				})() });
				var _el$2 = _$createTextNode("status: ");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$status());
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$Declined;
function g$Declined(__rt) {
	const __B = __rt.B;
	return c$Declined ??= __rt.errorClass("Declined", ["reason"], (v$reason) => "declined: " + __rt.fmt(v$reason));
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$Declined = g$Declined(__rt);
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$place = __rt.action(function* () {
				try {
					let v$r;
					try {
						v$r = yield __rt.awaited(__B.fetch("checkout"));
					} catch (v$e) {
						if (!__rt.isA(v$e, [v$Declined])) throw v$e;
						v$r = "declined";
					}
					w$status.set("got " + __rt.fmt(v$r));
				} catch (v$e) {
					w$status.set("failed: " + __rt.fmt(v$e?.message));
				}
			});
			__rt.reg("place", { value: v$place });
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			return (() => {
				var _el$ = _$createElement("p");
				_$insert(_el$, () => {
					return __rt.show(v$status());
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

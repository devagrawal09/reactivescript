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
			const v$attempt = __rt.action(function* () {
				try {
					w$guess.guess(5);
					yield __rt.awaited(__B.fetch("unrelated"));
				} catch (__e) {}
			});
			__rt.reg("attempt", { value: v$attempt });
			const [v$truth, w$truth] = __rt.source("truth", __rt.untrack(() => 1));
			__rt.reg("truth", {
				get: v$truth,
				w: w$truth
			});
			const [v$guess, w$guess] = __rt.question("guess", (__prev) => v$truth(), undefined, {
				optimistic: true,
				structured: false
			});
			__rt.reg("guess", {
				get: v$guess,
				w: w$guess
			});
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" / ");
				var _el$3 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insert(_el$, () => {
					return __rt.show(v$guess());
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(__rt.latest(() => v$guess()));
				}, _el$3);
				_$insert(_el$, () => {
					return __rt.show(__rt.isPending(() => v$guess()) ? "p" : "-");
				}, null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$like = __rt.action(function* () {
				try {
					let v$r = yield __rt.awaited(__B.fetch("like"));
					w$liked.set(v$r);
				} catch (v$e) {}
			});
			__rt.reg("like", { value: v$like });
			const [v$liked, w$liked] = __rt.question("liked", (__prev) => "no", undefined, {
				optimistic: true,
				structured: false
			});
			__rt.reg("liked", {
				get: v$liked,
				w: w$liked
			});
			return (() => {
				var _el$ = _$createElement("button", { onClick: () => __rt.action(function* () {
					w$liked.guess("yes");
					v$like();
				})() });
				_$insert(_el$, () => {
					return __rt.show(v$liked());
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

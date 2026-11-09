import { createTextNode as _$createTextNode } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { createComponent as _$createComponent } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { insert as _$insert } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { insertNode as _$insertNode } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { createElement as _$createElement } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
// compiled by ReactiveScript ref/compile from U2.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$request = __rt.api("request");
		__rt.reg("request", { value: v$request });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$save = __rt.action(function* (v$amount) {
				w$guess.guess((v$value) => v$value + v$amount);
				try {
					let v$got = yield __rt.awaited(v$request(v$amount));
					w$n.set((v$value) => v$value + v$got);
				} catch (v$error) {}
			});
			__rt.reg("save", { value: v$save });
			const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 0));
			__rt.reg("n", {
				get: v$n,
				w: w$n
			});
			const [v$guess, w$guess] = __rt.question("guess", (__prev) => v$n(), undefined, {
				optimistic: true,
				structured: false
			});
			__rt.reg("guess", {
				get: v$guess,
				w: w$guess
			});
			return (() => {
				var _el$ = _$createElement("section");
				var _el$2 = _$createElement("button", { onClick: () => {
					v$save(2);
				} });
				var _el$3 = _$createElement("button", { onClick: () => {
					v$save(3);
				} });
				var _el$4 = _$createElement("output");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insertNode(_el$, _el$4);
				_$insertNode(_el$2, _$createTextNode("two"));
				_$insertNode(_el$3, _$createTextNode("three"));
				_$insert(_el$4, () => {
					return __rt.show(v$n());
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

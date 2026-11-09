import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$bump = __rt.action(function* () {
				w$n.set(__rt.snapshot(v$n) + 1);
			});
			__rt.reg("bump", { value: v$bump });
			const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 0));
			__rt.reg("n", {
				get: v$n,
				w: w$n
			});
			const [v$note, w$note] = __rt.source("note", __rt.untrack(() => ""));
			__rt.reg("note", {
				get: v$note,
				w: w$note
			});
			return [
				(() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode(" ");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$n());
					}, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$note());
					}, null);
					return _el$;
				})(),
				_$memo(() => {
					return __rt.show(" ");
				}),
				(() => {
					var _el$3 = _$createElement("button", { onClick: () => {
						v$bump();
					} });
					_$insertNode(_el$3, _$createTextNode("+"));
					return _el$3;
				})(),
				(() => {
					var _el$4 = _$createElement("input", { onInput: (v$e) => {
						w$note.set(v$e?.target?.value);
					} });
					_$effect(() => v$note(), (_v$, _$p) => {
						_$setProp(_el$4, "value", _v$, _$p);
					});
					return _el$4;
				})()
			];
		}
		return _$createComponent(V$App, { children: [] });
	};
}

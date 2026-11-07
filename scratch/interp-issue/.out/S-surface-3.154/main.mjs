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
		function V$Badge(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("span");
				_$insert(_el$, () => {
					return __rt.show(v$props?.children);
				});
				_$effect(() => v$props?.class, (_v$, _$p) => {
					_$setProp(_el$, "class", _v$, _$p);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$done, w$done] = __rt.source("done", __rt.untrack(() => false));
			__rt.reg("done", {
				get: v$done,
				w: w$done
			});
			return [(() => {
				var _el$2 = _$createElement("p");
				_$insert(_el$2, _$createComponent(V$Badge, {
					get "class"() {
						return _$memo(() => {
							return !!v$done();
						})() ? v$tones()?.done : v$tones()?.warn;
					},
					get children() {
						return __rt.show(v$done() ? "done" : "open");
					}
				}), null);
				_$insert(_el$2, () => {
					return __rt.show(" ");
				}, null);
				_$insert(_el$2, () => {
					return __rt.show((v$done() ? v$tones()?.done : v$tones()?.warn)?.split(" ")?.[1]);
				}, null);
				return _el$2;
			})(), (() => {
				var _el$3 = _$createElement("button", { onClick: () => {
					w$done.set(true);
				} });
				_$insertNode(_el$3, _$createTextNode("finish"));
				return _el$3;
			})()];
		}
		const v$tones = __rt.memo("tones", (__prev) => Object.freeze({
			"done": "tsrx-c06aba2e done",
			"ok": "tsrx-c06aba2e ok",
			"warn": "tsrx-c06aba2e warn"
		}), undefined);
		__rt.reg("tones", { get: v$tones });
		return _$createComponent(V$App, { children: [] });
	};
}

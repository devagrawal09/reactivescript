import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$Card(v$props) {
			const __o = __rt.owner();
			const [v$open, w$open] = __rt.source("open", __rt.untrack(() => false));
			__rt.reg("open", {
				get: v$open,
				w: w$open
			});
			return (() => {
				var _el$ = _$createElement("div", { class: "card tsrx-0af3549e" });
				var _el$2 = _$createElement("h2", { class: "tsrx-0af3549e" });
				_$insertNode(_el$, _el$2);
				_$insert(_el$2, () => {
					return __rt.show(v$props?.title);
				});
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return v$open();
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const n$open = __item;
						const __o = __rt.owner();
						return (() => {
							var _el$3 = _$createElement("p", { class: "body tsrx-0af3549e" });
							_$insert(_el$3, () => {
								return __rt.show(v$props?.children);
							});
							return _el$3;
						})();
					}
				}), null);
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(V$Card, {
				title: "Hi",
				get children() {
					var _el$4 = _$createElement("b", { class: "tsrx-e24a00ac" });
					_$insertNode(_el$4, _$createTextNode("there"));
					return _el$4;
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

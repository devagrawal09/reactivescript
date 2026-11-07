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
		function V$Greeting(v$props) {
			const __o = __rt.owner();
			const v$shout = __rt.memo("shout", (__prev) => v$props?.name + "!", undefined);
			__rt.reg("shout", { get: v$shout });
			return (() => {
				var _el$ = _$createElement("p");
				var _el$2 = _$createTextNode(" ");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$shout());
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$props?.children);
				}, null);
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$name, w$name] = __rt.source("name", __rt.untrack(() => "a"));
			__rt.reg("name", {
				get: v$name,
				w: w$name
			});
			const [v$show, w$show] = __rt.source("show", __rt.untrack(() => true));
			__rt.reg("show", {
				get: v$show,
				w: w$show
			});
			return (() => {
				var _el$3 = _$createElement("div");
				_$insert(_el$3, _$createComponent(_$Show, {
					get when() {
						return v$show();
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const n$show = __item;
						const __o = __rt.owner();
						return _$createComponent(V$Greeting, {
							get name() {
								return v$name();
							},
							get children() {
								return __rt.show("hi");
							}
						});
					}
				}));
				return _el$3;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

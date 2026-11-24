import { template as _$template } from "@solidjs/web";
import { getNextElement as _$getNextElement } from "@solidjs/web";
import { insert as _$insert } from "@solidjs/web";
import { scope as _$scope } from "@solidjs/web";
import { createComponent as _$createComponent } from "@solidjs/web";
import { delegateEvents as _$delegateEvents } from "@solidjs/web";
import { runHydrationEvents as _$runHydrationEvents } from "@solidjs/web";
var _tmpl$ = /* @__PURE__ */ _$template(`<button>`);
// compiled by ReactiveScript ref/compile from counter.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 0));
			__rt.reg("n", {
				get: v$n,
				w: w$n
			});
			const h$n = __rt.hacc(v$n);
			return (() => {
				var _el$ = _$getNextElement(_tmpl$);
				_el$._$$click = () => {
					w$n.set(__rt.snapshot(h$n) + 1);
				};
				_$insert(_el$, _$scope(() => {
					return __rt.show(h$n());
				}));
				_$runHydrationEvents();
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}
_$delegateEvents(["click"]);

import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const v$theme = __i0["theme"];
		const v$accent = __i0["accent"];
		function V$Label(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("b");
				var _el$2 = _$createTextNode("/");
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(__rt.useGet(v$theme, __o));
				}, _el$2);
				_$insert(_el$, () => {
					return __rt.show(__rt.useGet(v$accent, __o));
				}, null);
				return _el$;
			})();
		}
		function V$Themed(v$props) {
			const __o = __rt.owner();
			__rt.provide(v$theme, {
				get: v$mode,
				w: w$mode
			});
			return (() => {
				var _el$3 = _$createElement("i");
				_$insert(_el$3, () => {
					return __rt.show(v$props?.children);
				});
				return _el$3;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$4 = _$createElement("div");
				var _el$5 = _$createTextNode(" ");
				_$insertNode(_el$4, _el$5);
				_$insert(_el$4, _$createComponent(V$Label, { children: [] }), _el$5);
				_$insert(_el$4, _$createComponent(V$Themed, { get children() {
					return _$createComponent(V$Label, { children: [] });
				} }), null);
				return _el$4;
			})();
		}
		const [v$mode, w$mode] = __rt.source("mode", __rt.untrack(() => "dark"));
		__rt.reg("mode", {
			get: v$mode,
			w: w$mode
		});
		__rt.provide(v$accent, { get: __rt.memo(null, () => "blue") });
		return _$createComponent(V$App, { children: [] });
	};
}

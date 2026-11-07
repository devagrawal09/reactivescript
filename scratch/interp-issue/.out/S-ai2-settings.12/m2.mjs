import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from ui.rx — do not edit
import __m0 from "./m0.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$theme = __i0["theme"];
	const v$density = __i0["density"];
	function V$Panel(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$ = _$createElement("section");
			var _el$2 = _$createElement("h2");
			var _el$3 = _$createTextNode(" [");
			var _el$4 = _$createTextNode("]");
			_$insertNode(_el$, _el$2);
			_$insertNode(_el$2, _el$3);
			_$insertNode(_el$2, _el$4);
			_$insert(_el$2, () => {
				return __rt.show(v$props?.title);
			}, _el$3);
			_$insert(_el$2, () => {
				return __rt.show(__rt.useGet(v$density, __o));
			}, _el$4);
			_$insert(_el$, () => {
				return __rt.show(" ");
			}, null);
			_$insert(_el$, () => {
				return __rt.show(v$props?.children);
			}, null);
			_$effect(() => __rt.useGet(v$density, __o), (_v$, _$p) => {
				_$setProp(_el$, "class", _v$, _$p);
			});
			return _el$;
		})();
	}
	function V$ThemePicker(v$props) {
		const __o = __rt.owner();
		const v$current = __rt.memo("current", (__prev) => __rt.useGet(v$theme, __o)?.current, undefined);
		__rt.reg("current", { get: v$current });
		return (() => {
			var _el$5 = _$createElement("div");
			var _el$6 = _$createElement("span");
			var _el$7 = _$createTextNode("Theme: ");
			var _el$8 = _$createElement("button", { onClick: () => {
				__rt.useGet(v$theme, __o)?.pick("light");
			} });
			var _el$9 = _$createElement("button", { onClick: () => {
				__rt.useGet(v$theme, __o)?.pick("dark");
			} });
			_$insertNode(_el$5, _el$6);
			_$insertNode(_el$5, _el$8);
			_$insertNode(_el$5, _el$9);
			_$insertNode(_el$6, _el$7);
			_$insert(_el$6, () => {
				return __rt.show(v$current());
			}, null);
			_$insert(_el$5, () => {
				return __rt.show(" ");
			}, _el$8);
			_$insertNode(_el$8, _$createTextNode("light"));
			_$insert(_el$5, () => {
				return __rt.show(" ");
			}, _el$9);
			_$insertNode(_el$9, _$createTextNode("dark"));
			return _el$5;
		})();
	}
	function V$Appearance(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$10 = _$createElement("div");
			var _el$11 = _$createElement("p");
			var _el$12 = _$createTextNode("Preview: ");
			var _el$13 = _$createTextNode(" / ");
			_$insertNode(_el$10, _el$11);
			_$insert(_el$10, _$createComponent(V$ThemePicker, { children: [] }), _el$11);
			_$insert(_el$10, () => {
				return __rt.show(" ");
			}, _el$11);
			_$insert(_el$10, () => {
				return __rt.show(v$props?.children);
			}, _el$11);
			_$insert(_el$10, () => {
				return __rt.show(" ");
			}, _el$11);
			_$insertNode(_el$11, _el$12);
			_$insertNode(_el$11, _el$13);
			_$insert(_el$11, () => {
				return __rt.show(__rt.useGet(v$theme, __o)?.current);
			}, _el$13);
			_$insert(_el$11, () => {
				return __rt.show(__rt.useGet(v$density, __o));
			}, null);
			_$effect(() => __rt.useGet(v$theme, __o)?.current, (_v$, _$p) => {
				_$setProp(_el$10, "class", _v$, _$p);
			});
			return _el$10;
		})();
	}
	return {
		"Panel": V$Panel,
		"ThemePicker": V$ThemePicker,
		"Appearance": V$Appearance
	};
}

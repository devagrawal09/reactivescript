import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from ui.rx — do not edit
import __m1 from "./m1.mjs";
import __m0 from "./m0.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i1 = __rt.module("m1.mjs", __m1);
	const v$qtyOf = __i1["qtyOf"];
	const v$setQty = __i1["setQty"];
	const __i0 = __rt.module("m0.mjs", __m0);
	function V$Row(v$props) {
		const __o = __rt.owner();
		const v$qty = __rt.memo("qty", (__prev) => v$qtyOf(v$props?.product?.id), undefined);
		__rt.reg("qty", { get: v$qty });
		return (() => {
			var _el$ = _$createElement("li");
			var _el$2 = _$createElement("span");
			var _el$3 = _$createElement("span");
			var _el$4 = _$createElement("button", { onClick: () => {
				v$setQty(v$props?.product?.id, __rt.snapshot(v$qty) - 1);
			} });
			var _el$5 = _$createElement("span");
			var _el$6 = _$createElement("button", { onClick: () => {
				v$setQty(v$props?.product?.id, __rt.snapshot(v$qty) + 1);
			} });
			_$insertNode(_el$, _el$2);
			_$insertNode(_el$, _el$3);
			_$insertNode(_el$, _el$4);
			_$insertNode(_el$, _el$5);
			_$insertNode(_el$, _el$6);
			_$insert(_el$2, () => {
				return __rt.show(v$props?.product?.name);
			});
			_$insert(_el$3, () => {
				return __rt.show(v$props?.product?.price);
			});
			_$insertNode(_el$4, _$createTextNode("-"));
			_$insert(_el$5, () => {
				return __rt.show(v$qty());
			});
			_$insertNode(_el$6, _$createTextNode("+"));
			_$effect(() => __rt.eq(v$qty(), 0), (_v$, _$p) => {
				_$setProp(_el$4, "disabled", _v$, _$p);
			});
			return _el$;
		})();
	}
	function V$Panel(v$props) {
		const __o = __rt.owner();
		return _$createComponent(_$Errored, {
			fallback: (v$e) => (() => {
				var _el$7 = _$createElement("p", { class: "error" });
				var _el$8 = _$createTextNode(" is unavailable: ");
				_$insertNode(_el$7, _el$8);
				_$insert(_el$7, () => {
					return __rt.show(v$props?.title);
				}, _el$8);
				_$insert(_el$7, () => {
					return __rt.show(v$e()?.message);
				}, null);
				return _el$7;
			})(),
			get children() {
				return (() => {
					const __o = __rt.owner();
					return _$memo(() => {
						return __rt.show(v$props?.children);
					});
				})();
			}
		});
	}
	return {
		"Row": V$Row,
		"Panel": V$Panel
	};
}

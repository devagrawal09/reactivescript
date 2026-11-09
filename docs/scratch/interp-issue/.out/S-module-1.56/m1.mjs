import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from ui.rx — do not edit
import __m0 from "./m0.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$NotFound = __i0["NotFound"];
	const v$initials = __i0["initials"];
	const v$who = __rt.context("who", null);
	__rt.reg("who", { value: v$who });
	function V$Card(v$props) {
		const __o = __rt.owner();
		return _$createComponent(_$Errored, {
			fallback: (v$e) => (() => {
				var _el$ = _$createElement("p");
				_$insertNode(_el$, _$createTextNode("?"));
				return _el$;
			})(),
			get children() {
				return (() => {
					const __o = __rt.owner();
					return (() => {
						var _el$2 = _$createElement("div");
						_$insert(_el$2, () => {
							return __rt.show(v$props?.children);
						});
						return _el$2;
					})();
				})();
			}
		});
	}
	function V$Name(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$3 = _$createElement("i");
			_$insert(_el$3, () => {
				return __rt.show(__rt.catchRead(() => v$props?.user?.name, (__e) => __rt.isA(__e, [v$NotFound]), (v$e) => "nobody"));
			});
			return _el$3;
		})();
	}
	function V$Badge(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$4 = _$createElement("b");
			_$insert(_el$4, () => {
				return __rt.show(v$initials(__rt.useGet(v$who, __o)));
			});
			return _el$4;
		})();
	}
	function V$Save(v$props) {
		const __o = __rt.owner();
		const v$go = __rt.action(function* () {
			__B.log(v$props?.v);
		});
		__rt.reg("go", { value: v$go });
		return (() => {
			var _el$5 = _$createElement("button", { onClick: () => {
				v$go();
			} });
			_$insertNode(_el$5, _$createTextNode("save"));
			return _el$5;
		})();
	}
	function V$Pick(v$props) {
		const __o = __rt.owner();
		__rt.effect(1, () => [v$props?.n], ($p) => __rt.untrack(() => {
			w$picks.set((v$ps) => [...v$ps, v$props?.onPick]);
		}));
		return (() => {
			var _el$6 = _$createElement("u");
			_$insert(_el$6, () => {
				return __rt.show(v$props?.n);
			});
			return _el$6;
		})();
	}
	const [v$picks, w$picks] = __rt.source("picks", __rt.untrack(() => []));
	__rt.reg("picks", {
		get: v$picks,
		w: w$picks
	});
	return {
		"who": v$who,
		"Card": V$Card,
		"Name": V$Name,
		"Badge": V$Badge,
		"Save": V$Save,
		"Pick": V$Pick
	};
}

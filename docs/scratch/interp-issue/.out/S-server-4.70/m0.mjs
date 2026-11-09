import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from row.rx — do not edit
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	function V$Row(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$ = _$createElement("tr");
			var _el$2 = _$createElement("td");
			_$insertNode(_el$, _el$2);
			_$insert(_el$2, () => {
				return __rt.show(v$props?.name);
			});
			return _el$;
		})();
	}
	return { "Row": V$Row };
}

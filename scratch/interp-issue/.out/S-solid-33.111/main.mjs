import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$bump = __rt.action(function* () {
				w$value.set(1);
				w$double.guess(3);
			});
			__rt.reg("bump", { value: v$bump });
			const [v$value, w$value] = __rt.source("value", __rt.untrack(() => 0));
			__rt.reg("value", {
				get: v$value,
				w: w$value
			});
			const [v$double, w$double] = __rt.question("double", (__prev) => __rt.awaited(__B.fetch("d:" + __B.str(v$value()))), undefined, {
				optimistic: true,
				structured: false
			});
			__rt.reg("double", {
				get: v$double,
				w: w$double
			});
			const v$related = __rt.memo("related", (__prev) => __rt.awaited(__B.fetch("r:" + __B.str(v$double()))), undefined);
			__rt.reg("related", { get: v$related });
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("error: ");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get fallback() {
								return (() => {
									var _el$3 = _$createElement("p");
									_$insertNode(_el$3, _$createTextNode("loading"));
									return _el$3;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return (() => {
										var _el$4 = _$createElement("p");
										var _el$5 = _$createTextNode("double=");
										var _el$6 = _$createTextNode(" async=");
										_$insertNode(_el$4, _el$5);
										_$insertNode(_el$4, _el$6);
										_$insert(_el$4, () => {
											return __rt.show(v$double());
										}, _el$6);
										_$insert(_el$4, () => {
											return __rt.show(v$related());
										}, null);
										return _el$4;
									})();
								})();
							}
						});
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

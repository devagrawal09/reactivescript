import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
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
		const v$viewport = __rt.api("viewport");
		__rt.reg("viewport", { value: v$viewport });
		const v$timeZone = __rt.api("timeZone");
		__rt.reg("timeZone", { value: v$timeZone });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$width = __rt.memo("width", (__prev) => __rt.awaited(v$viewport()), __rt.clientQuestion(undefined));
			__rt.reg("width", { get: v$width });
			const v$zone = __rt.memo("zone", (__prev) => __rt.awaited(v$timeZone()), __rt.clientQuestion(__rt.firstPaint(() => "UTC")));
			__rt.reg("zone", { get: v$zone });
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					_$insertNode(_el$, _$createTextNode("error"));
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return [
							(() => {
								var _el$2 = _$createElement("p");
								var _el$3 = _$createTextNode("zone ");
								_$insertNode(_el$2, _el$3);
								_$insert(_el$2, () => {
									return __rt.show(v$zone());
								}, null);
								return _el$2;
							})(),
							_$memo(() => {
								return __rt.show(" ");
							}),
							_$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$4 = _$createElement("p");
										_$insertNode(_el$4, _$createTextNode("measuring"));
										return _el$4;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$5 = _$createElement("p");
											_$insert(_el$5, () => {
												return __rt.show(v$width() < 600 ? "narrow" : "wide");
											});
											return _el$5;
										})();
									})();
								}
							})
						];
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

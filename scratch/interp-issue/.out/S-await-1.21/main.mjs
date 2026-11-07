import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$Declined;
function g$Declined(__rt) {
	const __B = __rt.B;
	return c$Declined ??= __rt.errorClass("Declined", ["reason"], (v$reason) => "declined: " + __rt.fmt(v$reason));
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$Declined = g$Declined(__rt);
		function V$Badge(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("b");
				_$insert(_el$, () => {
					return __rt.show(v$props?.v);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$place = __rt.action(function* () {
				let v$r;
				try {
					v$r = yield __rt.awaited(__B.fetch("checkout"));
				} catch (v$e) {
					if (!__rt.isA(v$e, undefined)) throw v$e;
					v$r = "none";
				}
				w$status.set("got " + __rt.fmt(v$r));
			});
			__rt.reg("place", { value: v$place });
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			const [v$more, w$more] = __rt.source("more", __rt.untrack(() => false));
			__rt.reg("more", {
				get: v$more,
				w: w$more
			});
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$2 = _$createElement("p");
					var _el$3 = _$createTextNode("error: ");
					_$insertNode(_el$2, _el$3);
					_$insert(_el$2, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$2;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get fallback() {
								return (() => {
									var _el$4 = _$createElement("p");
									_$insertNode(_el$4, _$createTextNode("…"));
									return _el$4;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									const a$$0 = __rt.memo(null, () => __rt.awaited(__B.fetch("x")), undefined);
									const a$$1 = __rt.memo(null, () => __rt.awaited(__B.fetch("y")), undefined);
									const a$$2 = __rt.memo(null, () => v$more() ? __rt.awaited(__B.fetch("z")) : undefined, undefined);
									return (() => {
										var _el$5 = _$createElement("p");
										var _el$6 = _$createTextNode(" ");
										var _el$7 = _$createTextNode(" ");
										var _el$8 = _$createTextNode(" ");
										_$insertNode(_el$5, _el$6);
										_$insertNode(_el$5, _el$7);
										_$insertNode(_el$5, _el$8);
										_$insert(_el$5, () => {
											return __rt.show(a$$0());
										}, _el$6);
										_$insert(_el$5, _$createComponent(V$Badge, {
											get v() {
												return a$$1();
											},
											children: []
										}), _el$7);
										_$insert(_el$5, () => {
											return __rt.show(v$more() ? a$$2() : "-");
										}, _el$8);
										_$insert(_el$5, () => {
											return __rt.show(v$status());
										}, null);
										return _el$5;
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

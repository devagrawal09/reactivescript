import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$Detail(v$props) {
			const __o = __rt.owner();
			const v$item = __rt.memo("item", (__prev) => __rt.awaited(__B.fetch("item:" + v$props?.id)), undefined);
			__rt.reg("item", { get: v$item });
			const i$heading = __rt.memo("heading", (__prev) => v$props?.titles?.[v$props?.id], undefined);
			const v$heading = __rt.catchMemo(() => i$heading(), (__e) => __rt.isA(__e, undefined), (v$e) => v$item()?.title);
			__rt.reg("heading", { get: v$heading });
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("detail failed: ");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$3 = _$createElement("h2");
							_$insert(_el$3, () => {
								return __rt.show(v$heading());
							});
							return _el$3;
						})();
					})();
				}
			});
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$titles = __rt.memo("titles", (__prev) => __rt.awaited(__B.fetch("titles")), undefined);
			__rt.reg("titles", { get: v$titles });
			return (() => {
				var _el$4 = _$createElement("div");
				_$insert(_el$4, _$createComponent(_$Errored, {
					fallback: (v$e) => (() => {
						var _el$5 = _$createElement("p");
						var _el$6 = _$createTextNode("list failed: ");
						_$insertNode(_el$5, _el$6);
						_$insert(_el$5, () => {
							return __rt.show(v$e()?.message);
						}, null);
						return _el$5;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return (() => {
								var _el$7 = _$createElement("p");
								_$insert(_el$7, () => {
									return __rt.show(v$titles()?.length);
								});
								return _el$7;
							})();
						})();
					}
				}), null);
				_$insert(_el$4, _$createComponent(V$Detail, {
					id: 1,
					get titles() {
						return v$titles();
					},
					children: []
				}), null);
				return _el$4;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

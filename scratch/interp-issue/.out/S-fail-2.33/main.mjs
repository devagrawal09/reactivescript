import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$Missing;
function g$Missing(__rt) {
	const __B = __rt.B;
	return c$Missing ??= __rt.errorClass("Missing", ["key"], (v$key) => "missing " + __rt.fmt(v$key));
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$Missing = g$Missing(__rt);
		function V$Safe(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					_$insertNode(_el$, _$createTextNode("unavailable"));
					return _el$;
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
		function V$Line(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$2 = _$createElement("p");
				_$insert(_el$2, () => {
					return __rt.show(__rt.catchRead(() => v$props?.text, (__e) => __rt.isA(__e, [v$Missing]), (v$e) => "-"));
				});
				return _el$2;
			})();
		}
		function V$Panel(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$3 = _$createElement("p");
				_$insert(_el$3, () => {
					return __rt.show(v$props?.body);
				});
				return _el$3;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$4 = _$createElement("div");
				var _el$6 = _$createElement("p");
				_$insertNode(_el$4, _el$6);
				_$insert(_el$4, _$createComponent(V$Safe, { get children() {
					var _el$5 = _$createElement("p");
					_$insert(_el$5, () => {
						return __rt.show(v$value());
					});
					return _el$5;
				} }), _el$6);
				_$insert(_el$4, _$createComponent(V$Safe, { get children() {
					return _$createComponent(V$Line, {
						get text() {
							return v$value();
						},
						children: []
					});
				} }), _el$6);
				_$insert(_el$4, _$createComponent(_$Errored, {
					fallback: (v$e) => (() => {
						var _el$7 = _$createElement("p");
						_$insert(_el$7, () => {
							return __rt.show(v$e()?.message);
						});
						return _el$7;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(V$Panel, {
								get body() {
									return v$value();
								},
								children: []
							});
						})();
					}
				}), _el$6);
				_$insert(_el$6, () => {
					return __rt.show(v$other());
				});
				return _el$4;
			})();
		}
		const [v$key, w$key] = __rt.source("key", __rt.untrack(() => "a"));
		__rt.reg("key", {
			get: v$key,
			w: w$key
		});
		const v$value = __rt.memo("value", (__prev) => __rt.eq(v$key(), "") ? __rt.throw(v$Missing(v$key())) : __rt.awaited(__B.fetch("v:" + v$key())), undefined);
		__rt.reg("value", { get: v$value });
		const i$other = __rt.memo("other", (__prev) => __rt.awaited(__B.fetch("w:" + v$key())), undefined);
		const v$other = __rt.catchMemo(() => i$other(), (__e) => __rt.isA(__e, undefined), (v$e) => "none");
		__rt.reg("other", { get: v$other });
		return _$createComponent(V$App, { children: [] });
	};
}

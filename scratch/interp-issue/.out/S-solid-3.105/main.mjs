import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$x, w$x] = __rt.source("x", __rt.untrack(() => 0));
			__rt.reg("x", {
				get: v$x,
				w: w$x
			});
			const [v$show, w$show] = __rt.source("show", __rt.untrack(() => false));
			__rt.reg("show", {
				get: v$show,
				w: w$show
			});
			const [v$title, w$title] = __rt.source("title", __rt.untrack(() => ""));
			__rt.reg("title", {
				get: v$title,
				w: w$title
			});
			const v$slow = __rt.memo("slow", (__prev) => __rt.awaited(__B.fetch("slow:" + v$x())), undefined);
			__rt.reg("slow", { get: v$slow });
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
						return (() => {
							var _el$3 = _$createElement("div");
							var _el$4 = _$createElement("h1");
							var _el$7 = _$createTextNode(" ");
							var _el$5 = _$createElement("i");
							var _el$8 = _$createTextNode(" ");
							var _el$6 = _$createElement("b");
							var _el$9 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$7);
							_$insertNode(_el$3, _el$5);
							_$insertNode(_el$3, _el$8);
							_$insertNode(_el$3, _el$6);
							_$insertNode(_el$3, _el$9);
							_$insert(_el$4, () => {
								return __rt.show(v$x());
							});
							_$insert(_el$5, () => {
								return __rt.show(v$slow());
							});
							_$insert(_el$6, () => {
								return __rt.show(v$title());
							});
							_$insert(_el$3, _$createComponent(_$Show, {
								get when() {
									return v$show();
								},
								get fallback() {
									const __o = __rt.owner();
									return null;
								},
								children: (__item) => {
									const n$show = __item;
									const __o = __rt.owner();
									const v$m = __rt.memo("m", (__prev) => v$x() * 10, undefined);
									__rt.reg("m", { get: v$m });
									return (() => {
										var _el$10 = _$createElement("p");
										var _el$11 = _$createTextNode(" ");
										_$insertNode(_el$10, _el$11);
										_$insert(_el$10, () => {
											return __rt.show(v$m());
										}, _el$11);
										_$insert(_el$10, () => {
											return __rt.show(v$x());
										}, null);
										return _el$10;
									})();
								}
							}), null);
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const v$user = __i0["user"];
		const v$posts = __i0["posts"];
		const v$NotFound = __rt.jsError("NotFound");
		__rt.reg("NotFound", { value: v$NotFound });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$count = __rt.memo("count", (__prev) => __B.len(v$posts()) > 2 ? __B.fail("db password is hunter2") : __B.len(v$posts()), undefined);
			__rt.reg("count", { get: v$count });
			return (() => {
				var _el$ = _$createElement("main");
				var _el$2 = _$createElement("h1");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$2, _$createTextNode("Profile"));
				_$insert(_el$, () => {
					return __rt.show(" ");
				}, null);
				_$insert(_el$, _$createComponent(__rt.TypedErrored, {
					classes: [v$NotFound],
					fallback: (v$e) => (() => {
						var _el$3 = _$createElement("p");
						_$insert(_el$3, () => {
							return __rt.show(v$e()?.message);
						});
						return _el$3;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$4 = _$createElement("p");
										_$insertNode(_el$4, _$createTextNode("loading user"));
										return _el$4;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$5 = _$createElement("p");
											_$insert(_el$5, () => {
												return __rt.show(v$user()?.name);
											});
											return _el$5;
										})();
									})();
								}
							});
						})();
					}
				}), null);
				_$insert(_el$, () => {
					return __rt.show(" ");
				}, null);
				_$insert(_el$, _$createComponent(_$Errored, {
					fallback: (v$e) => (() => {
						var _el$6 = _$createElement("p");
						var _el$7 = _$createTextNode("error: ");
						_$insertNode(_el$6, _el$7);
						_$insert(_el$6, () => {
							return __rt.show(v$e()?.message);
						}, null);
						return _el$6;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$8 = _$createElement("p");
										_$insertNode(_el$8, _$createTextNode("loading posts"));
										return _el$8;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$9 = _$createElement("p");
											var _el$10 = _$createTextNode(" posts");
											_$insertNode(_el$9, _el$10);
											_$insert(_el$9, () => {
												return __rt.show(v$count());
											}, _el$10);
											return _el$9;
										})();
									})();
								}
							});
						})();
					}
				}), null);
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

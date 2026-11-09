import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$BadId;
function g$BadId(__rt) {
	const __B = __rt.B;
	return c$BadId ??= __rt.errorClass("BadId", ["id"], (v$id) => "bad id " + __rt.fmt(v$id));
}
let c$NotFound;
function g$NotFound(__rt) {
	const __B = __rt.B;
	return c$NotFound ??= __rt.errorClass("NotFound", ["id"], (v$id) => "no user " + __rt.fmt(v$id));
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$BadId = g$BadId(__rt);
		const v$NotFound = g$NotFound(__rt);
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("down: ");
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
							var _el$3 = _$createElement("p");
							_$insert(_el$3, () => {
								return __rt.show(__rt.catchRead(() => v$name(), (__e) => __rt.isA(__e, [v$NotFound]), (v$e) => "(nobody)"));
							});
							return _el$3;
						})();
					})();
				}
			});
		}
		const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
		__rt.reg("id", {
			get: v$id,
			w: w$id
		});
		const v$user = __rt.memo("user", (__prev) => v$id() > 0 ? __rt.awaited(__B.fetch("u:" + v$id())) : __rt.throw(v$BadId(v$id())), undefined);
		__rt.reg("user", { get: v$user });
		const v$name = __rt.memo("name", (__prev) => __rt.eq(v$user(), null) ? __rt.throw(v$NotFound(v$id())) : v$user()?.name, undefined);
		__rt.reg("name", { get: v$name });
		return _$createComponent(V$App, { children: [] });
	};
}

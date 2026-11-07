import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fetchUser = __rt.api("fetchUser");
		__rt.reg("fetchUser", { value: v$fetchUser });
		const v$saveUser = __rt.api("saveUser");
		__rt.reg("saveUser", { value: v$saveUser });
		const v$NotFound = __rt.jsError("NotFound");
		__rt.reg("NotFound", { value: v$NotFound });
		const v$Offline = __rt.jsError("Offline");
		__rt.reg("Offline", { value: v$Offline });
		const v$User = __rt.api("User");
		__rt.reg("User", { value: v$User });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$rename = __rt.action(function* (v$n) {
				try {
					yield __rt.awaited(v$saveUser(__rt.snapshot(v$id), v$n));
					w$status.set("saved");
				} catch (v$e) {
					if (!__rt.isA(v$e, [v$Offline])) throw v$e;
					w$status.set("offline");
				}
			});
			__rt.reg("rename", { value: v$rename });
			const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
			__rt.reg("id", {
				get: v$id,
				w: w$id
			});
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			const i$user = __rt.memo("user", (__prev) => __rt.awaited(v$fetchUser(v$id())), undefined);
			const v$user = __rt.catchMemo(() => i$user(), (__e) => __rt.isA(__e, [v$NotFound]), (v$e) => null);
			__rt.reg("user", { get: v$user });
			return _$createComponent(__rt.TypedErrored, {
				classes: [v$Offline],
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("offline: ");
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
							var _el$4 = _$createTextNode(" ");
							_$insertNode(_el$3, _el$4);
							_$insert(_el$3, () => {
								return __rt.show(__rt.eq(v$user(), null) ? "no such user" : v$user()?.name);
							}, _el$4);
							_$insert(_el$3, () => {
								return __rt.show(v$status());
							}, null);
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

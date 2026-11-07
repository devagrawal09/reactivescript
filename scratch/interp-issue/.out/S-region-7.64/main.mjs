import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fields = __rt.context("fields", null);
		__rt.reg("fields", { value: v$fields });
		function V$Form(v$props) {
			const __o = __rt.owner();
			const v$add = __rt.action(function* (v$r) {
				w$rows.set((v$f) => [...v$f, v$r]);
			});
			__rt.reg("add", { value: v$add });
			const v$remove = __rt.action(function* (v$r) {
				w$rows.set((v$f) => __B.filter(v$f, (v$x) => !__rt.eq(v$x, v$r)));
			});
			__rt.reg("remove", { value: v$remove });
			const [v$rows, w$rows] = __rt.source("rows", __rt.untrack(() => []));
			__rt.reg("rows", {
				get: v$rows,
				w: w$rows
			});
			__rt.provide(v$fields, { get: __rt.memo(null, () => ({
				"add": v$add,
				"remove": v$remove
			})) });
			const v$valid = __rt.memo("valid", (__prev) => __B.every(v$rows(), (v$f) => v$f?.ok), undefined);
			__rt.reg("valid", { get: v$valid });
			return (() => {
				var _el$ = _$createElement("div");
				var _el$4 = _$createTextNode(" ");
				var _el$2 = _$createElement("p");
				var _el$3 = _$createTextNode(" ");
				_$insertNode(_el$, _el$4);
				_$insertNode(_el$, _el$2);
				_$insert(_el$, () => {
					return __rt.show(v$props?.children);
				}, _el$4);
				_$insertNode(_el$2, _el$3);
				_$insert(_el$2, () => {
					return __rt.show(__B.len(v$rows()));
				}, _el$3);
				_$insert(_el$2, () => {
					return __rt.show(v$valid() ? "valid" : "invalid");
				}, null);
				return _el$;
			})();
		}
		function V$Field(v$props) {
			const __o = __rt.owner();
			const v$ok = __rt.memo("ok", (__prev) => !__rt.eq(v$props?.value, ""), undefined);
			__rt.reg("ok", { get: v$ok });
			const v$reg = __rt.memo("reg", (__prev) => __rt.useGet(v$fields, __o), undefined);
			__rt.reg("reg", { get: v$reg });
			__rt.effect(1, () => [v$ok()], ($p) => __rt.untrack(() => {
				let v$row = { "ok": $p[0] };
				__rt.snapshot(v$reg)?.add(v$row);
				return () => {
					__rt.snapshot(v$reg)?.remove(v$row);
				};
			}));
			return (() => {
				var _el$5 = _$createElement("i");
				_$insert(_el$5, () => {
					return __rt.show(v$props?.value);
				});
				return _el$5;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$showEmail, w$showEmail] = __rt.source("showEmail", __rt.untrack(() => true));
			__rt.reg("showEmail", {
				get: v$showEmail,
				w: w$showEmail
			});
			const [v$name, w$name] = __rt.source("name", __rt.untrack(() => ""));
			__rt.reg("name", {
				get: v$name,
				w: w$name
			});
			const [v$email, w$email] = __rt.source("email", __rt.untrack(() => ""));
			__rt.reg("email", {
				get: v$email,
				w: w$email
			});
			return _$createComponent(V$Form, { get children() {
				return [_$createComponent(V$Field, {
					get value() {
						return v$name();
					},
					children: []
				}), _$createComponent(_$Show, {
					get when() {
						return v$showEmail();
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const n$showEmail = __item;
						const __o = __rt.owner();
						return _$createComponent(V$Field, {
							get value() {
								return v$email();
							},
							children: []
						});
					}
				})];
			} });
		}
		return _$createComponent(V$App, { children: [] });
	};
}

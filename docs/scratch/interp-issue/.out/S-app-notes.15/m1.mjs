import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from ui.rx — do not edit
import __m0 from "./m0.mjs";
let c$TitleRequired;
function g$TitleRequired(__rt) {
	const __B = __rt.B;
	return c$TitleRequired ??= __rt.errorClass("TitleRequired", [], () => "a note needs a title");
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$open = __i0["open"];
	const v$save = __i0["save"];
	const v$saveError = __i0["saveError"];
	const v$TitleRequired = g$TitleRequired(__rt);
	function V$Row(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$ = _$createElement("tr");
			var _el$2 = _$createElement("td");
			var _el$3 = _$createElement("a", { onClick: () => {
				v$open(v$props?.note?.id);
			} });
			var _el$4 = _$createElement("td", { class: "when" });
			_$insertNode(_el$, _el$2);
			_$insertNode(_el$, _el$4);
			_$insertNode(_el$2, _el$3);
			_$insert(_el$3, () => {
				return __rt.show(v$props?.note?.title);
			});
			_$insert(_el$4, () => {
				return __rt.show(v$props?.note?.updated);
			});
			return _el$;
		})();
	}
	function V$NoteList(v$props) {
		const __o = __rt.owner();
		return _$createComponent(_$Show, {
			get when() {
				return __rt.eq(__B.len(v$props?.notes), 0);
			},
			get fallback() {
				const __o = __rt.owner();
				return (() => {
					var _el$5 = _$createElement("table", { class: "tsrx-fe8dc142" });
					var _el$6 = _$createElement("tbody", { class: "tsrx-fe8dc142" });
					_$insertNode(_el$5, _el$6);
					_$insert(_el$6, _$createComponent(_$For, {
						get each() {
							return v$props?.notes;
						},
						children: (v$n) => {
							const __o = __rt.owner();
							return _$createComponent(V$Row, {
								note: v$n,
								children: []
							});
						}
					}));
					return _el$5;
				})();
			},
			children: (__item) => {
				const __o = __rt.owner();
				return (() => {
					var _el$7 = _$createElement("p", { class: "empty tsrx-fe8dc142" });
					_$insertNode(_el$7, _$createTextNode("no notes"));
					return _el$7;
				})();
			}
		});
	}
	function V$NoteEditor(v$props) {
		const __o = __rt.owner();
		const [v$title, w$title] = __rt.source("title", __rt.untrack(() => __rt.untrack(() => v$props?.note?.title)));
		__rt.reg("title", {
			get: v$title,
			w: w$title
		});
		const [v$body, w$body] = __rt.source("body", __rt.untrack(() => __rt.untrack(() => v$props?.note?.body)));
		__rt.reg("body", {
			get: v$body,
			w: w$body
		});
		const v$problem = __rt.memo("problem", (__prev) => __rt.eq(v$title()?.trim(), "") ? "a note needs a title" : "", undefined);
		__rt.reg("problem", { get: v$problem });
		const v$dirty = __rt.memo("dirty", (__prev) => !__rt.eq(v$title(), v$props?.note?.title) || !__rt.eq(v$body(), v$props?.note?.body), undefined);
		__rt.reg("dirty", { get: v$dirty });
		return (() => {
			var _el$8 = _$createElement("form", { class: "tsrx-4f5a12a8" });
			var _el$9 = _$createElement("input", {
				onInput: (v$e) => {
					w$title.set(v$e?.currentTarget?.value);
				},
				class: "tsrx-4f5a12a8"
			});
			var _el$10 = _$createElement("textarea", {
				onInput: (v$e) => {
					w$body.set(v$e?.currentTarget?.value);
				},
				class: "tsrx-4f5a12a8"
			});
			var _el$11 = _$createElement("button", {
				onClick: () => {
					v$save(v$props?.note?.id, __rt.snapshot(v$title), __rt.snapshot(v$body));
				},
				class: "tsrx-4f5a12a8"
			});
			_$insertNode(_el$8, _el$9);
			_$insertNode(_el$8, _el$10);
			_$insertNode(_el$8, _el$11);
			_$insert(_el$8, _$createComponent(_$Show, {
				get when() {
					return !__rt.eq(v$problem(), "");
				},
				get fallback() {
					const __o = __rt.owner();
					return null;
				},
				children: (__item) => {
					const __o = __rt.owner();
					return (() => {
						var _el$12 = _$createElement("p", { class: "problem tsrx-4f5a12a8" });
						_$insert(_el$12, () => {
							return __rt.show(v$problem());
						});
						return _el$12;
					})();
				}
			}), _el$11);
			_$insert(_el$8, _$createComponent(_$Show, {
				get when() {
					return !__rt.eq(v$saveError(), "");
				},
				get fallback() {
					const __o = __rt.owner();
					return null;
				},
				children: (__item) => {
					const __o = __rt.owner();
					return (() => {
						var _el$13 = _$createElement("p", { class: "error tsrx-4f5a12a8" });
						_$insert(_el$13, () => {
							return __rt.show(v$saveError());
						});
						return _el$13;
					})();
				}
			}), _el$11);
			_$insertNode(_el$11, _$createTextNode("save"));
			_$effect(() => {
				return {
					e: v$title(),
					t: v$body(),
					a: !v$dirty() || !__rt.eq(v$problem(), "")
				};
			}, ({ e, t, a }, _p$) => {
				e !== _p$?.e && _$setProp(_el$9, "value", e, _p$?.e);
				t !== _p$?.t && _$setProp(_el$10, "value", t, _p$?.t);
				a !== _p$?.a && _$setProp(_el$11, "disabled", a, _p$?.a);
			});
			return _el$8;
		})();
	}
	return {
		"TitleRequired": v$TitleRequired,
		"NoteList": V$NoteList,
		"NoteEditor": V$NoteEditor
	};
}

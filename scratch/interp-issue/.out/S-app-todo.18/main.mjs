import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from todo.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		function V$Item(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("li");
				var _el$2 = _$createElement("input", {
					type: "checkbox",
					onChange: () => {
						v$toggle(v$props?.todo?.id);
					}
				});
				var _el$3 = _$createElement("span");
				var _el$4 = _$createElement("button", { onClick: () => {
					v$remove(v$props?.todo?.id);
				} });
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insertNode(_el$, _el$4);
				_$insert(_el$3, () => {
					return __rt.show(v$props?.todo?.title);
				});
				_$insertNode(_el$4, _$createTextNode("×"));
				_$effect(() => {
					return {
						e: v$props?.todo?.done ? "done" : "",
						t: v$props?.todo?.done
					};
				}, ({ e, t }, _p$) => {
					e !== _p$?.e && _$setProp(_el$, "class", e, _p$?.e);
					t !== _p$?.t && _$setProp(_el$2, "checked", t, _p$?.t);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$5 = _$createElement("main");
				var _el$6 = _$createElement("form", { onSubmit: (v$e) => {
					v$e?.preventDefault();
					v$add();
				} });
				var _el$7 = _$createElement("input", {
					onInput: (v$e) => {
						w$draft.set(v$e?.target?.value);
					},
					placeholder: "What needs doing?"
				});
				var _el$8 = _$createElement("button");
				var _el$9 = _$createElement("ul");
				var _el$10 = _$createElement("footer");
				var _el$11 = _$createElement("span");
				var _el$12 = _$createTextNode(" left");
				_$insertNode(_el$5, _el$6);
				_$insertNode(_el$5, _el$9);
				_$insertNode(_el$5, _el$10);
				_$insertNode(_el$6, _el$7);
				_$insertNode(_el$6, _el$8);
				_$insertNode(_el$8, _$createTextNode("Add"));
				_$insert(_el$9, _$createComponent(_$For, {
					get each() {
						return v$shown();
					},
					children: (v$t) => {
						const __o = __rt.owner();
						return _$createComponent(V$Item, {
							todo: v$t,
							children: []
						});
					}
				}));
				_$insertNode(_el$10, _el$11);
				_$insertNode(_el$11, _el$12);
				_$insert(_el$11, () => {
					return __rt.show(v$remaining());
				}, _el$12);
				_$insert(_el$10, _$createComponent(_$For, {
					get each() {
						return v$filters();
					},
					children: (v$f) => {
						const __o = __rt.owner();
						return (() => {
							var _el$13 = _$createElement("button", { onClick: () => {
								w$filter.set(v$f);
							} });
							_$insert(_el$13, () => {
								return __rt.show(v$f);
							});
							_$effect(() => __rt.eq(v$filter(), v$f) ? "selected" : "", (_v$, _$p) => {
								_$setProp(_el$13, "class", _v$, _$p);
							});
							return _el$13;
						})();
					}
				}), null);
				_$effect(() => {
					return {
						e: v$draft(),
						t: !v$canAdd()
					};
				}, ({ e, t }, _p$) => {
					e !== _p$?.e && _$setProp(_el$7, "value", e, _p$?.e);
					t !== _p$?.t && _$setProp(_el$8, "disabled", t, _p$?.t);
				});
				return _el$5;
			})();
		}
		const v$add = __rt.action(function* () {
			if (!__rt.snapshot(v$canAdd)) {
				return;
			} else {}
			w$todos.set((v$ts) => [...v$ts, {
				"id": __rt.snapshot(v$nextId),
				"title": __rt.snapshot(v$draft)?.trim(),
				"done": false
			}]);
			w$nextId.set(__rt.snapshot(v$nextId) + 1);
			w$draft.set("");
		});
		__rt.reg("add", { value: v$add });
		const v$remove = __rt.action(function* (v$id) {
			w$todos.set((v$ts) => v$ts?.filter((v$t) => !__rt.eq(v$t?.id, v$id)));
		});
		__rt.reg("remove", { value: v$remove });
		const v$toggle = __rt.action(function* (v$id) {
			w$todos.set((v$ts) => v$ts?.map((v$t) => __rt.eq(v$t?.id, v$id) ? {
				...v$t,
				"done": !v$t?.done
			} : v$t));
		});
		__rt.reg("toggle", { value: v$toggle });
		const [v$todos, w$todos] = __rt.source("todos", __rt.untrack(() => []));
		__rt.reg("todos", {
			get: v$todos,
			w: w$todos
		});
		const [v$draft, w$draft] = __rt.source("draft", __rt.untrack(() => ""));
		__rt.reg("draft", {
			get: v$draft,
			w: w$draft
		});
		const [v$filter, w$filter] = __rt.source("filter", __rt.untrack(() => "all"));
		__rt.reg("filter", {
			get: v$filter,
			w: w$filter
		});
		const v$filters = __rt.memo("filters", (__prev) => [
			"all",
			"open",
			"done"
		], undefined);
		__rt.reg("filters", { get: v$filters });
		const [v$nextId, w$nextId] = __rt.source("nextId", __rt.untrack(() => 1));
		__rt.reg("nextId", {
			get: v$nextId,
			w: w$nextId
		});
		const v$shown = __rt.memo("shown", (__prev) => __rt.eq(v$filter(), "all") ? v$todos() : v$todos()?.filter((v$t) => __rt.eq(v$filter(), "done") ? v$t?.done : !v$t?.done), undefined);
		__rt.reg("shown", { get: v$shown });
		const v$remaining = __rt.memo("remaining", (__prev) => v$todos()?.filter((v$t) => !v$t?.done)?.length, undefined);
		__rt.reg("remaining", { get: v$remaining });
		const v$canAdd = __rt.memo("canAdd", (__prev) => !__rt.eq(v$draft()?.trim(), ""), undefined);
		__rt.reg("canAdd", { get: v$canAdd });
		return _$createComponent(V$App, { children: [] });
	};
}

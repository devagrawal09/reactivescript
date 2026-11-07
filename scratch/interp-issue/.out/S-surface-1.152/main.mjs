import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		const v$str = __B.str;
		__rt.reg("str", { value: v$str });
		const v$log = __B.log;
		__rt.reg("log", { value: v$log });
		function V$Row(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("li", { onClick: () => {
					v$toggle(v$props?.todo?.id);
				} });
				_$insert(_el$, () => {
					return __rt.show(v$props?.todo?.title);
				});
				_$effect(() => v$props?.todo?.done ? "done" : "", (_v$, _$p) => {
					_$setProp(_el$, "class", _v$, _$p);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$2 = _$createElement("main");
				var _el$3 = _$createElement("p");
				var _el$4 = _$createElement("ul");
				var _el$5 = _$createElement("button", { onClick: () => {
					w$filter.set(__rt.eq(__rt.snapshot(v$filter), "all") ? "open" : "all");
				} });
				_$insertNode(_el$2, _el$3);
				_$insertNode(_el$2, _el$4);
				_$insertNode(_el$2, _el$5);
				_$insert(_el$3, () => {
					return __rt.show(v$summary());
				});
				_$insert(_el$4, _$createComponent(_$For, {
					get each() {
						return v$shown();
					},
					children: (v$t) => {
						const __o = __rt.owner();
						return _$createComponent(V$Row, {
							todo: v$t,
							children: []
						});
					}
				}));
				_$insert(_el$5, () => {
					return __rt.show(v$filter());
				});
				_$effect(() => __rt.eq(v$len(v$todos()), 0), (_v$, _$p) => {
					_$setProp(_el$5, "disabled", _v$, _$p);
				});
				return _el$2;
			})();
		}
		const v$toggle = __rt.action(function* (v$id) {
			w$todos.set((v$ts) => v$ts?.map((v$t) => __rt.eq(v$t?.id, v$id) ? {
				...v$t,
				"done": !v$t?.done
			} : v$t));
		});
		__rt.reg("toggle", { value: v$toggle });
		const [v$todos, w$todos] = __rt.source("todos", __rt.untrack(() => [{
			"id": 1,
			"title": "spec",
			"done": false
		}]));
		__rt.reg("todos", {
			get: v$todos,
			w: w$todos
		});
		const [v$filter, w$filter] = __rt.source("filter", __rt.untrack(() => "all"));
		__rt.reg("filter", {
			get: v$filter,
			w: w$filter
		});
		const v$shown = __rt.memo("shown", (__prev) => __rt.eq(v$filter(), "all") ? v$todos() : v$todos()?.filter((v$t) => !v$t?.done), undefined);
		__rt.reg("shown", { get: v$shown });
		const v$summary = __rt.memo("summary", (__prev) => __rt.fmt(v$len(v$shown())) + " of " + __rt.fmt(v$len(v$todos())), undefined);
		__rt.reg("summary", { get: v$summary });
		return _$createComponent(V$App, { children: [] });
	};
}

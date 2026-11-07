import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		const v$panel = __rt.context("panel", null);
		__rt.reg("panel", { value: v$panel });
		function V$Panel(v$props) {
			const __o = __rt.owner();
			__rt.provide(v$panel, { get: __rt.memo(null, () => v$props?.label) });
			return (() => {
				var _el$ = _$createElement("section");
				_$insert(_el$, () => {
					return __rt.show(v$props?.children);
				});
				return _el$;
			})();
		}
		function V$Badge(v$props) {
			const __o = __rt.owner();
			const v$label = __rt.memo("label", (__prev) => __rt.useGet(v$panel, __o), undefined);
			__rt.reg("label", { get: v$label });
			return (() => {
				var _el$2 = _$createElement("b");
				_$insert(_el$2, () => {
					return __rt.show(v$label());
				}, null);
				_$insert(_el$2, () => {
					return __rt.show(v$props?.n);
				}, null);
				return _el$2;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			function v$twice(v$x) {
				return v$x * 2 + v$total();
			}
			const v$note = __rt.action(function* (v$n) {
				w$notes.set((v$xs) => [...v$xs, v$n]);
			});
			__rt.reg("note", { value: v$note });
			const [v$items, w$items] = __rt.source("items", __rt.untrack(() => [1, 2]));
			__rt.reg("items", {
				get: v$items,
				w: w$items
			});
			const [v$notes, w$notes] = __rt.source("notes", __rt.untrack(() => []));
			__rt.reg("notes", {
				get: v$notes,
				w: w$notes
			});
			const [v$handlers, w$handlers] = __rt.source("handlers", __rt.untrack(() => []));
			__rt.reg("handlers", {
				get: v$handlers,
				w: w$handlers
			});
			const [v$mode, w$mode] = __rt.source("mode", __rt.untrack(() => true));
			__rt.reg("mode", {
				get: v$mode,
				w: w$mode
			});
			const v$total = __rt.memo("total", (__prev) => v$len(v$items()), undefined);
			__rt.reg("total", { get: v$total });
			const v$a = __rt.memo("a", (__prev) => v$mode() ? 1 : __rt.preOr(__prev, () => 0), undefined);
			__rt.reg("a", { get: v$a });
			const v$cb = __rt.memo("cb", (__prev) => () => v$total(), undefined);
			__rt.reg("cb", { get: v$cb });
			return (() => {
				var _el$3 = _$createElement("div");
				var _el$4 = _$createElement("p");
				var _el$5 = _$createTextNode(" ");
				var _el$6 = _$createTextNode(" ");
				_$insertNode(_el$3, _el$4);
				_$insert(_el$3, _$createComponent(V$Panel, {
					label: "P",
					get children() {
						return _$createComponent(V$Badge, {
							get n() {
								return v$twice(1);
							},
							children: []
						});
					}
				}), _el$4);
				_$insert(_el$3, _$createComponent(_$For, {
					get each() {
						return v$items();
					},
					children: (v$i) => {
						const __o = __rt.owner();
						const [v$hits, w$hits] = __rt.source("hits", __rt.untrack(() => 0));
						__rt.reg("hits", {
							get: v$hits,
							w: w$hits
						});
						return (() => {
							var _el$7 = _$createElement("i", { onClick: () => {
								let v$h = __rt.snapshot(v$hits) + 1;
								w$hits.set(v$h);
								v$note(v$h);
								w$handlers.set([...__rt.snapshot(v$handlers), () => __rt.snapshot(v$total)]);
							} });
							var _el$8 = _$createTextNode(":");
							_$insertNode(_el$7, _el$8);
							_$insert(_el$7, () => {
								return __rt.show(v$i);
							}, _el$8);
							_$insert(_el$7, () => {
								return __rt.show(v$hits());
							}, null);
							return _el$7;
						})();
					}
				}), _el$4);
				_$insertNode(_el$4, _el$5);
				_$insertNode(_el$4, _el$6);
				_$insert(_el$4, () => {
					return __rt.show(v$a());
				}, _el$5);
				_$insert(_el$4, () => {
					return __rt.show(v$cb()());
				}, _el$6);
				_$insert(_el$4, () => {
					return __rt.show(v$len(v$notes()));
				}, null);
				return _el$3;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { template as _$template } from "@solidjs/web";
import { getNextElement as _$getNextElement } from "@solidjs/web";
import { getNextMarker as _$getNextMarker } from "@solidjs/web";
import { insert as _$insert } from "@solidjs/web";
import { scope as _$scope } from "@solidjs/web";
import { createComponent as _$createComponent } from "@solidjs/web";
import { readShallow as _$readShallow } from "@solidjs/web";
import { className as _$className } from "@solidjs/web";
import { effect as _$effect } from "@solidjs/web";
import { delegateEvents as _$delegateEvents } from "@solidjs/web";
import { runHydrationEvents as _$runHydrationEvents } from "@solidjs/web";
import { For as _$For } from "@solidjs/web";
var _tmpl$ = /* @__PURE__ */ _$template(`<div><button>run</button><button>runlots</button><button>update</button><button>select</button><button>swap</button><button>clear</button><button>bump</button><p></p><ul>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<li><!$><!/> <!$><!/>`);
// compiled by ReactiveScript ref/compile from rows.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$buildRows = __rt.api("buildRows");
		__rt.reg("buildRows", { value: v$buildRows });
		const v$swapRows = __rt.api("swapRows");
		__rt.reg("swapRows", { value: v$swapRows });
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$rows, w$rows] = __rt.source("rows", __rt.untrack(() => []));
			__rt.reg("rows", {
				get: v$rows,
				w: w$rows
			});
			const [v$sel, w$sel] = __rt.source("sel", __rt.untrack(() => -1));
			__rt.reg("sel", {
				get: v$sel,
				w: w$sel
			});
			const [v$k, w$k] = __rt.source("k", __rt.untrack(() => 0));
			__rt.reg("k", {
				get: v$k,
				w: w$k
			});
			const v$total = __rt.memo("total", (__prev) => __B.sum(__B.map(v$rows(), (v$r) => v$r?.n)), undefined);
			__rt.reg("total", { get: v$total });
			return (() => {
				var _el$ = _$getNextElement(_tmpl$);
				var _el$2 = _el$.firstChild;
				var _el$3 = _el$2.nextSibling;
				var _el$4 = _el$3.nextSibling;
				var _el$5 = _el$4.nextSibling;
				var _el$6 = _el$5.nextSibling;
				var _el$7 = _el$6.nextSibling;
				var _el$8 = _el$7.nextSibling;
				var _el$9 = _el$8.nextSibling;
				var _el$10 = _el$9.nextSibling;
				_el$2._$$click = () => {
					w$rows.set(v$buildRows(1e3));
				};
				_el$3._$$click = () => {
					w$rows.set(v$buildRows(1e4));
				};
				_el$4._$$click = () => {
					w$rows.path([__rt.snapshot(v$k) * 10 % __B.len(__rt.snapshot(v$rows)), "label"], "upd " + __B.str(__rt.snapshot(v$k)));
					w$k.set(__rt.snapshot(v$k) + 1);
				};
				_el$5._$$click = () => {
					w$sel.set((__rt.snapshot(v$sel) + 1) % 1e3);
				};
				_el$6._$$click = () => {
					w$rows.set((v$rs) => v$swapRows(v$rs));
				};
				_el$7._$$click = () => {
					w$rows.set([]);
				};
				_el$8._$$click = () => {
					w$rows.path([__rt.snapshot(v$k) % __B.len(__rt.snapshot(v$rows)), "n"], __rt.snapshot(v$k));
					w$k.set(__rt.snapshot(v$k) + 1);
				};
				_$insert(_el$9, _$scope(() => {
					return __rt.show(v$total());
				}));
				_$insert(_el$10, _$createComponent(_$For, {
					get each() {
						return v$rows();
					},
					children: (v$r) => {
						const __o = __rt.owner();
						return (() => {
							var _el$11 = _$getNextElement(_tmpl$2);
							var _el$12 = _el$11.firstChild;
							var [_el$13, _el$14] = _$getNextMarker(_el$12.nextSibling);
							var _el$15 = _el$13.nextSibling;
							var _el$16 = _el$15.nextSibling;
							var [_el$17, _el$18] = _$getNextMarker(_el$16.nextSibling);
							_$insert(_el$11, _$scope(() => {
								return __rt.show(v$r?.id);
							}), _el$13, _el$14);
							_$insert(_el$11, _$scope(() => {
								return __rt.show(v$r?.label);
							}), _el$17, _el$18);
							_$effect(() => _$readShallow(__rt.eq(v$r?.id, v$sel()) ? "danger" : ""), (_v$, _$p) => {
								_$className(_el$11, _v$, _$p);
							});
							return _el$11;
						})();
					}
				}));
				_$runHydrationEvents();
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}
_$delegateEvents(["click"]);

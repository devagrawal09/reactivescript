import { template as _$template } from "@solidjs/web";
import { getNextElement as _$getNextElement } from "@solidjs/web";
import { getNextMarker as _$getNextMarker } from "@solidjs/web";
import { insert as _$insert } from "@solidjs/web";
import { scope as _$scope } from "@solidjs/web";
import { createComponent as _$createComponent } from "@solidjs/web";
import { delegateEvents as _$delegateEvents } from "@solidjs/web";
import { runHydrationEvents as _$runHydrationEvents } from "@solidjs/web";
import { For as _$For } from "@solidjs/web";
var _tmpl$ = /* @__PURE__ */ _$template(`<div><button>claim</button><ul>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<li><!$><!/><!$><!/>`);
// compiled by ReactiveScript ref/compile from optimistic.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$buildRows = __rt.api("buildRows");
		__rt.reg("buildRows", { value: v$buildRows });
		const v$save = __rt.api("save");
		__rt.reg("save", { value: v$save });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$rename = __rt.action(function* (v$i, v$t) {
				try {
					w$rows.guess(v$t, [v$i, "label"]);
					let v$r = yield __rt.awaited(v$save(v$t));
					w$rows.path([v$i, "label"], v$r);
				} catch (__e) {}
			});
			__rt.reg("rename", { value: v$rename });
			const [v$rows, w$rows] = __rt.source("rows", __rt.untrack(() => v$buildRows(200)), true);
			__rt.reg("rows", {
				get: v$rows,
				w: w$rows
			});
			const h$rows = __rt.hacc(v$rows);
			const [v$k, w$k] = __rt.source("k", __rt.untrack(() => 0));
			__rt.reg("k", {
				get: v$k,
				w: w$k
			});
			const h$k = __rt.hacc(v$k);
			return (() => {
				var _el$ = _$getNextElement(_tmpl$);
				var _el$2 = _el$.firstChild;
				var _el$3 = _el$2.nextSibling;
				_el$2._$$click = () => {
					v$rename(__rt.snapshot(h$k) % 200, "g" + __B.str(__rt.snapshot(h$k)));
					w$k.set(__rt.snapshot(h$k) + 1);
				};
				_$insert(_el$3, _$createComponent(_$For, {
					get each() {
						return h$rows();
					},
					children: (v$r) => {
						const __o = __rt.owner();
						return (() => {
							var _el$4 = _$getNextElement(_tmpl$2);
							var _el$5 = _el$4.firstChild;
							var [_el$6, _el$7] = _$getNextMarker(_el$5.nextSibling);
							var _el$8 = _el$6.nextSibling;
							var [_el$9, _el$10] = _$getNextMarker(_el$8.nextSibling);
							_$insert(_el$4, _$scope(() => {
								return __rt.show(__rt.get(v$r, "label"));
							}), _el$6, _el$7);
							_$insert(_el$4, _$scope(() => {
								return __rt.show(__rt.isPending(() => __rt.val(v$r, "label")) ? "…" : "");
							}), _el$9, _el$10);
							return _el$4;
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

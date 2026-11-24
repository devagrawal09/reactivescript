import { template as _$template } from "@solidjs/web";
import { getNextElement as _$getNextElement } from "@solidjs/web";
import { getNextMarker as _$getNextMarker } from "@solidjs/web";
import { insert as _$insert } from "@solidjs/web";
import { scope as _$scope } from "@solidjs/web";
import { createComponent as _$createComponent } from "@solidjs/web";
import { delegateEvents as _$delegateEvents } from "@solidjs/web";
import { runHydrationEvents as _$runHydrationEvents } from "@solidjs/web";
import { Errored as _$Errored } from "@solidjs/web";
import { Loading as _$Loading } from "@solidjs/web";
import { For as _$For } from "@solidjs/web";
var _tmpl$ = /* @__PURE__ */ _$template(`<div><button>next</button><!$><!/>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<p>error`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<p>loading`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<ul>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<li><!$><!/> <!$><!/>`);
// compiled by ReactiveScript ref/compile from keyed.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$loadRows = __rt.api("loadRows");
		__rt.reg("loadRows", { value: v$loadRows });
		function V$App(v$props) {
			const __o = __rt.owner();
			const [v$page, w$page] = __rt.source("page", __rt.untrack(() => 0));
			__rt.reg("page", {
				get: v$page,
				w: w$page
			});
			const h$page = __rt.hacc(v$page);
			const v$rows = __rt.keyed("rows", "id", () => __rt.awaited(v$loadRows(v$page())), false);
			__rt.reg("rows", { get: v$rows });
			const h$rows = __rt.hacc(v$rows);
			return (() => {
				var _el$ = _$getNextElement(_tmpl$);
				var _el$2 = _el$.firstChild;
				var _el$3 = _el$2.nextSibling;
				var [_el$4, _el$5] = _$getNextMarker(_el$3.nextSibling);
				_el$2._$$click = () => {
					w$page.set(__rt.snapshot(h$page) + 1);
				};
				_$insert(_el$, _$createComponent(_$Errored, {
					fallback: (v$e) => _$getNextElement(_tmpl$2),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(_$Loading, {
								get fallback() {
									return _$getNextElement(_tmpl$3);
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$8 = _$getNextElement(_tmpl$4);
											_$insert(_el$8, _$createComponent(_$For, {
												get each() {
													return h$rows();
												},
												children: (v$r) => {
													const __o = __rt.owner();
													return (() => {
														var _el$9 = _$getNextElement(_tmpl$5);
														var _el$10 = _el$9.firstChild;
														var [_el$11, _el$12] = _$getNextMarker(_el$10.nextSibling);
														var _el$13 = _el$11.nextSibling;
														var _el$14 = _el$13.nextSibling;
														var [_el$15, _el$16] = _$getNextMarker(_el$14.nextSibling);
														_$insert(_el$9, _$scope(() => {
															return __rt.show(__rt.get(v$r, "id"));
														}), _el$11, _el$12);
														_$insert(_el$9, _$scope(() => {
															return __rt.show(__rt.get(v$r, "label"));
														}), _el$15, _el$16);
														return _el$9;
													})();
												}
											}));
											return _el$8;
										})();
									})();
								}
							});
						})();
					}
				}), _el$4, _el$5);
				_$runHydrationEvents();
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}
_$delegateEvents(["click"]);

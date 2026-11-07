import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m0 from "./m0.mjs";
import __m1 from "./m1.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i0 = __rt.module("m0.mjs", __m0);
		const v$query = __i0["query"];
		const v$route = __i0["route"];
		const v$notes = __i0["notes"];
		const v$current = __i0["current"];
		const v$search = __i0["search"];
		const v$back = __i0["back"];
		const v$NotFound = __i0["NotFound"];
		const __i1 = __rt.module("m1.mjs", __m1);
		const V$NoteList = __i1["NoteList"];
		const V$NoteEditor = __i1["NoteEditor"];
		const v$viewport = __rt.api("viewport");
		__rt.reg("viewport", { value: v$viewport });
		function V$App(v$props) {
			const __o = __rt.owner();
			const i$width = __rt.memo("width", (__prev) => __rt.awaited(v$viewport()), __rt.clientQuestion(__rt.firstPaint(() => 1024)));
			const v$width = __rt.catchMemo(() => i$width(), (__e) => __rt.isA(__e, undefined), (v$e) => 1024);
			__rt.reg("width", { get: v$width });
			const v$layout = __rt.memo("layout", (__prev) => v$width() < 640 ? "narrow" : "wide", undefined);
			__rt.reg("layout", { get: v$layout });
			return (() => {
				var _el$ = _$createElement("main");
				var _el$2 = _$createElement("header", { class: "tsrx-13f89e6f" });
				var _el$3 = _$createElement("input", {
					placeholder: "search",
					onInput: (v$e) => {
						v$search(v$e?.currentTarget?.value);
					},
					class: "tsrx-13f89e6f"
				});
				var _el$4 = _$createElement("small", { class: "tsrx-13f89e6f" });
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$2, _el$3);
				_$insertNode(_el$2, _el$4);
				_$insert(_el$2, _$createComponent(_$Show, {
					get when() {
						return __rt.eq(v$route()?.page, "note");
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						return (() => {
							var _el$5 = _$createElement("button", {
								onClick: () => {
									v$back();
								},
								class: "tsrx-13f89e6f"
							});
							_$insertNode(_el$5, _$createTextNode("back"));
							return _el$5;
						})();
					}
				}), _el$4);
				_$insert(_el$4, () => {
					return __rt.show(v$layout());
				});
				_$insert(_el$, _$createComponent(_$Errored, {
					fallback: (v$e) => (() => {
						var _el$6 = _$createElement("p", { class: "tsrx-13f89e6f" });
						var _el$7 = _$createTextNode("could not load: ");
						_$insertNode(_el$6, _el$7);
						_$insert(_el$6, () => {
							return __rt.show(v$e()?.message);
						}, null);
						return _el$6;
					})(),
					get children() {
						return (() => {
							const __o = __rt.owner();
							return _$createComponent(_$Show, {
								get when() {
									return __rt.eq(v$route()?.page, "list");
								},
								get fallback() {
									const __o = __rt.owner();
									return _$createComponent(__rt.TypedErrored, {
										classes: [v$NotFound],
										fallback: (v$e) => (() => {
											var _el$8 = _$createElement("p", { class: "tsrx-13f89e6f" });
											_$insert(_el$8, () => {
												return __rt.show(v$e()?.message);
											});
											return _el$8;
										})(),
										get children() {
											return (() => {
												const __o = __rt.owner();
												return _$createComponent(_$Loading, {
													get fallback() {
														return (() => {
															var _el$9 = _$createElement("p", { class: "tsrx-13f89e6f" });
															_$insertNode(_el$9, _$createTextNode("opening…"));
															return _el$9;
														})();
													},
													get children() {
														return (() => {
															const __o = __rt.owner();
															return _$createComponent(_$Show, {
																get when() {
																	return v$current();
																},
																get fallback() {
																	const __o = __rt.owner();
																	return null;
																},
																children: (__item) => {
																	const n$current = __item;
																	const __o = __rt.owner();
																	return _$createComponent(V$NoteEditor, {
																		get note() {
																			return n$current();
																		},
																		children: []
																	});
																}
															});
														})();
													}
												});
											})();
										}
									});
								},
								children: (__item) => {
									const __o = __rt.owner();
									return _$createComponent(_$Loading, {
										get on() {
											return v$query();
										},
										get fallback() {
											return (() => {
												var _el$10 = _$createElement("p", { class: "tsrx-13f89e6f" });
												_$insertNode(_el$10, _$createTextNode("searching…"));
												return _el$10;
											})();
										},
										get children() {
											return (() => {
												const __o = __rt.owner();
												return _$createComponent(V$NoteList, {
													get notes() {
														return v$notes();
													},
													children: []
												});
											})();
										}
									});
								}
							});
						})();
					}
				}), null);
				_$effect(() => {
					return {
						e: __rt.scopedClass(v$layout(), "tsrx-13f89e6f"),
						t: v$query()
					};
				}, ({ e, t }, _p$) => {
					e !== _p$?.e && _$setProp(_el$, "class", e, _p$?.e);
					t !== _p$?.t && _$setProp(_el$3, "value", t, _p$?.t);
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from ui.rx — do not edit
import __m0 from "./m0.mjs";
import __m1 from "./m1.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$query = __i0["query"];
	const v$results = __i0["results"];
	const v$count = __i0["count"];
	const v$setQuery = __i0["setQuery"];
	const v$TooShort = __i0["TooShort"];
	const __i1 = __rt.module("m1.mjs", __m1);
	const v$selected = __i1["selected"];
	const v$item = __i1["item"];
	const v$select = __i1["select"];
	const v$retry = __i1["retry"];
	const v$NotFound = __i1["NotFound"];
	function V$SearchBox(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$ = _$createElement("input", { onInput: (v$e) => {
				v$setQuery(v$e?.target?.value);
			} });
			_$effect(() => __rt.latest(() => v$query()), (_v$, _$p) => {
				_$setProp(_el$, "value", _v$, _$p);
			});
			return _el$;
		})();
	}
	function V$ResultRow(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$2 = _$createElement("li", { onClick: () => {
				v$select(v$props?.hit?.id);
			} });
			_$insert(_el$2, () => {
				return __rt.show(__rt.eq(v$props?.hit?.id, v$selected()) ? "> " : "");
			}, null);
			_$insert(_el$2, () => {
				return __rt.show(v$props?.hit?.name);
			}, null);
			_$insert(_el$2, () => {
				return __rt.show(" ");
			}, null);
			return _el$2;
		})();
	}
	function V$ResultsPane(v$props) {
		const __o = __rt.owner();
		return _$createComponent(_$Show, {
			get when() {
				return !__rt.eq(v$query(), "");
			},
			get fallback() {
				const __o = __rt.owner();
				return null;
			},
			children: (__item) => {
				const __o = __rt.owner();
				return (() => {
					var _el$3 = _$createElement("section");
					var _el$4 = _$createElement("p");
					_$insertNode(_el$3, _el$4);
					_$insert(_el$4, () => {
						return __rt.show(__rt.isPending(() => v$results()) ? "searching…" : "");
					});
					_$insert(_el$3, () => {
						return __rt.show(" ");
					}, null);
					_$insert(_el$3, _$createComponent(_$Errored, {
						fallback: (v$e) => (() => {
							var _el$5 = _$createElement("p");
							var _el$6 = _$createTextNode("search failed: ");
							_$insertNode(_el$5, _el$6);
							_$insert(_el$5, () => {
								return __rt.show(v$e()?.message);
							}, null);
							return _el$5;
						})(),
						get children() {
							return (() => {
								const __o = __rt.owner();
								return _$createComponent(__rt.TypedErrored, {
									classes: [v$TooShort],
									fallback: (v$e) => (() => {
										var _el$7 = _$createElement("p");
										_$insert(_el$7, () => {
											return __rt.show(v$e()?.message);
										});
										return _el$7;
									})(),
									get children() {
										return (() => {
											const __o = __rt.owner();
											return _$createComponent(_$Loading, {
												get fallback() {
													return (() => {
														var _el$8 = _$createElement("p");
														_$insertNode(_el$8, _$createTextNode("loading results…"));
														return _el$8;
													})();
												},
												get children() {
													return (() => {
														const __o = __rt.owner();
														return [
															(() => {
																var _el$9 = _$createElement("h2");
																var _el$10 = _$createTextNode(" results for ");
																_$insertNode(_el$9, _el$10);
																_$insert(_el$9, () => {
																	return __rt.show(v$count());
																}, _el$10);
																_$insert(_el$9, () => {
																	return __rt.show(__rt.latest(() => v$query()));
																}, null);
																return _el$9;
															})(),
															_$memo(() => {
																return __rt.show(" ");
															}),
															(() => {
																var _el$11 = _$createElement("ul");
																_$insert(_el$11, _$createComponent(_$For, {
																	get each() {
																		return v$results();
																	},
																	children: (v$r) => {
																		const __o = __rt.owner();
																		return _$createComponent(V$ResultRow, {
																			hit: v$r,
																			children: []
																		});
																	}
																}));
																_$effect(() => __rt.isPending(() => v$results()) ? "dim" : "", (_v$, _$p) => {
																	_$setProp(_el$11, "class", _v$, _$p);
																});
																return _el$11;
															})()
														];
													})();
												}
											});
										})();
									}
								});
							})();
						}
					}), null);
					return _el$3;
				})();
			}
		});
	}
	function V$ItemView(v$props) {
		const __o = __rt.owner();
		return _$createComponent(_$Show, {
			get when() {
				return v$item();
			},
			get fallback() {
				const __o = __rt.owner();
				return null;
			},
			children: (__item) => {
				const n$item = __item;
				const __o = __rt.owner();
				return (() => {
					var _el$12 = _$createElement("article");
					var _el$13 = _$createElement("h3");
					var _el$14 = _$createElement("p");
					_$insertNode(_el$12, _el$13);
					_$insertNode(_el$12, _el$14);
					_$insert(_el$13, () => {
						return __rt.show(n$item()?.name);
					});
					_$insert(_el$12, () => {
						return __rt.show(" ");
					}, _el$14);
					_$insert(_el$14, () => {
						return __rt.show(n$item()?.blurb);
					});
					return _el$12;
				})();
			}
		});
	}
	function V$DetailPane(v$props) {
		const __o = __rt.owner();
		return _$createComponent(_$Show, {
			get when() {
				return __rt.eq(v$selected(), null);
			},
			get fallback() {
				const __o = __rt.owner();
				return (() => {
					var _el$15 = _$createElement("section");
					_$insert(_el$15, _$createComponent(_$Loading, {
						get on() {
							return v$selected();
						},
						get fallback() {
							return (() => {
								var _el$16 = _$createElement("p");
								_$insertNode(_el$16, _$createTextNode("loading…"));
								return _el$16;
							})();
						},
						get children() {
							return (() => {
								const __o = __rt.owner();
								return _$createComponent(_$For, {
									get each() {
										return [v$selected()];
									},
									children: (v$id) => {
										const __o = __rt.owner();
										return _$createComponent(_$Errored, {
											fallback: (v$e) => [
												(() => {
													var _el$17 = _$createElement("p");
													var _el$18 = _$createTextNode("failed: ");
													_$insertNode(_el$17, _el$18);
													_$insert(_el$17, () => {
														return __rt.show(v$e()?.message);
													}, null);
													return _el$17;
												})(),
												_$memo(() => {
													return __rt.show(" ");
												}),
												(() => {
													var _el$19 = _$createElement("button", { onClick: () => {
														v$retry();
													} });
													_$insertNode(_el$19, _$createTextNode("retry"));
													return _el$19;
												})()
											],
											get children() {
												return (() => {
													const __o = __rt.owner();
													return _$createComponent(__rt.TypedErrored, {
														classes: [v$NotFound],
														fallback: (v$e) => (() => {
															var _el$20 = _$createElement("p");
															_$insert(_el$20, () => {
																return __rt.show(v$e()?.message);
															});
															return _el$20;
														})(),
														get children() {
															return (() => {
																const __o = __rt.owner();
																return _$createComponent(V$ItemView, { children: [] });
															})();
														}
													});
												})();
											}
										});
									}
								});
							})();
						}
					}));
					return _el$15;
				})();
			},
			children: (__item) => {
				const __o = __rt.owner();
				return (() => {
					var _el$21 = _$createElement("p");
					_$insertNode(_el$21, _$createTextNode("pick a result"));
					return _el$21;
				})();
			}
		});
	}
	return {
		"SearchBox": V$SearchBox,
		"ResultsPane": V$ResultsPane,
		"DetailPane": V$DetailPane
	};
}

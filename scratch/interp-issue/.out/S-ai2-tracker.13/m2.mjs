import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from ui.rx — do not edit
import __m0 from "./m0.mjs";
import __m1 from "./m1.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$currentUser = __i0["currentUser"];
	const __i1 = __rt.module("m1.mjs", __m1);
	const v$filter = __i1["filter"];
	const v$issues = __i1["issues"];
	const v$selected = __i1["selected"];
	const v$detail = __i1["detail"];
	const v$assignError = __i1["assignError"];
	const v$setFilter = __i1["setFilter"];
	const v$select = __i1["select"];
	const v$assignToMe = __i1["assignToMe"];
	function V$IssueList(v$props) {
		const __o = __rt.owner();
		return (() => {
			var _el$ = _$createElement("section");
			var _el$2 = _$createElement("button", { onClick: () => {
				v$setFilter("open");
			} });
			var _el$3 = _$createElement("button", { onClick: () => {
				v$setFilter("closed");
			} });
			_$insertNode(_el$, _el$2);
			_$insertNode(_el$, _el$3);
			_$insertNode(_el$2, _$createTextNode("open"));
			_$insert(_el$, () => {
				return __rt.show(" ");
			}, _el$3);
			_$insertNode(_el$3, _$createTextNode("closed"));
			_$insert(_el$, () => {
				return __rt.show(" ");
			}, null);
			_$insert(_el$, _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$4 = _$createElement("p");
					var _el$5 = _$createTextNode("list error: ");
					_$insertNode(_el$4, _el$5);
					_$insert(_el$4, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$4;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get on() {
								return v$filter();
							},
							get fallback() {
								return (() => {
									var _el$6 = _$createElement("p");
									var _el$7 = _$createTextNode("loading ");
									var _el$8 = _$createTextNode(" issues");
									_$insertNode(_el$6, _el$7);
									_$insertNode(_el$6, _el$8);
									_$insert(_el$6, () => {
										return __rt.show(v$filter());
									}, _el$8);
									return _el$6;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return (() => {
										var _el$9 = _$createElement("ul");
										_$insert(_el$9, _$createComponent(_$For, {
											get each() {
												return v$issues();
											},
											children: (v$issue) => {
												const __o = __rt.owner();
												return (() => {
													var _el$10 = _$createElement("li", { onClick: () => {
														v$select(v$issue?.id);
													} });
													var _el$11 = _$createTextNode("#");
													var _el$12 = _$createTextNode(" ");
													var _el$13 = _$createTextNode(" (");
													var _el$14 = _$createTextNode(")");
													_$insertNode(_el$10, _el$11);
													_$insertNode(_el$10, _el$12);
													_$insertNode(_el$10, _el$13);
													_$insertNode(_el$10, _el$14);
													_$insert(_el$10, () => {
														return __rt.show(v$issue?.id);
													}, _el$12);
													_$insert(_el$10, () => {
														return __rt.show(v$issue?.title);
													}, _el$13);
													_$insert(_el$10, () => {
														return __rt.show(v$issue?.assignee ?? "unassigned");
													}, _el$14);
													_$insert(_el$10, () => {
														return __rt.show(" ");
													}, null);
													return _el$10;
												})();
											}
										}));
										return _el$9;
									})();
								})();
							}
						});
					})();
				}
			}), null);
			return _el$;
		})();
	}
	function V$DetailPanel(v$props) {
		const __o = __rt.owner();
		const v$me = __rt.memo("me", (__prev) => __rt.useGet(v$currentUser, __o), undefined);
		__rt.reg("me", { get: v$me });
		return (() => {
			var _el$15 = _$createElement("section");
			_$insert(_el$15, _$createComponent(_$Show, {
				get when() {
					return v$selected();
				},
				get fallback() {
					const __o = __rt.owner();
					return (() => {
						var _el$16 = _$createElement("p");
						_$insertNode(_el$16, _$createTextNode("select an issue"));
						return _el$16;
					})();
				},
				children: (__item) => {
					const n$selected = __item;
					const __o = __rt.owner();
					return [
						_$createComponent(_$Loading, {
							get on() {
								return n$selected();
							},
							get fallback() {
								return (() => {
									var _el$20 = _$createElement("p");
									var _el$21 = _$createTextNode("loading #");
									_$insertNode(_el$20, _el$21);
									_$insert(_el$20, () => {
										return __rt.show(n$selected());
									}, null);
									return _el$20;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return _$createComponent(_$Errored, {
										fallback: (v$e) => (() => {
											var _el$22 = _$createElement("p");
											var _el$23 = _$createTextNode("detail error: ");
											_$insertNode(_el$22, _el$23);
											_$insert(_el$22, () => {
												return __rt.show(v$e()?.message);
											}, null);
											return _el$22;
										})(),
										get children() {
											return (() => {
												const __o = __rt.owner();
												return _$createComponent(_$Show, {
													get when() {
														return v$detail();
													},
													get fallback() {
														const __o = __rt.owner();
														return null;
													},
													children: (__item) => {
														const n$detail = __item;
														const __o = __rt.owner();
														return [
															(() => {
																var _el$24 = _$createElement("h3");
																var _el$25 = _$createTextNode("#");
																var _el$26 = _$createTextNode(" ");
																_$insertNode(_el$24, _el$25);
																_$insertNode(_el$24, _el$26);
																_$insert(_el$24, () => {
																	return __rt.show(n$detail()?.id);
																}, _el$26);
																_$insert(_el$24, () => {
																	return __rt.show(n$detail()?.title);
																}, null);
																return _el$24;
															})(),
															_$memo(() => {
																return __rt.show(" ");
															}),
															(() => {
																var _el$27 = _$createElement("p");
																_$insert(_el$27, () => {
																	return __rt.show(n$detail()?.body);
																});
																return _el$27;
															})()
														];
													}
												});
											})();
										}
									});
								})();
							}
						}),
						_$memo(() => {
							return __rt.show(" ");
						}),
						(() => {
							var _el$17 = _$createElement("button", { onClick: () => {
								__rt.refresh("detail", v$detail);
							} });
							_$insertNode(_el$17, _$createTextNode("retry"));
							return _el$17;
						})(),
						_$memo(() => {
							return __rt.show(" ");
						}),
						(() => {
							var _el$18 = _$createElement("button", { onClick: () => {
								if (!__rt.eq(__rt.snapshot(n$selected), null)) {
									v$assignToMe(__rt.snapshot(n$selected), __rt.snapshot(v$me));
								} else {}
							} });
							var _el$19 = _$createTextNode("assign to ");
							_$insertNode(_el$18, _el$19);
							_$insert(_el$18, () => {
								return __rt.show(v$me());
							}, null);
							return _el$18;
						})(),
						_$memo(() => {
							return __rt.show(" ");
						}),
						_$memo(() => {
							return __rt.show(v$assignError());
						})
					];
				}
			}));
			return _el$15;
		})();
	}
	return {
		"IssueList": V$IssueList,
		"DetailPanel": V$DetailPanel
	};
}

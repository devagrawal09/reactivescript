import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from grid.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fetchRows = __rt.api("fetchRows");
		__rt.reg("fetchRows", { value: v$fetchRows });
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		const v$filter = __B.filter;
		__rt.reg("filter", { value: v$filter });
		const v$log = __B.log;
		__rt.reg("log", { value: v$log });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$toggle = __rt.action(function* (v$id) {
				w$selected.set(v$len(v$filter(__rt.snapshot(v$selected), (v$s) => __rt.eq(v$s, v$id))) > 0 ? v$filter(__rt.snapshot(v$selected), (v$s) => !__rt.eq(v$s, v$id)) : [...__rt.snapshot(v$selected), v$id]);
			});
			__rt.reg("toggle", { value: v$toggle });
			const [v$page, w$page] = __rt.source("page", __rt.untrack(() => 1));
			__rt.reg("page", {
				get: v$page,
				w: w$page
			});
			const [v$pageSize, w$pageSize] = __rt.source("pageSize", __rt.untrack(() => 2));
			__rt.reg("pageSize", {
				get: v$pageSize,
				w: w$pageSize
			});
			const [v$sortBy, w$sortBy] = __rt.source("sortBy", __rt.untrack(() => "name"));
			__rt.reg("sortBy", {
				get: v$sortBy,
				w: w$sortBy
			});
			const [v$query, w$query] = __rt.source("query", __rt.untrack(() => ""));
			__rt.reg("query", {
				get: v$query,
				w: w$query
			});
			const [v$selected, w$selected] = __rt.source("selected", __rt.untrack(() => []));
			__rt.reg("selected", {
				get: v$selected,
				w: w$selected
			});
			const v$count = __rt.memo("count", (__prev) => v$len(v$selected()), undefined);
			__rt.reg("count", { get: v$count });
			__rt.effect(1, () => [v$count()], ($p) => __rt.untrack(() => {
				return v$log("sel", $p[0]);
			}));
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p", { class: "error" });
					var _el$2 = _$createTextNode("Could not load rows: ");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$3 = _$createElement("div");
							var _el$4 = _$createElement("input", { onInput: (v$e) => {
								w$query.set(v$e?.target?.value);
							} });
							var _el$5 = _$createElement("p");
							var _el$6 = _$createTextNode(" selected");
							var _el$7 = _$createElement("p");
							var _el$8 = _$createElement("button", { onClick: () => {
								w$sortBy.set("name");
							} });
							var _el$9 = _$createTextNode("name");
							var _el$10 = _$createElement("button", { onClick: () => {
								w$sortBy.set("age");
							} });
							var _el$11 = _$createTextNode("age");
							var _el$12 = _$createElement("p");
							var _el$13 = _$createElement("button", { onClick: () => {
								w$page.set(__rt.snapshot(v$page) - 1);
							} });
							var _el$14 = _$createElement("button", { onClick: () => {
								w$page.set(__rt.snapshot(v$page) + 1);
							} });
							_$insertNode(_el$3, _el$4);
							_$insertNode(_el$3, _el$5);
							_$insertNode(_el$3, _el$7);
							_$insertNode(_el$3, _el$12);
							_$insertNode(_el$5, _el$6);
							_$insert(_el$5, () => {
								return __rt.show(v$count());
							}, _el$6);
							_$insertNode(_el$7, _el$8);
							_$insertNode(_el$7, _el$10);
							_$insertNode(_el$8, _el$9);
							_$insert(_el$8, () => {
								return __rt.show(__rt.eq(v$sortBy(), "name") ? "*" : "");
							}, null);
							_$insertNode(_el$10, _el$11);
							_$insert(_el$10, () => {
								return __rt.show(__rt.eq(v$sortBy(), "age") ? "*" : "");
							}, null);
							_$insert(_el$3, _$createComponent(_$Loading, {
								get on() {
									return v$page();
								},
								get fallback() {
									return (() => {
										var _el$15 = _$createElement("p");
										var _el$16 = _$createTextNode("Loading page ");
										var _el$17 = _$createTextNode("…");
										_$insertNode(_el$15, _el$16);
										_$insertNode(_el$15, _el$17);
										_$insert(_el$15, () => {
											return __rt.show(v$page());
										}, _el$17);
										return _el$15;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return _$createComponent(_$For, {
											get each() {
												return [v$page()];
											},
											children: (v$p) => {
												const __o = __rt.owner();
												const v$data = __rt.deferred("data", (__prev) => __rt.awaited(v$fetchRows(v$p, v$sortBy())), undefined);
												__rt.reg("data", { get: v$data });
												const v$rows = __rt.keyed("rows", "id", () => v$data()?.rows);
												__rt.reg("rows", { get: v$rows });
												const v$total = __rt.memo("total", (__prev) => v$data()?.total, undefined);
												__rt.reg("total", { get: v$total });
												const v$pages = __rt.memo("pages", (__prev) => (v$total() - v$total() % v$pageSize()) / v$pageSize() + (__rt.eq(v$total() % v$pageSize(), 0) ? 0 : 1), undefined);
												__rt.reg("pages", { get: v$pages });
												const v$visible = __rt.keyed("visible", "id", () => v$filter(v$rows(), (v$r) => v$r?.name?.includes(v$query())));
												__rt.reg("visible", { get: v$visible });
												return [
													(() => {
														var _el$18 = _$createElement("p");
														_$insert(_el$18, () => {
															return __rt.show(__rt.isPending(() => v$data()) ? "updating" : "ready");
														});
														return _el$18;
													})(),
													(() => {
														var _el$19 = _$createElement("ul");
														_$insert(_el$19, _$createComponent(_$For, {
															get each() {
																return v$visible();
															},
															children: (v$r) => {
																const __o = __rt.owner();
																const v$isSelected = __rt.memo("isSelected", (__prev) => v$len(v$filter(v$selected(), (v$s) => __rt.eq(v$s, v$r?.id))) > 0, undefined);
																__rt.reg("isSelected", { get: v$isSelected });
																return (() => {
																	var _el$25 = _$createElement("li", { onClick: () => {
																		v$toggle(v$r?.id);
																	} });
																	var _el$26 = _$createTextNode(" ");
																	var _el$27 = _$createTextNode(" (");
																	var _el$28 = _$createTextNode(")");
																	_$insertNode(_el$25, _el$26);
																	_$insertNode(_el$25, _el$27);
																	_$insertNode(_el$25, _el$28);
																	_$insert(_el$25, () => {
																		return __rt.show(v$isSelected() ? "[x]" : "[ ]");
																	}, _el$26);
																	_$insert(_el$25, () => {
																		return __rt.show(v$r?.name);
																	}, _el$27);
																	_$insert(_el$25, () => {
																		return __rt.show(v$r?.age);
																	}, _el$28);
																	return _el$25;
																})();
															}
														}));
														_$effect(() => __rt.isPending(() => v$data()) ? "dim" : "", (_v$, _$p) => {
															_$setProp(_el$19, "class", _v$, _$p);
														});
														return _el$19;
													})(),
													(() => {
														var _el$20 = _$createElement("p");
														var _el$21 = _$createTextNode("Page ");
														var _el$22 = _$createTextNode(" of ");
														var _el$23 = _$createTextNode(" (");
														var _el$24 = _$createTextNode(" rows)");
														_$insertNode(_el$20, _el$21);
														_$insertNode(_el$20, _el$22);
														_$insertNode(_el$20, _el$23);
														_$insertNode(_el$20, _el$24);
														_$insert(_el$20, () => {
															return __rt.show(v$p);
														}, _el$22);
														_$insert(_el$20, () => {
															return __rt.show(v$pages());
														}, _el$23);
														_$insert(_el$20, () => {
															return __rt.show(v$total());
														}, _el$24);
														return _el$20;
													})()
												];
											}
										});
									})();
								}
							}), _el$12);
							_$insertNode(_el$12, _el$13);
							_$insertNode(_el$12, _el$14);
							_$insertNode(_el$13, _$createTextNode("prev"));
							_$insertNode(_el$14, _$createTextNode("next"));
							_$effect(() => v$query(), (_v$, _$p) => {
								_$setProp(_el$4, "value", _v$, _$p);
							});
							return _el$3;
						})();
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

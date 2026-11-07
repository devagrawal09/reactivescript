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
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from todos.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$loadTodos = __rt.api("loadTodos");
		__rt.reg("loadTodos", { value: v$loadTodos });
		const v$addTodo = __rt.api("addTodo");
		__rt.reg("addTodo", { value: v$addTodo });
		const v$removeTodo = __rt.api("removeTodo");
		__rt.reg("removeTodo", { value: v$removeTodo });
		const v$toggleTodo = __rt.api("toggleTodo");
		__rt.reg("toggleTodo", { value: v$toggleTodo });
		const v$removeTodos = __rt.api("removeTodos");
		__rt.reg("removeTodos", { value: v$removeTodos });
		const v$str = __B.str;
		__rt.reg("str", { value: v$str });
		function v$row(v$t, v$fs) {
			return {
				"id": v$t?.id,
				"title": v$t?.title,
				"done": v$t?.done,
				"gone": false,
				"saving": false,
				"failure": v$fs?.find((v$f) => __rt.eq(v$f?.id, v$t?.id)) || null
			};
		}
		function v$declinedAdds(v$ts, v$fs) {
			return v$fs?.filter((v$f) => __rt.eq(v$f?.kind, "add") && !v$ts?.some((v$t) => __rt.eq(v$t?.id, v$f?.id)))?.map((v$f) => v$row({
				"id": v$f?.id,
				"title": v$f?.title,
				"done": v$f?.done
			}, v$fs));
		}
		function v$without(v$fs, v$id) {
			return v$fs?.filter((v$f) => !__rt.eq(v$f?.id, v$id));
		}
		function v$removeFailed(v$id) {
			return {
				"id": v$id,
				"kind": "remove",
				"title": "",
				"done": false
			};
		}
		function V$Item(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("li");
				var _el$2 = _$createElement("input", {
					type: "checkbox",
					onChange: () => {
						v$toggle(v$props?.todo?.id, !v$props?.todo?.done);
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
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return v$props?.todo?.saving;
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						return (() => {
							var _el$5 = _$createElement("i");
							_$insertNode(_el$5, _$createTextNode("…"));
							return _el$5;
						})();
					}
				}), _el$4);
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return !__rt.eq(v$props?.todo?.failure, null);
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						return (() => {
							var _el$6 = _$createElement("button", { onClick: () => {
								let v$f = v$props?.todo?.failure;
								if (__rt.eq(v$f, null)) {
									return;
								} else {}
								if (__rt.eq(v$f?.kind, "add")) {
									v$add(v$f?.id, v$f?.title);
								} else {
									if (__rt.eq(v$f?.kind, "toggle")) {
										v$toggle(v$f?.id, v$f?.done);
									} else {
										v$remove(v$f?.id);
									}
								}
							} });
							var _el$7 = _$createTextNode("retry ");
							_$insertNode(_el$6, _el$7);
							_$insert(_el$6, () => {
								return __rt.show(v$props?.todo?.failure?.kind);
							}, null);
							return _el$6;
						})();
					}
				}), _el$4);
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
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$8 = _$createElement("p", { class: "error" });
					var _el$9 = _$createTextNode("Could not load the list: ");
					_$insertNode(_el$8, _el$9);
					_$insert(_el$8, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$8;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$10 = _$createElement("main");
							var _el$11 = _$createElement("form", { onSubmit: (v$e) => {
								v$e?.preventDefault();
								let v$title = __rt.snapshot(v$draft)?.trim();
								if (__rt.eq(v$title, "")) {
									return;
								} else {}
								let v$id = "t" + v$str(__rt.snapshot(v$nextId));
								w$nextId.set(__rt.snapshot(v$nextId) + 1);
								w$draft.set("");
								v$add(v$id, v$title);
							} });
							var _el$12 = _$createElement("input", {
								onInput: (v$e) => {
									w$draft.set(v$e?.target?.value);
								},
								placeholder: "What needs to be done?"
							});
							_$insertNode(_el$10, _el$11);
							_$insertNode(_el$11, _el$12);
							_$insert(_el$10, _$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$13 = _$createElement("p");
										_$insertNode(_el$13, _$createTextNode("loading…"));
										return _el$13;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return [(() => {
											var _el$14 = _$createElement("ul");
											_$insert(_el$14, _$createComponent(_$For, {
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
											return _el$14;
										})(), (() => {
											var _el$15 = _$createElement("footer");
											var _el$16 = _$createElement("span");
											var _el$17 = _$createTextNode(" left");
											_$insertNode(_el$15, _el$16);
											_$insertNode(_el$16, _el$17);
											_$insert(_el$16, () => {
												return __rt.show(v$remaining());
											}, _el$17);
											_$insert(_el$15, _$createComponent(_$For, {
												get each() {
													return v$filters();
												},
												children: (v$f) => {
													const __o = __rt.owner();
													return (() => {
														var _el$18 = _$createElement("button", { onClick: () => {
															w$filter.set(v$f);
														} });
														_$insert(_el$18, () => {
															return __rt.show(v$f);
														});
														_$effect(() => __rt.eq(v$filter(), v$f) ? "selected" : "", (_v$, _$p) => {
															_$setProp(_el$18, "class", _v$, _$p);
														});
														return _el$18;
													})();
												}
											}), null);
											_$insert(_el$15, _$createComponent(_$Show, {
												get when() {
													return v$anyDone();
												},
												get fallback() {
													const __o = __rt.owner();
													return null;
												},
												children: (__item) => {
													const n$anyDone = __item;
													const __o = __rt.owner();
													return (() => {
														var _el$19 = _$createElement("button", { onClick: () => {
															v$clearDone(__rt.snapshot(v$live)?.filter((v$t) => v$t?.done)?.map((v$t) => v$t?.id));
														} });
														_$insertNode(_el$19, _$createTextNode("clear done"));
														return _el$19;
													})();
												}
											}), null);
											return _el$15;
										})()];
									})();
								}
							}), null);
							_$effect(() => v$draft(), (_v$, _$p) => {
								_$setProp(_el$12, "value", _v$, _$p);
							});
							return _el$10;
						})();
					})();
				}
			});
		}
		const v$add = __rt.action(function* (v$id, v$title) {
			try {
				w$adding.guess((v$as) => [...v$as, {
					"id": v$id,
					"title": v$title,
					"done": false,
					"gone": false,
					"saving": true,
					"failure": null
				}]);
				yield __rt.awaited(v$addTodo(v$id, v$title));
				w$failures.set((v$fs) => v$without(v$fs, v$id));
			} catch (v$e) {
				w$failures.set((v$fs) => [...v$without(v$fs, v$id), {
					"id": v$id,
					"kind": "add",
					"title": v$title,
					"done": false
				}]);
			}
			__rt.refresh("server", v$server);
		});
		__rt.reg("add", { value: v$add });
		const v$toggle = __rt.action(function* (v$id, v$done) {
			try {
				let v$i = __rt.snapshot(v$todos)?.findIndex((v$t) => __rt.eq(v$t?.id, v$id));
				w$todos.guess(v$done, [v$i, "done"]);
				w$todos.guess(true, [v$i, "saving"]);
				yield __rt.awaited(v$toggleTodo(v$id, v$done));
				w$failures.set((v$fs) => v$without(v$fs, v$id));
			} catch (v$e) {
				w$failures.set((v$fs) => [...v$without(v$fs, v$id), {
					"id": v$id,
					"kind": "toggle",
					"title": "",
					"done": v$done
				}]);
			}
			__rt.refresh("server", v$server);
		});
		__rt.reg("toggle", { value: v$toggle });
		const v$remove = __rt.action(function* (v$id) {
			try {
				let v$i = __rt.snapshot(v$todos)?.findIndex((v$t) => __rt.eq(v$t?.id, v$id));
				w$todos.guess(true, [v$i, "gone"]);
				yield __rt.awaited(v$removeTodo(v$id));
				w$failures.set((v$fs) => v$without(v$fs, v$id));
			} catch (v$e) {
				w$failures.set((v$fs) => [...v$without(v$fs, v$id), v$removeFailed(v$id)]);
			}
			__rt.refresh("server", v$server);
		});
		__rt.reg("remove", { value: v$remove });
		const v$clearDone = __rt.action(function* (v$ids) {
			try {
				w$todos.guess((v$ts) => v$ts?.map((v$t) => v$t?.done ? {
					...v$t,
					"gone": true
				} : v$t));
				yield __rt.awaited(v$removeTodos(v$ids));
				w$failures.set((v$fs) => v$fs?.filter((v$f) => !v$ids?.includes(v$f?.id)));
			} catch (v$e) {
				w$failures.set((v$fs) => [...v$fs?.filter((v$f) => !v$ids?.includes(v$f?.id)), ...v$ids?.map((v$id) => v$removeFailed(v$id))]);
			}
			__rt.refresh("server", v$server);
		});
		__rt.reg("clearDone", { value: v$clearDone });
		const v$server = __rt.memo("server", (__prev) => __rt.awaited(v$loadTodos()), undefined);
		__rt.reg("server", { get: v$server });
		const [v$failures, w$failures] = __rt.source("failures", __rt.untrack(() => []));
		__rt.reg("failures", {
			get: v$failures,
			w: w$failures
		});
		const [v$todos, w$todos] = __rt.question("todos", (__prev) => [...v$server()?.map((v$t) => v$row(v$t, v$failures())), ...v$declinedAdds(v$server(), v$failures())], undefined, {
			optimistic: true,
			structured: true
		}, "id");
		__rt.reg("todos", {
			get: v$todos,
			w: w$todos
		});
		const [v$adding, w$adding] = __rt.question("adding", (__prev) => [], undefined, {
			optimistic: true,
			structured: false
		}, "id");
		__rt.reg("adding", {
			get: v$adding,
			w: w$adding
		});
		const [v$filter, w$filter] = __rt.source("filter", __rt.untrack(() => "all"));
		__rt.reg("filter", {
			get: v$filter,
			w: w$filter
		});
		const v$filters = __rt.memo("filters", (__prev) => [
			"all",
			"active",
			"done"
		], undefined);
		__rt.reg("filters", { get: v$filters });
		const [v$draft, w$draft] = __rt.source("draft", __rt.untrack(() => ""));
		__rt.reg("draft", {
			get: v$draft,
			w: w$draft
		});
		const [v$nextId, w$nextId] = __rt.source("nextId", __rt.untrack(() => 1));
		__rt.reg("nextId", {
			get: v$nextId,
			w: w$nextId
		});
		const v$live = __rt.memo("live", (__prev) => [...v$todos()?.filter((v$t) => !v$t?.gone), ...v$adding()?.filter((v$a) => !v$todos()?.some((v$t) => __rt.eq(v$t?.id, v$a?.id)))], undefined);
		__rt.reg("live", { get: v$live });
		const v$shown = __rt.memo("shown", (__prev) => v$live()?.filter((v$t) => __rt.eq(v$filter(), "all") || __rt.eq(__rt.eq(v$filter(), "done"), v$t?.done)), undefined);
		__rt.reg("shown", { get: v$shown });
		const v$remaining = __rt.memo("remaining", (__prev) => v$live()?.filter((v$t) => !v$t?.done)?.length, undefined);
		__rt.reg("remaining", { get: v$remaining });
		const v$anyDone = __rt.memo("anyDone", (__prev) => v$live()?.some((v$t) => v$t?.done), undefined);
		__rt.reg("anyDone", { get: v$anyDone });
		return _$createComponent(V$App, { children: [] });
	};
}

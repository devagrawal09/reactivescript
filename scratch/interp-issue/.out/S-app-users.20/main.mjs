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
// compiled by ReactiveScript ref/compile from users.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fetchUsers = __rt.api("fetchUsers");
		__rt.reg("fetchUsers", { value: v$fetchUsers });
		const v$saveUser = __rt.api("saveUser");
		__rt.reg("saveUser", { value: v$saveUser });
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		function V$Row(v$props) {
			const __o = __rt.owner();
			const v$isEditing = __rt.memo("isEditing", (__prev) => __rt.eq(v$editing(), v$props?.user?.id), undefined);
			__rt.reg("isEditing", { get: v$isEditing });
			return (() => {
				var _el$ = _$createElement("tr");
				var _el$2 = _$createElement("td");
				var _el$3 = _$createElement("td");
				var _el$4 = _$createElement("td");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$3);
				_$insertNode(_el$, _el$4);
				_$insert(_el$2, () => {
					return __rt.show(v$props?.user?.id);
				});
				_$insert(_el$3, _$createComponent(_$Show, {
					get when() {
						return v$isEditing();
					},
					get fallback() {
						const __o = __rt.owner();
						return (() => {
							var _el$5 = _$createElement("span", { onClick: () => {
								w$editing.set(v$props?.user?.id);
							} });
							_$insert(_el$5, () => {
								return __rt.show(v$props?.user?.name);
							});
							return _el$5;
						})();
					},
					children: (__item) => {
						const n$isEditing = __item;
						const __o = __rt.owner();
						return (() => {
							var _el$6 = _$createElement("input", { onChange: (v$e) => {
								v$rename(v$props?.user?.id, v$e?.target?.value);
							} });
							_$effect(() => v$props?.user?.name, (_v$, _$p) => {
								_$setProp(_el$6, "value", _v$, _$p);
							});
							return _el$6;
						})();
					}
				}));
				_$insert(_el$4, () => {
					return __rt.show(v$props?.user?.email);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$7 = _$createElement("p", { class: "error" });
					var _el$8 = _$createTextNode("Could not load users: ");
					_$insertNode(_el$7, _el$8);
					_$insert(_el$7, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$7;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$9 = _$createElement("section");
							var _el$10 = _$createElement("header");
							var _el$11 = _$createElement("input", {
								placeholder: "search",
								onInput: (v$e) => {
									v$search(v$e?.target?.value);
								}
							});
							var _el$12 = _$createElement("span");
							var _el$13 = _$createElement("button", { onClick: () => {
								v$nextPage();
							} });
							var _el$14 = _$createTextNode("Next page (");
							var _el$15 = _$createTextNode(")");
							_$insertNode(_el$9, _el$10);
							_$insertNode(_el$9, _el$13);
							_$insertNode(_el$10, _el$11);
							_$insertNode(_el$10, _el$12);
							_$insert(_el$12, () => {
								return __rt.show(v$status());
							});
							_$insert(_el$10, () => {
								return __rt.show(v$saveError());
							}, null);
							_$insert(_el$9, _$createComponent(_$Loading, {
								get on() {
									return v$query();
								},
								get fallback() {
									return (() => {
										var _el$16 = _$createElement("p");
										_$insertNode(_el$16, _$createTextNode("Searching…"));
										return _el$16;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$17 = _$createElement("table");
											var _el$18 = _$createElement("tbody");
											_$insertNode(_el$17, _el$18);
											_$insert(_el$18, _$createComponent(_$For, {
												get each() {
													return v$users();
												},
												children: (v$u) => {
													const __o = __rt.owner();
													return _$createComponent(V$Row, {
														user: v$u,
														children: []
													});
												}
											}));
											return _el$17;
										})();
									})();
								}
							}), _el$13);
							_$insertNode(_el$13, _el$14);
							_$insertNode(_el$13, _el$15);
							_$insert(_el$13, () => {
								return __rt.show(__rt.latest(() => v$page()));
							}, _el$15);
							_$effect(() => {
								return {
									e: __rt.isPending(() => v$users()) ? "dim" : "",
									t: __rt.isPending(() => v$users())
								};
							}, ({ e, t }, _p$) => {
								e !== _p$?.e && _$setProp(_el$12, "class", e, _p$?.e);
								t !== _p$?.t && _$setProp(_el$13, "disabled", t, _p$?.t);
							});
							return _el$9;
						})();
					})();
				}
			});
		}
		const v$rename = __rt.action(function* (v$id, v$name) {
			w$users.guess((v$us) => v$us?.map((v$u) => __rt.eq(v$u?.id, v$id) ? {
				...v$u,
				"name": v$name
			} : v$u));
			w$editing.guess(null);
			w$editing.set(null);
			w$saveError.set("");
			try {
				let v$saved = yield __rt.awaited(v$saveUser(v$id, v$name));
				w$users.set((v$us) => v$us?.map((v$u) => __rt.eq(v$u?.id, v$id) ? v$saved : v$u));
			} catch (v$e) {
				w$saveError.set("could not save " + __rt.fmt(v$name) + ": " + __rt.fmt(v$e?.message));
			}
		});
		__rt.reg("rename", { value: v$rename });
		const v$nextPage = __rt.action(function* () {
			w$page.set(__rt.snapshot(v$page) + 1);
		});
		__rt.reg("nextPage", { value: v$nextPage });
		const v$search = __rt.action(function* (v$q) {
			w$query.set(v$q);
			w$page.set(1);
		});
		__rt.reg("search", { value: v$search });
		const [v$page, w$page] = __rt.source("page", __rt.untrack(() => 1));
		__rt.reg("page", {
			get: v$page,
			w: w$page
		});
		const [v$query, w$query] = __rt.source("query", __rt.untrack(() => ""));
		__rt.reg("query", {
			get: v$query,
			w: w$query
		});
		const [v$users, w$users] = __rt.question("users", (__prev) => __rt.awaited(v$fetchUsers(v$page(), v$query())), __rt.firstPaint(() => []), {
			optimistic: true,
			structured: false
		});
		__rt.reg("users", {
			get: v$users,
			w: w$users
		});
		const [v$editing, w$editing] = __rt.question("editing", (__prev) => null, undefined, {
			optimistic: true,
			structured: false
		});
		__rt.reg("editing", {
			get: v$editing,
			w: w$editing
		});
		const [v$saveError, w$saveError] = __rt.source("saveError", __rt.untrack(() => ""));
		__rt.reg("saveError", {
			get: v$saveError,
			w: w$saveError
		});
		const v$total = __rt.memo("total", (__prev) => v$len(v$users()), undefined);
		__rt.reg("total", { get: v$total });
		const v$status = __rt.memo("status", (__prev) => __rt.isPending(() => v$users()) ? "loading…" : __rt.fmt(v$total()) + " users", undefined);
		__rt.reg("status", { get: v$status });
		return _$createComponent(V$App, { children: [] });
	};
}

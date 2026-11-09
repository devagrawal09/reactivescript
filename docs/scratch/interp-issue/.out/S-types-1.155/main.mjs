import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$TooShort;
function g$TooShort(__rt) {
	const __B = __rt.B;
	return c$TooShort ??= __rt.errorClass("TooShort", ["min"], (v$min) => "at least " + __rt.fmt(v$min));
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fetchUser = __rt.api("fetchUser");
		__rt.reg("fetchUser", { value: v$fetchUser });
		const v$User = __rt.api("User");
		__rt.reg("User", { value: v$User });
		const v$NotFound = __rt.jsError("NotFound");
		__rt.reg("NotFound", { value: v$NotFound });
		const v$TooShort = g$TooShort(__rt);
		const v$accent = __rt.context("accent", () => "blue");
		__rt.reg("accent", { value: v$accent });
		function V$Badge(v$props) {
			const __o = __rt.owner();
			const v$tone = __rt.memo("tone", (__prev) => __rt.useGet(v$accent, __o), undefined);
			__rt.reg("tone", { get: v$tone });
			return (() => {
				var _el$ = _$createElement("span");
				_$insert(_el$, () => {
					return __rt.show(v$props?.label);
				}, null);
				_$insert(_el$, () => {
					return __rt.show(__rt.eq(v$props?.count, null) ? "" : " " + __rt.fmt(v$props?.count));
				}, null);
				_$effect(() => v$tone(), (_v$, _$p) => {
					_$setProp(_el$, "class", _v$, _$p);
				});
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			function v$shout(v$s) {
				return v$s?.toUpperCase();
			}
			const v$add = __rt.action(function* (v$t) {
				try {
					if (__B.len(v$t) < 2) {
						throw v$TooShort(2);
					} else {}
					w$tags.set((v$xs) => [...v$xs, v$t]);
					w$draft.set("");
				} catch (v$e) {
					if (!__rt.isA(v$e, [v$TooShort])) throw v$e;
					w$draft.set(__rt.fmt(v$e?.message) + " (" + __rt.fmt(v$e?.min) + ")");
				}
			});
			__rt.reg("add", { value: v$add });
			const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
			__rt.reg("id", {
				get: v$id,
				w: w$id
			});
			const [v$draft, w$draft] = __rt.source("draft", __rt.untrack(() => ""));
			__rt.reg("draft", {
				get: v$draft,
				w: w$draft
			});
			const [v$tags, w$tags] = __rt.source("tags", __rt.untrack(() => []));
			__rt.reg("tags", {
				get: v$tags,
				w: w$tags
			});
			const i$user = __rt.memo("user", (__prev) => __rt.awaited(v$fetchUser(v$id())), undefined);
			const v$user = __rt.catchMemo(() => i$user(), (__e) => __rt.isA(__e, [v$NotFound]), (v$e) => null);
			__rt.reg("user", { get: v$user });
			const v$initial = __rt.memo("initial", (__prev) => __rt.eq(v$user(), null) ? "?" : v$user()?.name?.slice(0, 1), undefined);
			__rt.reg("initial", { get: v$initial });
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$2 = _$createElement("p");
					var _el$3 = _$createTextNode("error: ");
					_$insertNode(_el$2, _el$3);
					_$insert(_el$2, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$2;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get fallback() {
								return (() => {
									var _el$4 = _$createElement("p");
									_$insertNode(_el$4, _$createTextNode("…"));
									return _el$4;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return [
										_$createComponent(_$Show, {
											get when() {
												return v$user();
											},
											get fallback() {
												const __o = __rt.owner();
												return (() => {
													var _el$6 = _$createElement("p");
													var _el$7 = _$createTextNode("no user ");
													_$insertNode(_el$6, _el$7);
													_$insert(_el$6, () => {
														return __rt.show(v$initial());
													}, null);
													return _el$6;
												})();
											},
											children: (__item) => {
												const n$user = __item;
												const __o = __rt.owner();
												return (() => {
													var _el$8 = _$createElement("p");
													var _el$9 = _$createTextNode(" ");
													_$insertNode(_el$8, _el$9);
													_$insert(_el$8, () => {
														return __rt.show(v$shout(n$user()?.name));
													}, _el$9);
													_$insert(_el$8, () => {
														return __rt.show(n$user()?.email ?? "no email");
													}, null);
													return _el$8;
												})();
											}
										}),
										_$createComponent(_$For, {
											get each() {
												return v$tags();
											},
											children: (v$t) => {
												const __o = __rt.owner();
												return _$createComponent(V$Badge, {
													label: v$t,
													get count() {
														return __B.len(v$t);
													},
													children: []
												});
											}
										}),
										(() => {
											var _el$5 = _$createElement("button", { onClick: () => {
												v$add(__rt.snapshot(v$draft));
											} });
											_$insertNode(_el$5, _$createTextNode("add"));
											return _el$5;
										})()
									];
								})();
							}
						});
					})();
				}
			});
		}
		return _$createComponent(V$App, { children: [] });
	};
}

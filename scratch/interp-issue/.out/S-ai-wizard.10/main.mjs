import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from wizard.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		const v$str = __B.str;
		__rt.reg("str", { value: v$str });
		const v$log = __B.log;
		__rt.reg("log", { value: v$log });
		const v$submitSignup = __rt.api("submitSignup");
		__rt.reg("submitSignup", { value: v$submitSignup });
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$submit = __rt.action(function* () {
				w$status.set("submitting");
				try {
					let v$id = yield __rt.awaited(v$submitSignup(__rt.snapshot(v$form)));
					w$status.set("done #" + __rt.fmt(v$id));
				} catch (v$e) {
					w$status.set("failed: " + __rt.fmt(v$e?.message));
				}
			});
			__rt.reg("submit", { value: v$submit });
			const [v$step, w$step] = __rt.source("step", __rt.untrack(() => 1));
			__rt.reg("step", {
				get: v$step,
				w: w$step
			});
			const [v$form, w$form] = __rt.source("form", __rt.untrack(() => ({
				"name": "",
				"email": "",
				"plan": ""
			})));
			__rt.reg("form", {
				get: v$form,
				w: w$form
			});
			const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
			__rt.reg("status", {
				get: v$status,
				w: w$status
			});
			const v$furthest = __rt.memo("furthest", (__prev) => v$step() > __rt.preOr(__prev, () => 1) ? v$step() : __rt.preOr(__prev, () => 1), undefined);
			__rt.reg("furthest", { get: v$furthest });
			return (() => {
				var _el$ = _$createElement("main");
				var _el$2 = _$createElement("p");
				var _el$3 = _$createTextNode("Step ");
				var _el$4 = _$createTextNode(" of 3 (reached ");
				var _el$5 = _$createTextNode(")");
				var _el$6 = _$createElement("p");
				_$insertNode(_el$, _el$2);
				_$insertNode(_el$, _el$6);
				_$insertNode(_el$2, _el$3);
				_$insertNode(_el$2, _el$4);
				_$insertNode(_el$2, _el$5);
				_$insert(_el$2, () => {
					return __rt.show(v$step());
				}, _el$4);
				_$insert(_el$2, () => {
					return __rt.show(v$furthest());
				}, _el$5);
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return __rt.eq(v$step(), 1);
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						const [v$tries, w$tries] = __rt.source("tries", __rt.untrack(() => 0));
						__rt.reg("tries", {
							get: v$tries,
							w: w$tries
						});
						const v$nameOk = __rt.memo("nameOk", (__prev) => v$len(v$form()?.name) > 0, undefined);
						__rt.reg("nameOk", { get: v$nameOk });
						__rt.effect(0, () => [], ($p) => __rt.untrack(() => {
							v$log("enter", 1);
							return () => {
								v$log("leave", 1);
							};
						}));
						return (() => {
							var _el$7 = _$createElement("section");
							var _el$8 = _$createElement("input", { onInput: (v$e) => {
								w$form.path(["name"], v$e?.target?.value);
							} });
							var _el$9 = _$createElement("button", { onClick: () => {
								if (__rt.snapshot(v$nameOk)) {
									w$step.set(2);
								} else {
									w$tries.set(__rt.snapshot(v$tries) + 1);
								}
							} });
							_$insertNode(_el$7, _el$8);
							_$insertNode(_el$7, _el$9);
							_$insert(_el$7, _$createComponent(_$Show, {
								get when() {
									return _$memo(() => {
										return v$tries() > 0;
									})() && !v$nameOk();
								},
								get fallback() {
									const __o = __rt.owner();
									return null;
								},
								children: (__item) => {
									const __o = __rt.owner();
									return (() => {
										var _el$10 = _$createElement("em");
										_$insertNode(_el$10, _$createTextNode("name required"));
										return _el$10;
									})();
								}
							}), _el$9);
							_$insertNode(_el$9, _$createTextNode("next"));
							_$effect(() => v$form()?.name, (_v$, _$p) => {
								_$setProp(_el$8, "value", _v$, _$p);
							});
							return _el$7;
						})();
					}
				}), _el$6);
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return __rt.eq(v$step(), 2);
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						const [v$email, w$email] = __rt.source("email", __rt.untrack(() => __rt.untrack(() => v$form()?.email)));
						__rt.reg("email", {
							get: v$email,
							w: w$email
						});
						const v$emailOk = __rt.memo("emailOk", (__prev) => v$email()?.includes("@"), undefined);
						__rt.reg("emailOk", { get: v$emailOk });
						__rt.effect(0, () => [], ($p) => __rt.untrack(() => {
							v$log("enter", 2);
							return () => {
								v$log("leave", 2);
							};
						}));
						return (() => {
							var _el$11 = _$createElement("section");
							var _el$12 = _$createElement("p");
							var _el$13 = _$createTextNode("email: ");
							var _el$14 = _$createTextNode(" ");
							var _el$15 = _$createElement("input", { onInput: (v$e) => {
								w$email.set(v$e?.target?.value);
							} });
							var _el$16 = _$createElement("button", { onClick: () => {
								w$step.set(1);
							} });
							var _el$17 = _$createElement("button", { onClick: () => {
								if (__rt.snapshot(v$emailOk)) {
									w$form.path(["email"], __rt.snapshot(v$email));
									w$step.set(3);
								} else {}
							} });
							_$insertNode(_el$11, _el$12);
							_$insertNode(_el$11, _el$15);
							_$insertNode(_el$11, _el$16);
							_$insertNode(_el$11, _el$17);
							_$insertNode(_el$12, _el$13);
							_$insertNode(_el$12, _el$14);
							_$insert(_el$12, () => {
								return __rt.show(v$email());
							}, _el$14);
							_$insert(_el$12, () => {
								return __rt.show(v$emailOk() ? "" : "(invalid)");
							}, null);
							_$insertNode(_el$16, _$createTextNode("back"));
							_$insertNode(_el$17, _$createTextNode("next"));
							_$effect(() => {
								return {
									e: v$email(),
									t: !v$emailOk()
								};
							}, ({ e, t }, _p$) => {
								e !== _p$?.e && _$setProp(_el$15, "value", e, _p$?.e);
								t !== _p$?.t && _$setProp(_el$17, "disabled", t, _p$?.t);
							});
							return _el$11;
						})();
					}
				}), _el$6);
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return __rt.eq(v$step(), 3);
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						const [v$agreed, w$agreed] = __rt.source("agreed", __rt.untrack(() => false));
						__rt.reg("agreed", {
							get: v$agreed,
							w: w$agreed
						});
						const v$ready = __rt.memo("ready", (__prev) => !__rt.eq(v$form()?.plan, "") && v$agreed(), undefined);
						__rt.reg("ready", { get: v$ready });
						__rt.effect(0, () => [], ($p) => __rt.untrack(() => {
							v$log("enter", 3);
							return () => {
								v$log("leave", 3);
							};
						}));
						return (() => {
							var _el$18 = _$createElement("section");
							var _el$19 = _$createElement("p");
							var _el$20 = _$createTextNode(" / ");
							var _el$21 = _$createTextNode(" / ");
							var _el$22 = _$createElement("button", { onClick: () => {
								w$form.path(["plan"], "pro");
							} });
							var _el$23 = _$createElement("button", { onClick: () => {
								w$agreed.set(!__rt.snapshot(v$agreed));
							} });
							var _el$24 = _$createElement("button", { onClick: () => {
								w$step.set(2);
							} });
							var _el$25 = _$createElement("button", { onClick: () => {
								if (__rt.snapshot(v$ready)) {
									v$submit();
								} else {}
							} });
							_$insertNode(_el$18, _el$19);
							_$insertNode(_el$18, _el$22);
							_$insertNode(_el$18, _el$23);
							_$insertNode(_el$18, _el$24);
							_$insertNode(_el$18, _el$25);
							_$insertNode(_el$19, _el$20);
							_$insertNode(_el$19, _el$21);
							_$insert(_el$19, () => {
								return __rt.show(v$form()?.name);
							}, _el$20);
							_$insert(_el$19, () => {
								return __rt.show(v$form()?.email);
							}, _el$21);
							_$insert(_el$19, () => {
								return __rt.show(__rt.eq(v$form()?.plan, "") ? "no plan" : v$form()?.plan);
							}, null);
							_$insertNode(_el$22, _$createTextNode("pro"));
							_$insert(_el$23, () => {
								return __rt.show(v$agreed() ? "agreed" : "agree");
							});
							_$insertNode(_el$24, _$createTextNode("back"));
							_$insertNode(_el$25, _$createTextNode("submit"));
							_$effect(() => !v$ready(), (_v$, _$p) => {
								_$setProp(_el$25, "disabled", _v$, _$p);
							});
							return _el$18;
						})();
					}
				}), _el$6);
				_$insert(_el$6, () => {
					return __rt.show(__rt.isPending(() => v$status()) ? "submitting" : v$status());
				});
				return _el$;
			})();
		}
		return _$createComponent(V$App, { children: [] });
	};
}

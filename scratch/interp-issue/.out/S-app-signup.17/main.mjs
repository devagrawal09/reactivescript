import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from signup.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$checkUsername = __rt.api("checkUsername");
		__rt.reg("checkUsername", { value: v$checkUsername });
		const v$register = __rt.api("register");
		__rt.reg("register", { value: v$register });
		function V$Field(v$props) {
			const __o = __rt.owner();
			const v$showError = __rt.memo("showError", (__prev) => v$submitted() && !__rt.eq(v$props?.error, ""), undefined);
			__rt.reg("showError", { get: v$showError });
			return (() => {
				var _el$ = _$createElement("label");
				var _el$2 = _$createElement("span");
				_$insertNode(_el$, _el$2);
				_$insert(_el$2, () => {
					return __rt.show(v$props?.label);
				});
				_$insert(_el$, () => {
					return __rt.show(v$props?.children);
				}, null);
				_$insert(_el$, _$createComponent(_$Show, {
					get when() {
						return v$showError();
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const n$showError = __item;
						const __o = __rt.owner();
						return (() => {
							var _el$3 = _$createElement("em");
							_$insert(_el$3, () => {
								return __rt.show(v$props?.error);
							});
							return _el$3;
						})();
					}
				}), null);
				return _el$;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$4 = _$createElement("p", { class: "error" });
					_$insert(_el$4, () => {
						return __rt.show(v$e()?.message);
					});
					return _el$4;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$5 = _$createElement("form", { onSubmit: (v$e) => {
								v$e?.preventDefault();
								v$submit();
							} });
							var _el$9 = _$createElement("button");
							_$insertNode(_el$5, _el$9);
							_$insert(_el$5, _$createComponent(V$Field, {
								label: "Username",
								get error() {
									return v$usernameError();
								},
								get children() {
									return [(() => {
										var _el$6 = _$createElement("input", { onInput: (v$e) => {
											w$username.set(v$e?.target?.value);
										} });
										_$effect(() => v$username(), (_v$, _$p) => {
											_$setProp(_el$6, "value", _v$, _$p);
										});
										return _el$6;
									})(), _$createComponent(_$Show, {
										get when() {
											return v$checking();
										},
										get fallback() {
											const __o = __rt.owner();
											return null;
										},
										children: (__item) => {
											const n$checking = __item;
											const __o = __rt.owner();
											return (() => {
												var _el$10 = _$createElement("small");
												_$insertNode(_el$10, _$createTextNode("checking…"));
												return _el$10;
											})();
										}
									})];
								}
							}), _el$9);
							_$insert(_el$5, _$createComponent(V$Field, {
								label: "Email",
								get error() {
									return v$emailError();
								},
								get children() {
									var _el$7 = _$createElement("input", { onInput: (v$e) => {
										w$email.set(v$e?.target?.value);
									} });
									_$effect(() => v$email(), (_v$, _$p) => {
										_$setProp(_el$7, "value", _v$, _$p);
									});
									return _el$7;
								}
							}), _el$9);
							_$insert(_el$5, _$createComponent(V$Field, {
								label: "Password",
								get error() {
									return v$passwordError();
								},
								get children() {
									var _el$8 = _$createElement("input", {
										type: "password",
										onInput: (v$e) => {
											w$password.set(v$e?.target?.value);
										}
									});
									_$effect(() => v$password(), (_v$, _$p) => {
										_$setProp(_el$8, "value", _v$, _$p);
									});
									return _el$8;
								}
							}), _el$9);
							_$insertNode(_el$9, _$createTextNode("Sign up"));
							_$insert(_el$5, _$createComponent(_$Errored, {
								fallback: (v$e) => (() => {
									var _el$11 = _$createElement("p", { class: "error" });
									_$insert(_el$11, () => {
										return __rt.show(v$e()?.message);
									});
									return _el$11;
								})(),
								get children() {
									return (() => {
										const __o = __rt.owner();
										return _$createComponent(_$Show, {
											get when() {
												return v$result();
											},
											get fallback() {
												const __o = __rt.owner();
												return null;
											},
											children: (__item) => {
												const n$result = __item;
												const __o = __rt.owner();
												return (() => {
													var _el$12 = _$createElement("p");
													_$insert(_el$12, () => {
														return __rt.show(n$result()?.message);
													});
													_$effect(() => n$result()?.ok ? "ok" : "error", (_v$, _$p) => {
														_$setProp(_el$12, "class", _v$, _$p);
													});
													return _el$12;
												})();
											}
										});
									})();
								}
							}), null);
							_$effect(() => v$submitted() && !v$valid(), (_v$, _$p) => {
								_$setProp(_el$9, "disabled", _v$, _$p);
							});
							return _el$5;
						})();
					})();
				}
			});
		}
		const v$submit = __rt.action(function* () {
			w$submitted.set(true);
			try {
				if (!__rt.snapshot(v$valid)) {
					return;
				} else {}
				let v$r = yield __rt.awaited(v$register(__rt.snapshot(v$username), __rt.snapshot(v$email), __rt.snapshot(v$password)));
				w$result.set(v$r);
			} catch (v$e) {
				w$result.set({
					"ok": false,
					"message": v$e?.message
				});
			}
		});
		__rt.reg("submit", { value: v$submit });
		const [v$username, w$username] = __rt.source("username", __rt.untrack(() => ""));
		__rt.reg("username", {
			get: v$username,
			w: w$username
		});
		const [v$email, w$email] = __rt.source("email", __rt.untrack(() => ""));
		__rt.reg("email", {
			get: v$email,
			w: w$email
		});
		const [v$password, w$password] = __rt.source("password", __rt.untrack(() => ""));
		__rt.reg("password", {
			get: v$password,
			w: w$password
		});
		const [v$submitted, w$submitted] = __rt.source("submitted", __rt.untrack(() => false));
		__rt.reg("submitted", {
			get: v$submitted,
			w: w$submitted
		});
		const [v$result, w$result] = __rt.source("result", __rt.untrack(() => null));
		__rt.reg("result", {
			get: v$result,
			w: w$result
		});
		const v$usernameTaken = __rt.memo("usernameTaken", (__prev) => v$username()?.length < 3 ? false : __rt.awaited(v$checkUsername(v$username())), __rt.firstPaint(() => false));
		__rt.reg("usernameTaken", { get: v$usernameTaken });
		const v$checking = __rt.memo("checking", (__prev) => __rt.isPending(() => v$usernameTaken()), undefined);
		__rt.reg("checking", { get: v$checking });
		const v$usernameError = __rt.memo("usernameError", (__prev) => __rt.eq(v$username(), "") ? "required" : v$username()?.length < 3 ? "at least 3 characters" : __rt.latest(() => v$usernameTaken()) ? "already taken" : "", undefined);
		__rt.reg("usernameError", { get: v$usernameError });
		const v$emailError = __rt.memo("emailError", (__prev) => v$email()?.includes("@") ? "" : "not an email", undefined);
		__rt.reg("emailError", { get: v$emailError });
		const v$passwordError = __rt.memo("passwordError", (__prev) => v$password()?.length >= 8 ? "" : "at least 8 characters", undefined);
		__rt.reg("passwordError", { get: v$passwordError });
		const v$valid = __rt.memo("valid", (__prev) => __rt.eq(v$usernameError(), "") && __rt.eq(v$emailError(), "") && __rt.eq(v$passwordError(), "") && !v$checking(), undefined);
		__rt.reg("valid", { get: v$valid });
		return _$createComponent(V$App, { children: [] });
	};
}

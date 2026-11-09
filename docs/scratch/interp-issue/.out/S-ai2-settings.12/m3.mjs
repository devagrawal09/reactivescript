import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from form.rx — do not edit
import __m1 from "./m1.mjs";
import __m0 from "./m0.mjs";
import __m2 from "./m2.mjs";
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i1 = __rt.module("m1.mjs", __m1);
	const v$save = __i1["save"];
	const v$validate = __i1["validate"];
	const v$NameRequired = __i1["NameRequired"];
	const v$NameTooLong = __i1["NameTooLong"];
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$theme = __i0["theme"];
	const v$density = __i0["density"];
	const __i2 = __rt.module("m2.mjs", __m2);
	const V$Panel = __i2["Panel"];
	const V$Appearance = __i2["Appearance"];
	function V$SettingsForm(v$props) {
		const __o = __rt.owner();
		const v$pickTheme = __rt.action(function* (v$t) {
			w$draftTheme.set(v$t);
		});
		__rt.reg("pickTheme", { value: v$pickTheme });
		const [v$draftName, w$draftName] = __rt.source("draftName", __rt.untrack(() => __rt.untrack(() => v$props?.initial?.name)));
		__rt.reg("draftName", {
			get: v$draftName,
			w: w$draftName
		});
		const [v$draftTheme, w$draftTheme] = __rt.source("draftTheme", __rt.untrack(() => __rt.untrack(() => v$props?.initial?.theme)));
		__rt.reg("draftTheme", {
			get: v$draftTheme,
			w: w$draftTheme
		});
		const [v$draftDensity, w$draftDensity] = __rt.source("draftDensity", __rt.untrack(() => __rt.untrack(() => v$props?.initial?.density)));
		__rt.reg("draftDensity", {
			get: v$draftDensity,
			w: w$draftDensity
		});
		const v$draft = __rt.memo("draft", (__prev) => ({
			"name": v$draftName(),
			"theme": v$draftTheme(),
			"density": v$draftDensity()
		}), undefined);
		__rt.reg("draft", { get: v$draft });
		const v$valid = __rt.memo("valid", (__prev) => v$validate(v$draft()), undefined);
		__rt.reg("valid", { get: v$valid });
		const i$nameError = __rt.memo("nameError", (__prev) => v$valid() && "", undefined);
		const v$nameError = __rt.catchMemo(() => i$nameError(), (__e) => __rt.isA(__e, [v$NameRequired, v$NameTooLong]), (v$e) => v$e?.message);
		__rt.reg("nameError", { get: v$nameError });
		__rt.provide(v$theme, { get: __rt.memo(null, () => ({
			"current": v$draftTheme(),
			"pick": v$pickTheme
		})) });
		__rt.provide(v$density, {
			get: v$draftDensity,
			w: w$draftDensity
		});
		return (() => {
			var _el$ = _$createElement("div");
			var _el$8 = _$createElement("button", { onClick: () => {
				if (__rt.eq(__rt.snapshot(v$nameError), "")) {
					v$save(__rt.snapshot(v$draft));
				} else {}
			} });
			_$insertNode(_el$, _el$8);
			_$insert(_el$, _$createComponent(V$Panel, {
				title: "Profile",
				get children() {
					return [
						(() => {
							var _el$2 = _$createElement("label");
							var _el$4 = _$createTextNode("Display name");
							var _el$3 = _$createElement("input", { onInput: (v$ev) => {
								w$draftName.set(v$ev?.target?.value);
							} });
							_$insertNode(_el$2, _el$4);
							_$insertNode(_el$2, _el$3);
							_$insert(_el$2, () => {
								return __rt.show(" ");
							}, _el$3);
							_$effect(() => v$draftName(), (_v$, _$p) => {
								_$setProp(_el$3, "value", _v$, _$p);
							});
							return _el$2;
						})(),
						_$memo(() => {
							return __rt.show(" ");
						}),
						(() => {
							var _el$5 = _$createElement("small");
							var _el$6 = _$createTextNode("/20");
							_$insertNode(_el$5, _el$6);
							_$insert(_el$5, () => {
								return __rt.show(v$draftName()?.length);
							}, _el$6);
							return _el$5;
						})(),
						_$memo(() => {
							return __rt.show(" ");
						}),
						_$createComponent(_$Show, {
							get when() {
								return v$nameError();
							},
							get fallback() {
								const __o = __rt.owner();
								return null;
							},
							children: (__item) => {
								const n$nameError = __item;
								const __o = __rt.owner();
								return (() => {
									var _el$9 = _$createElement("p", { class: "error" });
									_$insert(_el$9, () => {
										return __rt.show(n$nameError());
									});
									return _el$9;
								})();
							}
						})
					];
				}
			}), _el$8);
			_$insert(_el$, () => {
				return __rt.show(" ");
			}, _el$8);
			_$insert(_el$, _$createComponent(V$Panel, {
				title: "Appearance",
				get children() {
					return _$createComponent(V$Appearance, { get children() {
						var _el$7 = _$createElement("button", { onClick: () => {
							w$draftDensity.set(__rt.eq(__rt.snapshot(v$draftDensity), "compact") ? "comfortable" : "compact");
						} });
						_$insertNode(_el$7, _$createTextNode("Toggle density"));
						return _el$7;
					} });
				}
			}), _el$8);
			_$insert(_el$, () => {
				return __rt.show(" ");
			}, _el$8);
			_$insertNode(_el$8, _$createTextNode("Save"));
			return _el$;
		})();
	}
	return { "SettingsForm": V$SettingsForm };
}

// compiled by ReactiveScript ref/compile from settings.rx — do not edit
import __m0 from "./m0.mjs";
let c$NameRequired;
function g$NameRequired(__rt) {
	const __B = __rt.B;
	return c$NameRequired ??= __rt.errorClass("NameRequired", [], () => "Display name is required");
}
let c$NameTooLong;
function g$NameTooLong(__rt) {
	const __B = __rt.B;
	return c$NameTooLong ??= __rt.errorClass("NameTooLong", ["count"], (v$count) => "Display name must be at most 20 characters, not " + __rt.fmt(v$count));
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const __i0 = __rt.module("m0.mjs", __m0);
	const v$loadSettings = __rt.api("loadSettings");
	__rt.reg("loadSettings", { value: v$loadSettings });
	const v$saveSettings = __rt.api("saveSettings");
	__rt.reg("saveSettings", { value: v$saveSettings });
	const v$NameRequired = g$NameRequired(__rt);
	const v$NameTooLong = g$NameTooLong(__rt);
	function v$validate(v$s) {
		return __rt.eq(v$s?.name?.length, 0) ? __rt.throw(v$NameRequired()) : v$s?.name?.length > 20 ? __rt.throw(v$NameTooLong(v$s?.name?.length)) : v$s;
	}
	const v$retryLoad = __rt.action(function* () {
		__rt.refresh("settings", v$settings);
	});
	__rt.reg("retryLoad", { value: v$retryLoad });
	const v$save = __rt.action(function* (v$next) {
		w$settings.guess(v$next);
		w$saveError.guess("");
		__rt.affects(v$settings);
		try {
			let v$saved = yield __rt.awaited(v$saveSettings(v$next));
			w$settings.set(v$saved);
			w$saveError.set("");
		} catch (v$e) {
			w$saveError.set(v$e?.message);
		}
	});
	__rt.reg("save", { value: v$save });
	const [v$settings, w$settings] = __rt.question("settings", (__prev) => __rt.awaited(v$loadSettings()), undefined, {
		optimistic: true,
		structured: false
	});
	__rt.reg("settings", {
		get: v$settings,
		w: w$settings
	});
	const [v$saveError, w$saveError] = __rt.question("saveError", (__prev) => "", undefined, {
		optimistic: true,
		structured: false
	});
	__rt.reg("saveError", {
		get: v$saveError,
		w: w$saveError
	});
	return {
		"NameRequired": v$NameRequired,
		"NameTooLong": v$NameTooLong,
		"validate": v$validate,
		"settings": v$settings,
		"saveError": v$saveError,
		"retryLoad": v$retryLoad,
		"save": v$save
	};
}

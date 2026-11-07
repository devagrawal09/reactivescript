import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
let c$TooLong;
function g$TooLong(__rt) {
	const __B = __rt.B;
	return c$TooLong ??= __rt.errorClass("TooLong", ["n"], (v$n) => "too long: " + __rt.fmt(v$n));
}
async function sf$loadUser(...__a) {
	"use server";
	const __rt = globalThis.__rx_app;
	const __B = __rt.B;
	const v$findUser = __rt.api("findUser");
	const v$insertNote = __rt.api("insertNote");
	const v$NotFound = __rt.jsError("NotFound");
	const v$TooLong = g$TooLong(__rt);
	return __rt.serverCall("loadUser", function* (v$id) {
		let v$u = yield __rt.awaited(v$findUser(v$id));
		return {
			"name": v$u?.name,
			"notes": v$u?.notes
		};
	}, __a);
}
async function sf$addNote(...__a) {
	"use server";
	const __rt = globalThis.__rx_app;
	const __B = __rt.B;
	const v$findUser = __rt.api("findUser");
	const v$insertNote = __rt.api("insertNote");
	const v$NotFound = __rt.jsError("NotFound");
	const v$TooLong = g$TooLong(__rt);
	return __rt.serverCall("addNote", function* (v$id, v$text) {
		if (__B.len(v$text) > 5) {
			throw v$TooLong(__B.len(v$text));
		} else {}
		yield __rt.awaited(v$insertNote(v$id, v$text));
		return __B.len(v$text);
	}, __a);
}
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$findUser = __rt.api("findUser");
		__rt.reg("findUser", { value: v$findUser });
		const v$insertNote = __rt.api("insertNote");
		__rt.reg("insertNote", { value: v$insertNote });
		const v$NotFound = __rt.jsError("NotFound");
		__rt.reg("NotFound", { value: v$NotFound });
		const v$TooLong = g$TooLong(__rt);
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$ = _$createElement("p");
					var _el$2 = _$createTextNode("error: ");
					_$insertNode(_el$, _el$2);
					_$insert(_el$, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get fallback() {
								return (() => {
									var _el$3 = _$createElement("p");
									_$insertNode(_el$3, _$createTextNode("loading"));
									return _el$3;
								})();
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return (() => {
										var _el$4 = _$createElement("p");
										var _el$5 = _$createTextNode(": ");
										var _el$6 = _$createTextNode(" notes ");
										_$insertNode(_el$4, _el$5);
										_$insertNode(_el$4, _el$6);
										_$insert(_el$4, () => {
											return __rt.show(v$user()?.name);
										}, _el$5);
										_$insert(_el$4, () => {
											return __rt.show(v$user()?.notes);
										}, _el$6);
										_$insert(_el$4, () => {
											return __rt.show(v$status());
										}, null);
										return _el$4;
									})();
								})();
							}
						});
					})();
				}
			});
		}
		const v$note = __rt.action(function* (v$t) {
			try {
				let v$n = yield __rt.awaited(v$addNote(__rt.snapshot(v$id), v$t));
				w$status.set("saved " + __rt.fmt(v$n));
			} catch (v$e) {
				w$status.set(v$e?.message);
			}
		});
		__rt.reg("note", { value: v$note });
		const v$loadUser = __rt.serverRef("loadUser", sf$loadUser);
		const v$addNote = __rt.serverRef("addNote", sf$addNote);
		const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
		__rt.reg("id", {
			get: v$id,
			w: w$id
		});
		const [v$status, w$status] = __rt.source("status", __rt.untrack(() => ""));
		__rt.reg("status", {
			get: v$status,
			w: w$status
		});
		const v$user = __rt.memo("user", (__prev) => __rt.awaited(v$loadUser(v$id())), undefined);
		__rt.reg("user", { get: v$user });
		return _$createComponent(V$App, { children: [] });
	};
}

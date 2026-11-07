import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { effect as _$effect } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { setProp as _$setProp } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from feed.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const v$fetchRooms = __rt.api("fetchRooms");
		__rt.reg("fetchRooms", { value: v$fetchRooms });
		const v$streamMessages = __rt.api("streamMessages");
		__rt.reg("streamMessages", { value: v$streamMessages });
		const v$sendMessage = __rt.api("sendMessage");
		__rt.reg("sendMessage", { value: v$sendMessage });
		const v$len = __B.len;
		__rt.reg("len", { value: v$len });
		const v$log = __B.log;
		__rt.reg("log", { value: v$log });
		const v$room = __rt.context("room", null);
		__rt.reg("room", { value: v$room });
		function V$RoomList(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$ = _$createElement("ul");
				_$insert(_el$, _$createComponent(_$For, {
					get each() {
						return v$props?.rooms;
					},
					children: (v$r) => {
						const __o = __rt.owner();
						return _$createComponent(V$RoomItem, {
							room: v$r,
							children: []
						});
					}
				}));
				return _el$;
			})();
		}
		function V$RoomItem(v$props) {
			const __o = __rt.owner();
			const v$active = __rt.memo("active", (__prev) => __rt.eq(__rt.useGet(v$room, __o)?.current, v$props?.room?.id), undefined);
			__rt.reg("active", { get: v$active });
			return (() => {
				var _el$2 = _$createElement("li", { onClick: () => {
					__rt.useGet(v$room, __o)?.pick(v$props?.room?.id);
				} });
				var _el$3 = _$createTextNode(" ");
				_$insertNode(_el$2, _el$3);
				_$insert(_el$2, () => {
					return __rt.show(v$props?.room?.name);
				}, _el$3);
				_$insert(_el$2, () => {
					return __rt.show(v$active() ? "*" : "-");
				}, null);
				_$insert(_el$2, () => {
					return __rt.show(" ");
				}, null);
				return _el$2;
			})();
		}
		function V$Compose(v$props) {
			const __o = __rt.owner();
			return (() => {
				var _el$4 = _$createElement("form", { onSubmit: () => {
					v$send();
				} });
				var _el$5 = _$createElement("input", { onInput: (v$e) => {
					w$draftText.set(v$e?.target?.value);
				} });
				var _el$6 = _$createElement("span");
				var _el$7 = _$createElement("button");
				var _el$8 = _$createElement("p");
				_$insertNode(_el$4, _el$5);
				_$insertNode(_el$4, _el$6);
				_$insertNode(_el$4, _el$7);
				_$insertNode(_el$4, _el$8);
				_$insert(_el$6, () => {
					return __rt.show(v$draftText());
				});
				_$insert(_el$4, _$createComponent(_$Show, {
					get when() {
						return !__rt.eq(v$draftText(), "");
					},
					get fallback() {
						const __o = __rt.owner();
						return null;
					},
					children: (__item) => {
						const __o = __rt.owner();
						return (() => {
							var _el$9 = _$createElement("i");
							_$insertNode(_el$9, _$createTextNode("typing…"));
							return _el$9;
						})();
					}
				}), _el$7);
				_$insert(_el$7, () => {
					return __rt.show(v$sending() ? "sending…" : "send");
				});
				_$insert(_el$8, () => {
					return __rt.show(v$error());
				});
				_$effect(() => v$draftText(), (_v$, _$p) => {
					_$setProp(_el$5, "value", _v$, _$p);
				});
				return _el$4;
			})();
		}
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => (() => {
					var _el$10 = _$createElement("p", { class: "error" });
					var _el$11 = _$createTextNode("The feed is unavailable: ");
					_$insertNode(_el$10, _el$11);
					_$insert(_el$10, () => {
						return __rt.show(v$e()?.message);
					}, null);
					return _el$10;
				})(),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return (() => {
							var _el$12 = _$createElement("main");
							_$insert(_el$12, _$createComponent(_$Loading, {
								get fallback() {
									return (() => {
										var _el$13 = _$createElement("p");
										_$insertNode(_el$13, _$createTextNode("rooms…"));
										return _el$13;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return _$createComponent(V$RoomList, {
											get rooms() {
												return v$rooms();
											},
											children: []
										});
									})();
								}
							}), null);
							_$insert(_el$12, _$createComponent(_$Loading, {
								get on() {
									return v$selected();
								},
								get fallback() {
									return (() => {
										var _el$14 = _$createElement("p");
										_$insertNode(_el$14, _$createTextNode("loading…"));
										return _el$14;
									})();
								},
								get children() {
									return (() => {
										const __o = __rt.owner();
										return (() => {
											var _el$15 = _$createElement("ol");
											_$insert(_el$15, _$createComponent(_$For, {
												get each() {
													return v$msgs();
												},
												children: (v$m) => {
													const __o = __rt.owner();
													return (() => {
														var _el$16 = _$createElement("li");
														var _el$17 = _$createTextNode(": ");
														_$insertNode(_el$16, _el$17);
														_$insert(_el$16, () => {
															return __rt.show(v$m?.from);
														}, _el$17);
														_$insert(_el$16, () => {
															return __rt.show(v$m?.text);
														}, null);
														_$insert(_el$16, () => {
															return __rt.show(" ");
														}, null);
														return _el$16;
													})();
												}
											}));
											return _el$15;
										})();
									})();
								}
							}), null);
							_$insert(_el$12, _$createComponent(V$Compose, { children: [] }), null);
							return _el$12;
						})();
					})();
				}
			});
		}
		const v$pick = __rt.action(function* (v$id) {
			w$selected.set(v$id);
		});
		__rt.reg("pick", { value: v$pick });
		const v$send = __rt.action(function* () {
			try {
				let v$text = __rt.snapshot(v$draftText);
				let v$room = __rt.snapshot(v$selected);
				let v$msg = {
					"id": v$len(__rt.snapshot(v$messages)) + 1,
					"from": "me",
					"text": v$text
				};
				w$draftText.guess("");
				w$sending.guess(true);
				w$messages.guess((v$m) => [...v$m, v$msg]);
				yield __rt.awaited(v$sendMessage(v$room, v$text));
				w$draftText.set("");
			} catch (v$e) {
				w$error.set(v$e?.message);
			}
		});
		__rt.reg("send", { value: v$send });
		const [v$selected, w$selected] = __rt.source("selected", __rt.untrack(() => 1));
		__rt.reg("selected", {
			get: v$selected,
			w: w$selected
		});
		__rt.provide(v$room, { get: __rt.memo(null, () => ({
			"current": v$selected(),
			"pick": v$pick
		})) });
		const v$rooms = __rt.memo("rooms", (__prev) => __rt.awaited(v$fetchRooms()), undefined);
		__rt.reg("rooms", { get: v$rooms });
		const [v$messages, w$messages] = __rt.question("messages", (__prev) => v$streamMessages(v$selected()), __rt.firstPaint(() => []), {
			optimistic: true,
			structured: false
		});
		__rt.reg("messages", {
			get: v$messages,
			w: w$messages
		});
		const v$msgs = __rt.keyed("msgs", "id", () => v$messages());
		__rt.reg("msgs", { get: v$msgs });
		const [v$draftText, w$draftText] = __rt.question("draftText", (__prev) => "", undefined, {
			optimistic: true,
			structured: false
		});
		__rt.reg("draftText", {
			get: v$draftText,
			w: w$draftText
		});
		const [v$sending, w$sending] = __rt.question("sending", (__prev) => false, undefined, {
			optimistic: true,
			structured: false
		});
		__rt.reg("sending", {
			get: v$sending,
			w: w$sending
		});
		const [v$error, w$error] = __rt.source("error", __rt.untrack(() => ""));
		__rt.reg("error", {
			get: v$error,
			w: w$error
		});
		__rt.effect(1, () => [v$len(v$msgs())], ($p) => __rt.untrack(() => {
			return v$log("count", $p[0]);
		}));
		return _$createComponent(V$App, { children: [] });
	};
}

import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { memo as _$memo } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Show as _$Show } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
import __m1 from "./m1.mjs";
import __m3 from "./m3.mjs";
import __m2 from "./m2.mjs";
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		const __i1 = __rt.module("m1.mjs", __m1);
		const v$settings = __i1["settings"];
		const v$saveError = __i1["saveError"];
		const v$retryLoad = __i1["retryLoad"];
		const __i3 = __rt.module("m3.mjs", __m3);
		const V$SettingsForm = __i3["SettingsForm"];
		const __i2 = __rt.module("m2.mjs", __m2);
		const V$Panel = __i2["Panel"];
		function V$App(v$props) {
			const __o = __rt.owner();
			return _$createComponent(_$Errored, {
				fallback: (v$e) => _$createComponent(V$Panel, {
					title: "Settings",
					get children() {
						return [
							(() => {
								var _el$ = _$createElement("p");
								var _el$2 = _$createTextNode("Could not load settings: ");
								_$insertNode(_el$, _el$2);
								_$insert(_el$, () => {
									return __rt.show(v$e()?.message);
								}, null);
								return _el$;
							})(),
							_$memo(() => {
								return __rt.show(" ");
							}),
							(() => {
								var _el$3 = _$createElement("button", { onClick: () => {
									v$retryLoad();
								} });
								_$insertNode(_el$3, _$createTextNode("Retry"));
								return _el$3;
							})()
						];
					}
				}),
				get children() {
					return (() => {
						const __o = __rt.owner();
						return _$createComponent(_$Loading, {
							get fallback() {
								return _$createComponent(V$Panel, {
									title: "Settings",
									get children() {
										var _el$4 = _$createElement("p");
										_$insertNode(_el$4, _$createTextNode("Loading settings…"));
										return _el$4;
									}
								});
							},
							get children() {
								return (() => {
									const __o = __rt.owner();
									return _$createComponent(_$Show, {
										get when() {
											return v$settings();
										},
										get fallback() {
											const __o = __rt.owner();
											return null;
										},
										children: (__item) => {
											const n$settings = __item;
											const __o = __rt.owner();
											return [
												(() => {
													var _el$5 = _$createElement("p");
													var _el$6 = _$createTextNode("Saved: ");
													var _el$7 = _$createTextNode(" · ");
													var _el$8 = _$createTextNode(" · ");
													_$insertNode(_el$5, _el$6);
													_$insertNode(_el$5, _el$7);
													_$insertNode(_el$5, _el$8);
													_$insert(_el$5, () => {
														return __rt.show(n$settings()?.name);
													}, _el$7);
													_$insert(_el$5, () => {
														return __rt.show(n$settings()?.theme);
													}, _el$8);
													_$insert(_el$5, () => {
														return __rt.show(n$settings()?.density);
													}, null);
													_$insert(_el$5, () => {
														return __rt.show(__rt.isPending(() => n$settings()) ? " (saving…)" : "");
													}, null);
													return _el$5;
												})(),
												_$memo(() => {
													return __rt.show(" ");
												}),
												_$createComponent(_$Show, {
													get when() {
														return v$saveError();
													},
													get fallback() {
														const __o = __rt.owner();
														return null;
													},
													children: (__item) => {
														const n$saveError = __item;
														const __o = __rt.owner();
														return [(() => {
															var _el$9 = _$createElement("p", { class: "error" });
															var _el$10 = _$createTextNode("Save failed: ");
															_$insertNode(_el$9, _el$10);
															_$insert(_el$9, () => {
																return __rt.show(n$saveError());
															}, null);
															return _el$9;
														})(), _$memo(() => {
															return __rt.show(" ");
														})];
													}
												}),
												_$createComponent(V$SettingsForm, {
													get initial() {
														return n$settings();
													},
													children: []
												})
											];
										}
									});
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

import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { For as _$For } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$toggle = __rt.action(function* (v$i) {
				try {
					w$todos.guess(true, [v$i, "done"]);
					yield __rt.awaited(__B.fetch("save"));
				} catch (__e) {}
			});
			__rt.reg("toggle", { value: v$toggle });
			const v$rename = __rt.action(function* (v$i) {
				try {
					w$todos.guess("Z", [v$i, "title"]);
					yield __rt.awaited(__B.fetch("ren"));
				} catch (__e) {}
			});
			__rt.reg("rename", { value: v$rename });
			const [v$todos, w$todos] = __rt.question("todos", (__prev) => __rt.awaited(__B.fetch("todos")), undefined, {
				optimistic: true,
				structured: true
			}, "id");
			__rt.reg("todos", {
				get: v$todos,
				w: w$todos
			});
			const v$shown = __rt.memo("shown", (__prev) => __rt.latest(() => v$todos()), undefined);
			__rt.reg("shown", { get: v$shown });
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
										var _el$4 = _$createElement("ul");
										_$insert(_el$4, _$createComponent(_$For, {
											get each() {
												return v$shown();
											},
											children: (v$t) => {
												const __o = __rt.owner();
												return (() => {
													var _el$5 = _$createElement("li");
													_$insert(_el$5, () => {
														return __rt.show(v$t?.title);
													}, null);
													_$insert(_el$5, () => {
														return __rt.show(v$t?.done ? "+" : "-");
													}, null);
													return _el$5;
												})();
											}
										}));
										return _el$4;
									})();
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

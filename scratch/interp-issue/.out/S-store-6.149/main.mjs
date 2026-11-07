import { createTextNode as _$createTextNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createComponent as _$createComponent } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insert as _$insert } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { insertNode as _$insertNode } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { createElement as _$createElement } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Errored as _$Errored } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
import { Loading as _$Loading } from "/private/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/string-renderer.ts";
// compiled by ReactiveScript ref/compile from main.rx — do not edit
export default function main(__rt) {
	const __B = __rt.B;
	return () => {
		const __o = __rt.owner();
		function V$App(v$props) {
			const __o = __rt.owner();
			const v$patch = __rt.action(function* () {
				try {
					w$state.guess(5, ["a"]);
					yield __rt.awaited(__B.fetch("w"));
				} catch (__e) {}
			});
			__rt.reg("patch", { value: v$patch });
			const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 1));
			__rt.reg("id", {
				get: v$id,
				w: w$id
			});
			const [v$state, w$state] = __rt.question("state", (__prev) => __rt.awaited(__B.fetch("s:" + __B.str(v$id()))), undefined, {
				optimistic: true,
				structured: true
			});
			__rt.reg("state", {
				get: v$state,
				w: w$state
			});
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
										var _el$5 = _$createTextNode(" ");
										var _el$6 = _$createTextNode(" ");
										var _el$7 = _$createTextNode(" ");
										_$insertNode(_el$4, _el$5);
										_$insertNode(_el$4, _el$6);
										_$insertNode(_el$4, _el$7);
										_$insert(_el$4, () => {
											return __rt.show(v$state()?.a);
										}, _el$5);
										_$insert(_el$4, () => {
											return __rt.show(v$state()?.b);
										}, _el$6);
										_$insert(_el$4, () => {
											return __rt.show(__rt.isPending(() => v$state()?.a) ? "a!" : "-");
										}, _el$7);
										_$insert(_el$4, () => {
											return __rt.show(__rt.isPending(() => v$state()?.b) ? "b!" : "-");
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
		return _$createComponent(V$App, { children: [] });
	};
}

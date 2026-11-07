import { createTextNode as _$createTextNode } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { insert as _$insert } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { insertNode as _$insertNode } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { createElement as _$createElement } from "/Users/devagr/rx-tsx-refresh/scratch/interp-issue/renderer.ts";
import { createSignal, createOptimistic, action } from "solid-js";
import { request } from "file:///Users/devagr/rx-tsx-refresh/scratch/interp-issue/api.mjs";
export default function App() {
	const [n, setN] = createSignal(0);
	const [guess, setGuess] = createOptimistic(() => n());
	const save = action(function* () {
		setGuess((value) => value + 1);
		try {
			yield request(1);
		} catch (error) {}
	});
	var _el$ = _$createElement("section");
	var _el$2 = _$createElement("button", { onClick: () => {
		setN(2);
		save();
	} });
	var _el$3 = _$createElement("output");
	_$insertNode(_el$, _el$2);
	_$insertNode(_el$, _el$3);
	_$insertNode(_el$2, _$createTextNode("save"));
	_$insert(_el$3, guess);
	return _el$;
}

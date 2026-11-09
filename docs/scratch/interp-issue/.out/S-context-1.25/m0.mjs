// compiled by ReactiveScript ref/compile from theme.rx — do not edit
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$theme = __rt.context("theme", () => "light");
	__rt.reg("theme", { value: v$theme });
	const v$accent = __rt.context("accent", null);
	__rt.reg("accent", { value: v$accent });
	return {
		"theme": v$theme,
		"accent": v$accent
	};
}

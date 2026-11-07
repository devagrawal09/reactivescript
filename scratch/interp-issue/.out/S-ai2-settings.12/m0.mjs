// compiled by ReactiveScript ref/compile from theme.rx — do not edit
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$theme = __rt.context("theme", null);
	__rt.reg("theme", { value: v$theme });
	const v$density = __rt.context("density", () => "comfortable");
	__rt.reg("density", { value: v$density });
	return {
		"theme": v$theme,
		"density": v$density
	};
}

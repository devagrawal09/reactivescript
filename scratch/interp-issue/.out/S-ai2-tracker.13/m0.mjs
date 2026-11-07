// compiled by ReactiveScript ref/compile from people.rx — do not edit
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$currentUser = __rt.context("currentUser", () => "guest");
	__rt.reg("currentUser", { value: v$currentUser });
	const v$signIn = __rt.action(function* (v$name) {
		w$session.set(v$name);
	});
	__rt.reg("signIn", { value: v$signIn });
	const [v$session, w$session] = __rt.source("session", __rt.untrack(() => "guest"));
	__rt.reg("session", {
		get: v$session,
		w: w$session
	});
	return {
		"currentUser": v$currentUser,
		"session": v$session,
		"signIn": v$signIn
	};
}

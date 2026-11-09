// compiled by ReactiveScript ref/compile from profile.rx — do not edit
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$fetchUser = __rt.api("fetchUser");
	__rt.reg("fetchUser", { value: v$fetchUser });
	const v$fetchPosts = __rt.api("fetchPosts");
	__rt.reg("fetchPosts", { value: v$fetchPosts });
	const [v$id, w$id] = __rt.source("id", __rt.untrack(() => 7));
	__rt.reg("id", {
		get: v$id,
		w: w$id
	});
	const v$user = __rt.memo("user", (__prev) => __rt.awaited(v$fetchUser(v$id())), undefined);
	__rt.reg("user", { get: v$user });
	const v$posts = __rt.memo("posts", (__prev) => __rt.awaited(v$fetchPosts(v$id())), undefined);
	__rt.reg("posts", { get: v$posts });
	return {
		"id": v$id,
		"user": v$user,
		"posts": v$posts
	};
}

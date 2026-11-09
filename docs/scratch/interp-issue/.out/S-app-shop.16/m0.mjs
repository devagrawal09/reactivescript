// compiled by ReactiveScript ref/compile from catalog.rx — do not edit
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$fetchProducts = __rt.api("fetchProducts");
	__rt.reg("fetchProducts", { value: v$fetchProducts });
	const v$validateCoupon = __rt.api("validateCoupon");
	__rt.reg("validateCoupon", { value: v$validateCoupon });
	const v$setCoupon = __rt.action(function* (v$code) {
		w$coupon.set(v$code);
	});
	__rt.reg("setCoupon", { value: v$setCoupon });
	const [v$products, w$products] = __rt.question("products", (__prev) => __rt.awaited(v$fetchProducts()), __rt.firstPaint(() => []), {
		optimistic: false,
		structured: false
	});
	__rt.reg("products", {
		get: v$products,
		w: w$products
	});
	const [v$coupon, w$coupon] = __rt.source("coupon", __rt.untrack(() => ""));
	__rt.reg("coupon", {
		get: v$coupon,
		w: w$coupon
	});
	const v$discount = __rt.memo("discount", (__prev) => __rt.eq(v$coupon(), "") ? 0 : __rt.awaited(v$validateCoupon(v$coupon())), __rt.firstPaint(() => 0));
	__rt.reg("discount", { get: v$discount });
	return {
		"products": v$products,
		"coupon": v$coupon,
		"discount": v$discount,
		"setCoupon": v$setCoupon
	};
}

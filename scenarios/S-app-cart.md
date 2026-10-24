# S-app-cart — examples/cart.rx

A shopping cart: a catalogue with an empty first paint, per-key quantity
writes into a structured source, a coupon that is a question on its code
shown display-ahead (`latest`, `pending?`), and a checkout action that
empties the cart optimistically — reverted when the order is declined,
confirmed silently when it lands.

## Program

file: ../examples/cart.rx

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0       | mount |`Cart (0)Coupon Subtotal 0Total 0Checkout` |
| 1       | resolve "fetchProducts:" [{ id: 1, name: "Tea", price: 4 }, { id: 2, name: "Mug", price: 10 }] |`Cart (0)Tea4-0+Mug10-0+Coupon Subtotal 0Total 0Checkout` |
| 2       | handler `setQty(1, 2)` |`Cart (2)Tea4-2+Mug10-0+Coupon Subtotal 8Total 8Checkout` |
| 3       | handler `setQty(2, 1)` |`Cart (3)Tea4-2+Mug10-1+Coupon Subtotal 18Total 18Checkout` |
| 4       | handler `coupon := "SAVE10"` |`Cart (3)Tea4-2+Mug10-1+Coupon checking…Subtotal 18Total 18Checkout` |
| 5       | resolve "validateCoupon:SAVE10" 10 |`Cart (3)Tea4-2+Mug10-1+Coupon -10%Subtotal 18Total 16.2Checkout` |
| 6       | handler `placeOrder()` |`Cart (0)Tea4-0+Mug10-0+Coupon -10%Subtotal 0Total 0CheckoutPlacing order…` |
| 7       | reject "checkout:[{"id":1,"qty":2},{"id":2,"qty":1}],SAVE10" "declined" |`Cart (3)Tea4-2+Mug10-1+Coupon -10%Subtotal 18Total 16.2CheckoutFailed: declined` |
| 8       | handler `setQty(2, 0)` |`Cart (2)Tea4-2+Mug10-0+Coupon -10%Subtotal 8Total 7.2CheckoutFailed: declined` |
| 9       | handler `placeOrder()` |`Cart (0)Tea4-0+Mug10-0+Coupon -10%Subtotal 0Total 0CheckoutPlacing order…` |
| 10      | resolve "checkout:[{"id":1,"qty":2}],SAVE10" { id: 77 } |`Cart (0)Tea4-0+Mug10-0+Coupon -10%Subtotal 0Total 0CheckoutOrder #77 placed` |

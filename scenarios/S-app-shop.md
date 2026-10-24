# S-app-shop — examples/shop/ (examples/cart.rx in four modules)

The cart of S-app-cart, split by ownership (09): `catalog.rx` holds the
catalogue and the coupon, `cart.rx` the lines and checkout, `ui.rx` the
row and a panel that keeps its children's failures inside it, `main.rx`
applies them. The frames are S-app-cart's, row for row: modules change
what each file may see and write, not what the screen does. The one
difference in the rows is instant 4 — the coupon is written through
`catalog.rx`'s action, since an importer cannot write it (MO-2).

## Program

file: ../examples/shop/main.rx

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0       | mount |`Cart (0) Coupon Subtotal 0 Total 0 Checkout` |
| 1       | resolve "fetchProducts:" [{ id: 1, name: "Tea", price: 4 }, { id: 2, name: "Mug", price: 10 }] |`Cart (0) Tea 4 - 0 + Mug 10 - 0 + Coupon Subtotal 0 Total 0 Checkout` |
| 2       | handler `setQty(1, 2)` |`Cart (2) Tea 4 - 2 + Mug 10 - 0 + Coupon Subtotal 8 Total 8 Checkout` |
| 3       | handler `setQty(2, 1)` |`Cart (3) Tea 4 - 2 + Mug 10 - 1 + Coupon Subtotal 18 Total 18 Checkout` |
| 4       | handler `setCoupon("SAVE10")` |`Cart (3) Tea 4 - 2 + Mug 10 - 1 + Coupon checking… Subtotal 18 Total 18 Checkout` |
| 5       | resolve "validateCoupon:SAVE10" 10 |`Cart (3) Tea 4 - 2 + Mug 10 - 1 + Coupon -10% Subtotal 18 Total 16.2 Checkout` |
| 6       | handler `placeOrder()` |`Cart (0) Tea 4 - 0 + Mug 10 - 0 + Coupon -10% Subtotal 0 Total 0 Checkout Placing order…` |
| 7       | reject "checkout:[{"id":1,"qty":2},{"id":2,"qty":1}],SAVE10" "declined" |`Cart (3) Tea 4 - 2 + Mug 10 - 1 + Coupon -10% Subtotal 18 Total 16.2 Checkout Failed: declined` |
| 8       | handler `setQty(2, 0)` |`Cart (2) Tea 4 - 2 + Mug 10 - 0 + Coupon -10% Subtotal 8 Total 7.2 Checkout Failed: declined` |
| 9       | handler `placeOrder()` |`Cart (0) Tea 4 - 0 + Mug 10 - 0 + Coupon -10% Subtotal 0 Total 0 Checkout Placing order…` |
| 10      | resolve "checkout:[{"id":1,"qty":2}],SAVE10" { id: 77 } |`Cart (0) Tea 4 - 0 + Mug 10 - 0 + Coupon -10% Subtotal 0 Total 0 Checkout Order #77 placed` |

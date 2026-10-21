# S-solid-18 — `on` follows the frame of the change (Solid S-18; D-15)

## Program

```
source id := 1
product = await fetch("p:" + id)
comments = await fetch("c:" + id)
<div><h1>{product.name}</h1> {loading on(id) fallback { <p>spinner</p> } { <ul>{comments}</ul> }}</div>
```

## Frames

| instant | action                          | frame            |
| ------- | ------------------------------- | ---------------- |
| 0       | mount                           | ``               |
| 1       | resolve product { name: "A" }   | `A spinner`      |
| 2       | resolve comments "comments-A"   | `A comments-A`   |
| 3       | handler `id := 2`               | `A comments-A`   |
| 4       | resolve product { name: "B" }   | `B spinner`      |
| 5       | resolve comments "comments-B"   | `B comments-B`   |

Instant 3: the shell's `product(2)` holds the frame; the fallback is
entered but not shown. Instant 4: it lands with `B`, not beside `A`.

## Variant: comments land first — no spinner ever

```
source id := 1
product = await fetch("p:" + id)
comments = await fetch("c:" + id)
<div><h1>{product.name}</h1> {loading on(id) fallback { <p>spinner</p> } { <ul>{comments}</ul> }}</div>
```

| instant | action                          | frame            |
| ------- | ------------------------------- | ---------------- |
| 3       | handler `id := 2`               | `A comments-A`   |
| 4       | resolve comments "comments-B"   | `A comments-A`   |
| 5       | resolve product { name: "B" }   | `B comments-B`   |

## Variant: nothing outside holds

```
source id := 1
comments = await fetch("c:" + id)
<div>{loading on(id) fallback { <p>spinner</p> } { <ul>{comments}</ul> }}</div>
```

| instant | action                          | frame          |
| ------- | ------------------------------- | -------------- |
| 0       | mount                           | `spinner`      |
| 1       | resolve comments "comments-A"   | `comments-A`   |
| 2       | handler `id := 2`               | `spinner`      |
| 3       | resolve comments "comments-B"   | `comments-B`   |

## Divergences

- oracle "Frames" instant 0: `spinner` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty (`ASYNC_OUTSIDE_LOADING_BOUNDARY`); H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.

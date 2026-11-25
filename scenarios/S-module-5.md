# S-module-5 — Foreign function types survive projection

Rules exercised: MO-8, TY-4b.

## Modules

```rx
-- module: ./api.d.rx
type Cleanup = () => void
export error Offline
export error Stopped
export fn every(callback: () => void, ms: number): Cleanup
export pure fn identity<T>(value: T): T
export fn flush(): Promise<void> rejects(Offline, Stopped)
```

## Program

```rx
import { every, identity } from "./api"
action start() {
  every(() => {}, 5000)
}
fn roundTrip(n: number): number => identity(n)
export default component App() { <p>ok</p> }
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `ok` |

## Rejected: private aliases are not exports

```rx
-- reject: NOT_EXPORTED
import { Cleanup } from "./api"
export default component App() { <p>ok</p> }
```

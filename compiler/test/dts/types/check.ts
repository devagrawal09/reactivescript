// The helpers' types. A line ending in an `error:` comment is a TS error whose message has the comment's text;
// every other line type-checks, so inference flows through the helpers.
import { pure, rejects, ref, instantiates, server, client } from "@reactivescript/js";
import * as rx from "@reactivescript/js";
import { Gone } from "./errors";

type Accessor<T> = () => T;
declare function createSignal<T>(value: T): [Accessor<T>, (v: T) => void];
class NotFound extends Error {}
class NotErr {}

export const fetchUser = pure(rejects([NotFound, Gone, TypeError], async (id: number) => ({ id })));
export const createToggle = ref({ result: [0] }, (initial: boolean) => createSignal(initial));
export const createDebounced = ref({ args: [0], result: true }, (source: Accessor<string>, ms: number) => source);
export const box = ref({ result: ["value"] }, () => ({ value: () => 1, set(v: number) { void v; } }));
export const never = rejects([], async () => 1);
export const neverServer = server(rejects([] as const, async () => 1));
export const listen = instantiates(server(client((el: EventTarget) => el)));
export const identity = pure(<T,>(x: T) => x);
export const redundantRef = rx.pure(client(ref({ result: true }, () => () => 1))); // error: ref already implies pure
export const redundantInstantiates = instantiates(server(pure(() => 1))); // error: ref/instantiates already imply pure

const p: Promise<{ id: number }> = fetchUser(1);
const [read, write]: [Accessor<boolean>, (v: boolean) => void] = createToggle(true);
const s: string = createDebounced(() => "a", 10)();
const n: number = box().value();
const e: EventTarget = listen(new EventTarget());
const str: string = identity("a");
const q: Promise<number> = never(); void q; void neverServer;
void p; void read; void write; void s; void n; void e; void str;

export const wrongArg = ref({ args: [1] }, (source: Accessor<string>, ms: number) => source); // error: not assignable to type '0'
export const noAccessorArg = ref({ args: [0] }, (ms: number) => ms); // error: no parameter of this function is an accessor
export const notError = rejects([NotErr], async () => 1); // error: not assignable to type 'ErrorClass'
export const resultNotAccessor = ref({ result: true }, (n: number) => n); // error: the result of this function is not an accessor
export const wrongElement = ref({ result: [1] }, (initial: boolean) => createSignal(initial)); // error: not assignable to type '0'
export const wrongKey = ref({ result: ["set"] }, () => ({ value: () => 1, set(v: number) { void v; } })); // error: not assignable to type '"value"'
export const badReturn: (x: number) => string = pure((x: number) => x); // error: not assignable to type 'string'
export const unannotated = pure((x) => x);
unannotated(1); // error: not assignable to parameter of type 'never'
export const notAFunction = pure(42); // error: not assignable to parameter of type 'AnyFn
export const defaulted: (x?: number) => number = pure((x = 1) => x);
export const widened: () => number = pure(() => 1);
let widenedResult = widened(); widenedResult = 2; void widenedResult;

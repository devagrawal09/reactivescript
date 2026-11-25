// @reactivescript/js: the helpers a .ts module wraps its exports in, so `rx-dts` generates their .d.rx facts
// (spec/09 MO-11). Inference flows through each helper, and at runtime it is the identity.
// Helpers nest, each at most once; ref and instantiates already imply pure:
//
//   export const fetchUser = pure(rejects([NotFound], async (id: number) => …))
//
// The helper call is the whole initializer of an exported `const`, or an `export default` expression.
// The bound is `(...args: never) => unknown`: inference is as without the helper (`() => 1` is `() => number`),
// and an unannotated parameter is `never` (an error where it is called), not a silent `any`.

/** What a helper wraps: any function. */
type AnyFn = (...args: never) => unknown;
declare const purity: unique symbol;
type Mark<F, Why extends string> = F & { readonly [purity]: Why };
type NoPurity = { readonly [purity]?: never };

/** Any function, to read parameters and result. */
type Fn = (...args: any[]) => any;

/** An accessor: a function called with no arguments (Solid's `Accessor<T>`). */
type ZeroArg = () => unknown;

/** The indices of `P`'s required, non-rest elements whose type is an accessor. */
type AccessorIndex<P extends readonly unknown[]> = {
  [K in keyof P & `${number}`]-?: P[K] extends ZeroArg ? (K extends `${infer N extends number}` ? N : never) : never;
}[keyof P & `${number}`];

/** The string keys of `R` whose property is an accessor. */
type AccessorKey<R> = {
  [K in keyof R]-?: R[K] extends ZeroArg ? K : never;
}[keyof R] & string;

/**
 * Where a `ref` result can be: `true` when the result is an accessor; the indices of a returned tuple's
 * accessor elements; the keys of a returned object's accessor properties.
 */
type RefResult<R> =
  | (R extends ZeroArg ? true : never)
  | (R extends readonly unknown[] ? readonly AccessorIndex<R>[] : R extends Fn ? never : R extends object ? readonly AccessorKey<R>[] : never);

/** `T`, or when nothing fits, a message the type error shows. */
type OrSay<T, Message extends string> = [T] extends [never] ? Message : [T] extends [readonly (infer E)[]] ? ([E] extends [never] ? Message : T) : T;

/**
 * `ref`'s spec, checked against the function it wraps: `args` are indices of parameters whose type is an
 * accessor (`() => T`); `result` is `true` for an accessor result, or the tuple indices / object keys of the
 * result's accessor parts. A position that is not an accessor is a type error (`not assignable to never`).
 */
export type RefSpec<F extends AnyFn> = F extends Fn ? {
  /** Indices of the parameters that are accessors: `ref p` (MO-10a). */
  readonly args?: OrSay<readonly AccessorIndex<Parameters<F>>[], "no parameter of this function is an accessor (() => T)">;
  /** `true`: the result is an accessor; or the tuple indices / object keys of its accessor parts (MO-10b). */
  readonly result?: OrSay<RefResult<ReturnType<F>>, "the result of this function is not an accessor (() => T), nor a tuple or object with one">;
} : never;

/** A class whose instances are `Error`s: what `rejects` lists. */
export type ErrorClass = abstract new (...args: any[]) => Error;

/** `pure(fn)` generates `export pure fn`: safe to call in reactive scope (R-io-4; unchecked, CN-5). */
export declare function pure<F extends AnyFn>(fn: F & NoPurity): Mark<F, "remove pure(…): ref/instantiates already imply pure (and pure is written only once)">;

/**
 * `rejects([A, B], fn)` generates `rejects(A | B)` (R-f-8): `fn` rejects only with these error classes.
 * The list is an array literal of classes, each reaching `Error`. Without it, a generated fn rejects `Error`.
 */
export declare function rejects<F extends AnyFn>(errors: readonly ErrorClass[], fn: F): F;

/**
 * `ref({ args: [0], result: true }, fn)` generates `ref` parameters and a `ref` result (MO-10a/b).
 * `result` may also list the accessor elements of a returned tuple (`[0]`) or properties of a returned
 * object (`["value"]`). The spec is a literal. Implies `pure`.
 */
export declare function ref<F extends AnyFn>(spec: NoInfer<RefSpec<F>>, fn: F & NoPurity): Mark<F, "ref already implies pure; remove pure(…)">;

/**
 * `instantiates(fn)` generates `instantiates` (MO-10a): the call makes nodes in the caller's owner. Write it
 * only where no `ref` is present; a `ref` already implies it. Implies `pure`.
 */
export declare function instantiates<F extends AnyFn>(fn: F & NoPurity): Mark<F, "instantiates already implies pure; remove pure(…)">;

/** `server(fn)` generates `export server fn` (12 SF-5). Not with `client`. */
export declare function server<F extends AnyFn>(fn: F): F;

/** `client(fn)` generates `export client fn` (12 SF-5). Not with `server`. */
export declare function client<F extends AnyFn>(fn: F): F;

/** @internal The helpers' kinds, as the hook receives them. */
export type HelperKind = "pure" | "rejects" | "ref" | "instantiates" | "server" | "client";

/**
 * @internal Install the hook every helper calls: `h(kind, fn, meta)` returns the function to export (`meta` is
 * `rejects`' classes or `ref`'s spec). `null` restores the identity. Returns the previous hook.
 */
export declare function __setHook(
  h: ((kind: HelperKind, fn: Fn, meta: readonly ErrorClass[] | RefSpec<Fn> | undefined) => Fn) | null,
): ((kind: HelperKind, fn: Fn, meta: readonly ErrorClass[] | RefSpec<Fn> | undefined) => Fn) | null;

// ---- the v1 brands

/** @internal — read by the declaration generator; write the helpers instead */
export type Pure<R> = R;

/** @internal — read by the declaration generator; write the helpers instead */
export type Rejects<P extends PromiseLike<unknown>, E extends Error> = P;

/** @internal — read by the declaration generator; write the helpers instead */
export type Ref<T> = () => T;

/** @internal — read by the declaration generator; write the helpers instead */
export type Instantiates<R> = R;

/** @internal — read by the declaration generator; write the helpers instead */
export type Server<R> = R;

/** @internal — read by the declaration generator; write the helpers instead */
export type Client<R> = R;

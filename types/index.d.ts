// @reactivescript/types: brands a .ts module writes so `rx-dts` can generate its .d.rx rows (spec/09 MO-11).
// Every brand is a plain alias: TypeScript checks the implementation against the type and forgets the brand.
// The wrapper brands (Pure, Rejects, Instantiates, Server, Client) go at the head of an exported function's
// return type, in any order, each at most once. `Ref` marks a parameter, the result, a top-level element of a
// returned tuple, or a property of a returned object type literal.

/** `f(…): Pure<R>` generates `export pure fn f`: safe to call in reactive scope (R-io-4; unchecked, CN-5). */
export type Pure<R> = R;

/**
 * `f(…): Rejects<Promise<T>, A | B>` generates `rejects(A | B)` (R-f-8). Each member is a class whose base
 * chain reaches `Error`. Without it, a generated fn rejects `Error`.
 */
export type Rejects<P extends PromiseLike<unknown>, E extends Error> = P;

/**
 * Solid's `Accessor<T>`. On a parameter, `f(p: Ref<T>)` generates `ref p`: an accessor argument (MO-10a).
 * As the result, a returned tuple element or a returned object property, it generates `ref T` (MO-10b).
 */
export type Ref<T> = () => T;

/**
 * `f(…): Instantiates<R>` generates `instantiates` (MO-10a): the call makes nodes in the caller's owner.
 * Write it only where no `Ref` is present; a `Ref` already implies it.
 */
export type Instantiates<R> = R;

/** `f(…): Server<R>` generates `export server fn f` (12 SF-5). Not with `Client`. */
export type Server<R> = R;

/** `f(…): Client<R>` generates `export client fn f` (12 SF-5). Not with `Server`. */
export type Client<R> = R;

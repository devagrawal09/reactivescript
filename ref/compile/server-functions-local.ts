// 12 SF-7b: Solid's server-function wrappers where there is no network (the test renderer's runner): the function as it is.
export const GET = <F>(f: F): F => f;
export const live = <F>(f: F): F => f;
export const broadcast = <F>(f: F): F => f;
export const withMeta = <F>(f: F): F => f;

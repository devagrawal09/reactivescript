// Solid's native compiler is only used to emit JS from whole programs, which the page never does.
export const transform = () => { throw new Error('the Solid compiler is not in the browser build'); };

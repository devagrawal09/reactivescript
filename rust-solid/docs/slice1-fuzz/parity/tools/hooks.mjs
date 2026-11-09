// Resolves ./x.js imports inside out/solid-src to ./x.ts for strip-types execution.
import {existsSync} from 'node:fs';import {fileURLToPath} from 'node:url';
export async function resolve(spec,ctx,next){if(spec.endsWith('.js')&&ctx.parentURL?.includes('/solid-src/')){const u=new URL(spec,ctx.parentURL);const ts=u.href.replace(/\.js$/,'.ts');if(existsSync(fileURLToPath(ts)))return next(ts,ctx)}return next(spec,ctx)}

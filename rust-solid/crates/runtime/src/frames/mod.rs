//! Slice 6: inferred server components over Solid 2's Frames (frontend
//! `docs/RESULTS.md`, "Slice 6"; `docs/FRAMES.md` here). A structural port
//! of what Solid 2's server runs for a frames app: the server-function
//! endpoint (`@solidjs/web/server-functions`, `server.ts`), server
//! components as frame streams (`@solidjs/web/frames`, `frame-sink.ts`), and
//! the t=0 document with its inline frames, served from a plan v2.2 and
//! answered byte for byte as Solid's own server answers the canonical split
//! (frontend `plan/split.ts`). Reference: solid-next `2105ffb8`
//! (2.0.0-rc.21), production server builds. Each ported function carries a
//! `// Solid:` comment with its file and lines; `server.ts` (unqualified,
//! here) is `packages/web/server-functions/src/server.ts`, `shared.ts` its
//! `shared.ts`, `frame-sink.ts` `packages/web/frames/src/frame-sink.ts`.
pub mod document;
pub mod hosts;
pub mod http;
pub mod plan;
pub mod render;
pub mod server;
pub mod shared;

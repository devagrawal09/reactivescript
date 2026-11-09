//! Slice 5: server rendering. A structural port of what Solid 2's server
//! builds run when `renderToString` renders a plan v2 app, and the lowering
//! of a plan into the calls Solid's compiler emits for its TSX twin in
//! `generate: "ssr", hydratable: true` mode. The HTML is meant to be byte for
//! byte Solid's own, so that Solid's client build hydrates it.
//!
//! Reference: solid `2105ffb8` (rc.21), production server builds:
//! `packages/solid/src/server/{signals,flow,shared}.ts` (the server's own
//! signals and owners, not `@solidjs/signals`), `packages/web/src/server.ts`
//! and `render.ts` (`memo`), and the compiler's `src/ssr/transform.rs`,
//! `src/shared/{utils,condition,classify}.rs`. Each function carries a
//! `// Solid:` correspondence comment; in this module `signals.ts`, `flow.ts`
//! and `shared.ts` are `packages/solid/src/server/*.ts` (the server build,
//! not `@solidjs/signals`), `server.ts` is `packages/web/src/server.ts`, and
//! `compiler …` is `packages/compiler/src/…`. docs/SSR.md has the results
//! and the differences from the client build.
pub mod flow;
pub mod owner;
pub mod plan;
pub mod signals;
pub mod value;
pub mod web;

pub use value::{JsVal, Thrown};

/// The module-level state of the server builds: the owner tree and
/// `currentOwner` (solid/src/server/signals.ts), whether a render context is
/// set (`sharedConfig.context`), and `ssrTextTail` (web/src/server.ts).
#[derive(Default)]
pub struct Server {
    pub(crate) owners: Vec<owner::SsrOwner>,
    pub(crate) current: Option<owner::OwnerId>,
    /// `ownerCreations`: the creation stamp, read only by live holes.
    pub(crate) owner_creations: u64,
    pub(crate) context: bool,
    pub(crate) ssr_text_tail: bool,
}

impl Server {
    pub fn new() -> Self {
        Self::default()
    }
}

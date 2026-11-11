//! Slice 5: server rendering. A structural port of what Solid 2's server
//! builds run when `renderToString` and `renderToStream` render a plan app,
//! and the lowering of a plan into the calls Solid's compiler emits for its
//! TSX twin in `generate: "ssr", hydratable: true` mode. The HTML and the
//! stream's chunks are meant to be byte for byte Solid's own, so that Solid's
//! client build hydrates them.
//!
//! Reference: solid `2105ffb8` (rc.21), production server builds:
//! `packages/solid/src/server/{signals,flow,shared,hydration}.ts` (the
//! server's own signals and owners, not `@solidjs/signals`),
//! `packages/web/src/server.ts` and `render.ts` (`memo`),
//! `packages/web/serialization/src/serializer.ts` (the hydration
//! serializer), seroval 1.7.0 (`src/core/…`, the serializer Solid's web
//! package uses), and the compiler's `src/ssr/transform.rs`,
//! `src/shared/{utils,condition,classify}.rs`. Each function carries a
//! `// Solid:` correspondence comment; in this module `signals.ts`,
//! `flow.ts`, `shared.ts` and `hydration.ts` are
//! `packages/solid/src/server/*.ts` (the server build, not
//! `@solidjs/signals`), `server.ts` is `packages/web/src/server.ts`,
//! `serializer.ts` is `packages/web/serialization/src/serializer.ts`,
//! `seroval …` is seroval's `src/core/…` (read from its `dist/index.js`,
//! the file Solid loads) and `compiler …` is `packages/compiler/src/…`.
//! docs/SSR.md has the results and the differences from the client build.
pub mod boundary;
pub mod flow;
pub mod js;
pub mod owner;
pub mod plan;
pub mod seroval;
pub mod signals;
pub mod stream;
pub mod value;
pub mod web;

pub use value::{JsVal, Thrown};

use js::Job;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    rc::Rc,
};

/// The module-level state of the server builds and of the JS host: the owner
/// tree and `currentOwner` (solid/src/server/signals.ts), the render context
/// (`sharedConfig.context`), `ssrTextTail` (web/src/server.ts), the
/// `NotReadyError` latches, the error verdicts, the fragment containers, and
/// the microtask and immediate queues.
#[derive(Default)]
pub struct Server {
    pub(crate) owners: Vec<owner::SsrOwner>,
    pub(crate) current: Option<owner::OwnerId>,
    /// `ownerCreations`: the creation stamp, read only by live holes.
    pub(crate) owner_creations: u64,
    /// `sharedConfig.context`.
    pub(crate) ctx: Option<Rc<web::RenderCtx>>,
    pub(crate) ssr_text_tail: bool,
    pub(crate) microtasks: VecDeque<Job>,
    pub(crate) immediates: VecDeque<Job>,
    /// `notReadyLatches` and `notReadyClearQueued` (signals.ts:1753-1774).
    pub(crate) latches: Vec<signals::Latch>,
    pub(crate) latch_clear_queued: bool,
    /// `verdicts` (signals.ts:3993-4016) for the render's one error scope.
    pub(crate) verdicts: Vec<(JsVal, Rc<RefCell<boundary::Verdict>>)>,
    /// `containers` (signals.ts:3756-3781): a Loading boundary's fragment
    /// container, by owner.
    pub(crate) containers: HashMap<owner::OwnerId, Rc<boundary::Container>>,
    /// Failures the ported code has no channel for (a value seroval fails to
    /// serialize, a scheduled `setTimeout`): the render fails closed with
    /// them.
    pub(crate) failures: Vec<String>,
    /// Errors the render reported and survived, as Solid's `reportFailure`
    /// does (`console.error`): a failure no boundary took, which fails the
    /// request but still ends the stream.
    pub(crate) render_errors: Vec<String>,
    /// Frames (slice 6, `crate::frames`): the brands Solid's frames runtime
    /// writes on functions and objects, by identity. Empty outside frames
    /// renders.
    pub(crate) brands: Brands,
    /// The live-hole engine's `suppressed` count (server.ts:4330): fills,
    /// slot ranges and in-tag holes resolve outside it. Frames only.
    pub(crate) live_suppressed: u32,
}

/// Frames' brands, by object identity: a server component binding
/// (`SERVER_COMPONENT`: its function id, `SERVER_COMPONENT_ADDRESS`: its
/// call's address), and the document's live channel (a `ReadableStream`).
#[derive(Default)]
/// Each brand keeps its object alive (the identity of a dropped object could
/// be another's later).
pub struct Brands {
    pub components: HashMap<usize, (String, String, JsVal)>,
    pub streams: HashMap<usize, (Rc<dyn LiveChannel>, JsVal)>,
    /// `$rows`: a `For`'s rows in a live render (signals.ts:3615).
    pub rows: HashMap<usize, JsVal>,
    /// `$slot`: a slot range (frame-sink.ts:1232-1237, 1609-1619).
    pub slots: HashMap<usize, JsVal>,
}

impl Brands {
    pub fn brand_rows(&mut self, v: &JsVal) {
        self.rows
            .insert(v.identity().expect("an object"), v.clone());
    }
    pub fn brand_slot(&mut self, v: &JsVal) {
        self.slots
            .insert(v.identity().expect("an object"), v.clone());
    }
    pub fn is_rows(&self, v: &JsVal) -> bool {
        v.identity().is_some_and(|k| self.rows.contains_key(&k))
    }
    pub fn is_slot(&self, v: &JsVal) -> bool {
        v.identity().is_some_and(|k| self.slots.contains_key(&k))
    }
}

/// A `ReadableStream` the hydration serializer can carry (seroval-plugins
/// web `ReadableStreamPlugin`): its reader's pull, as an async iterator.
pub trait LiveChannel {
    /// `reader.read()`: a promise of whether the stream is done (`true` once
    /// it closed).
    fn read(&self, s: &mut Server) -> Rc<js::JsPromise>;
}

impl Server {
    pub fn new() -> Self {
        Self::default()
    }
}

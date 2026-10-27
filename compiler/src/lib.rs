//! ReactiveScript's compiler (spec/11): the parse and check stages of `ref/src/`, ported so that they give the same
//! answers on every program (CP-5), and the resolved model between check and lower (CP-6). Lowering onto Solid's
//! `solidjs-compiler` (CP-1) comes next.

pub mod ast;
pub mod check;
pub mod content;
pub mod model;
pub mod modules;
pub mod parse;
pub mod signature;

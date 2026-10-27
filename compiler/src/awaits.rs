//! R-1 / 07 §3 (`ref/src/awaits.ts`): the awaits of an equation that are not its result, each with the conditions under
//! which the equation reaches it (E-11: an arm not selected is not demanded, so its flight is not asked). The compiler
//! hoists each into its own async node, asked only while its guards hold; the equation reads it where the `await` was.

use crate::ast::{Expr, Markup, MarkupKind};
use crate::check::{children, Node};

#[derive(Clone, Copy)]
pub struct Guard<'a> {
    pub e: &'a Expr,
    pub neg: bool,
    pub nullish: bool,
}
pub struct Hoisted<'a> {
    /// an `Expr::Await`
    pub node: &'a Expr,
    pub guards: Vec<Guard<'a>>,
}

fn with<'a>(g: &[Guard<'a>], x: Guard<'a>) -> Vec<Guard<'a>> {
    let mut v = g.to_vec();
    v.push(x);
    v
}

/// `tail = false`: every await of `root` — a reader of a view, an effect's input or a provision, whose expression is not an
/// equation's own memo, so even its result-position `await` is a flight of its own (07 §3).
pub fn non_tail_awaits(root: &Expr, tail: bool) -> Vec<Hoisted<'_>> {
    let mut out = vec![];
    walk(Node::E(root), tail, &[], &mut out);
    out
}

fn walk<'a>(n: Node<'a>, tail: bool, g: &[Guard<'a>], out: &mut Vec<Hoisted<'a>>) {
    let g0 = |e| Guard { e, neg: false, nullish: false };
    if let Node::E(x) = n {
        match x {
            Expr::Await { e, init, .. } => {
                if !tail {
                    out.push(Hoisted { node: x, guards: g.to_vec() });
                }
                walk(Node::E(e), false, g, out);
                if let Some(i) = init {
                    walk(Node::E(i), false, g, out);
                }
                return;
            }
            Expr::If { c, t, f } => {
                walk(Node::E(c), false, g, out);
                walk(Node::E(t), tail, &with(g, g0(c)), out);
                walk(Node::E(f), tail, &with(g, Guard { e: c, neg: true, nullish: false }), out);
                return;
            }
            Expr::Bin { op, l, r } => {
                walk(Node::E(l), false, g, out);
                match op.as_str() {
                    "&&" => walk(Node::E(r), false, &with(g, g0(l)), out),
                    "||" => walk(Node::E(r), false, &with(g, Guard { e: l, neg: true, nullish: false }), out),
                    "??" => walk(Node::E(r), false, &with(g, Guard { e: l, neg: false, nullish: true }), out),
                    _ => walk(Node::E(r), false, g, out),
                }
                return;
            }
            Expr::Catch { e, alt, .. } => {
                walk(Node::E(e), tail, g, out);
                walk(Node::E(alt), false, g, out);
                return;
            }
            // a closure's body runs later; a draft's statements are its own
            Expr::Fn { .. } | Expr::Draft { .. } => return,
            _ => {}
        }
    }
    for c in children(n, false) {
        walk(c, false, g, out);
    }
}

/// 07 §3: the expressions a region's own view reads — readers, attributes (not handlers), `if` conditions, `for` collections,
/// `loading on(…)` and fallbacks, `portal to(…)` — but not its sub-regions', which are hoisted where they are set up. An
/// `errored` fallback binds its error, so it stays out.
pub fn view_readers(ms: &[Markup]) -> Vec<&Expr> {
    let mut out = vec![];
    for m in ms {
        match &m.kind {
            MarkupKind::Read(e) => out.push(e),
            MarkupKind::El { attrs, children, .. } => {
                out.extend(attrs.iter().filter(|a| !is_handler(&a.name)).map(|a| &a.e));
                out.extend(view_readers(children));
            }
            MarkupKind::Mif { c, .. } => out.push(c),
            MarkupKind::Mfor { xs, .. } => out.push(xs),
            MarkupKind::Loading { on, fallback, .. } => {
                out.extend(on.iter());
                out.extend(view_readers(fallback));
            }
            MarkupKind::Portal { to, .. } => out.extend(to.iter()),
            _ => {}
        }
    }
    out
}

/// `/^on[A-Z:]/`
pub fn is_handler(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() > 2 && b[0] == b'o' && b[1] == b'n' && (b[2].is_ascii_uppercase() || b[2] == b':')
}

//! 10 SV-7d: HTML nesting that the browser's parser restructures (`ref/src/content.ts`). A component whose root the parser
//! would move, wrap or drop where it is applied serves a page that is not the tree the client builds.

use std::collections::HashSet;
use std::sync::LazyLock;

/// What a component contributes where it is applied: its root elements (`#text` for text), whether it contains an element
/// that closes an open `<p>`, an `<a>`, a `<form>`; and the ancestor chains where it places its caller's children.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shape {
    pub roots: Vec<String>,
    pub closes_p: bool,
    pub a: bool,
    pub form: bool,
    pub children_at: Vec<Vec<String>>,
}

fn words(s: &'static str) -> HashSet<&'static str> {
    s.split(' ').collect()
}
pub static P_CLOSERS: LazyLock<HashSet<&str>> = LazyLock::new(|| {
    words("address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr listing main menu nav ol p plaintext pre search section table ul xmp")
});
pub static P_SCOPE: LazyLock<HashSet<&str>> = LazyLock::new(|| words("applet button caption html marquee object table td template th"));
static SPECIAL: LazyLock<HashSet<&str>> = LazyLock::new(|| {
    words("address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp")
});
static TABLE_PARTS: LazyLock<HashSet<&str>> = LazyLock::new(|| words("caption colgroup col thead tbody tfoot tr td th"));
static A_SCOPE: LazyLock<HashSet<&str>> = LazyLock::new(|| words("td th caption template object marquee applet"));
fn table(p: &str) -> Option<HashSet<&'static str>> {
    Some(match p {
        "table" => words("caption colgroup thead tbody tfoot script template style"),
        "thead" | "tbody" | "tfoot" => words("tr script template style"),
        "tr" => words("td th script template style"),
        "colgroup" => words("col template"),
        _ => return None,
    })
}
fn heading(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1])
}

/// What the parser does with `t` (a tag, or `#text`) as the next child where `anc` are open (innermost last); `None`: it is
/// placed there. An empty `anc` is an unknown place (a view's root): nothing is said.
pub fn misnested(anc: &[String], t: &str) -> Option<String> {
    let p = anc.last()?.as_str();
    if p == "template" {
        return None;
    }
    if let Some(allowed) = table(p) {
        if t == "#text" {
            return Some(format!("moves the text out of the <{}> (foster parenting)", p));
        }
        if allowed.contains(t) {
            return None;
        }
        if p == "table" && (t == "tr" || t == "td" || t == "th") {
            return Some(format!("wraps it in a <tbody>{} the client does not build", if t == "tr" { "" } else { " and a <tr>" }));
        }
        if p == "table" && t == "col" {
            return Some("wraps it in a <colgroup> the client does not build".into());
        }
        if (p == "thead" || p == "tbody" || p == "tfoot") && (t == "td" || t == "th") {
            return Some("wraps it in a <tr> the client does not build".into());
        }
        return Some(format!("moves it out of the <{}> (foster parenting)", p));
    }
    if t == "#text" {
        return None;
    }
    if TABLE_PARTS.contains(t) {
        return Some(format!("drops the <{}> tag outside a table (its content stays, unwrapped)", t));
    }
    if P_CLOSERS.contains(t) {
        for a in anc.iter().rev() {
            if a == "p" {
                return Some("closes the open <p> before it".into());
            }
            if P_SCOPE.contains(a.as_str()) {
                break;
            }
        }
    }
    if t == "a" {
        for a in anc.iter().rev() {
            if a == "a" {
                return Some("closes the open <a> (links do not nest)".into());
            }
            if A_SCOPE.contains(a.as_str()) {
                break;
            }
        }
    }
    if t == "form" && anc.iter().any(|a| a == "form") {
        return Some("ignores a <form> inside a <form>".into());
    }
    if t == "button" {
        for a in anc.iter().rev() {
            if a == "button" {
                return Some("closes the open <button>".into());
            }
            if P_SCOPE.contains(a.as_str()) && a != "button" {
                break;
            }
        }
    }
    if heading(t) && heading(p) {
        return Some(format!("closes the open <{}>", p));
    }
    if t == "li" || t == "dd" || t == "dt" {
        let same = |x: &str| if t == "li" { x == "li" } else { x == "dd" || x == "dt" };
        for a in anc.iter().rev() {
            if same(a) {
                return Some(format!("closes the open <{}>", a));
            }
            if SPECIAL.contains(a.as_str()) && a != "address" && a != "div" && a != "p" {
                break;
            }
        }
    }
    if t == "option" && p == "option" {
        return Some("closes the open <option>".into());
    }
    None
}
/// A component's `closes_p`, `a`, `form` against the places above its application.
pub fn misnested_inside(anc: &[String], s: &Shape) -> Option<String> {
    if s.closes_p {
        for a in anc.iter().rev() {
            if a == "p" {
                return Some("contains a block that closes the open <p>".into());
            }
            if P_SCOPE.contains(a.as_str()) {
                break;
            }
        }
    }
    if s.a && anc.iter().any(|a| a == "a") {
        return Some("contains an <a>, and links do not nest".into());
    }
    if s.form && anc.iter().any(|a| a == "form") {
        return Some("contains a <form>, and forms do not nest".into());
    }
    None
}

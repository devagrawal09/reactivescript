//! The resolved model (spec/11 CP-6, issue #1): what the checker resolved, as facts a lowering or another analysis consumes
//! instead of recognising source spellings. `ref/src/model.ts` defines it; this is the same builder, filled by the same walk,
//! so `ref/crate.ts` diffs the two. Not a stable format: no one outside this crate depends on it yet.
//!
//! A read is of a reactive symbol (a source, an equation, props, a context through `use`) and carries its mode:
//! `tracked` (reactive scope, SC-1), `snapshot` (imperative scope SC-2, `peek` E-5, a seed E-4, a value parameter's
//! argument E-10) or `pre` (C-2), and a `probe` under `latest` / `pending?` (R-9, R-12).

use crate::ast::{Decl, ExprKind, Lit, Markup, MarkupKind, Program};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::LazyLock;

const OUTLINE_LIMIT: usize = 400;
pub fn outline_block(tag: &str) -> bool {
    matches!(tag, "address" | "article" | "aside" | "blockquote" | "dd" | "details" | "dialog" | "div" | "dl" | "dt" | "fieldset" | "figcaption" | "figure" | "footer" | "form" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "header" | "hgroup" | "hr" | "li" | "main" | "menu" | "nav" | "ol" | "p" | "pre" | "section" | "summary" | "table" | "tbody" | "td" | "th" | "thead" | "tfoot" | "tr" | "ul")
}
pub fn outline_hidden(tag: &str) -> bool { matches!(tag, "style" | "script") }
fn outline_text(s: &str) -> String {
    // Decode only terminated entities, matching the reference's strict mode.
    static ENTITY: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);").unwrap());
    static SPACE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"[\t\n\r\x0c \u{a0}]+").unwrap());
    let text = ENTITY.replace_all(s, |m: &regex::Captures| htmlize::unescape_attribute(&m[0]).into_owned());
    SPACE.replace_all(&text, " ").into_owned()
}

#[derive(Debug, Clone)]
pub enum OutlinePart {
    Text(String),
    Attr(String, String),
    Site(usize),
    Region(usize),
    Br,
}

/// A module's key part: its POSIX path relative to `root` (the project root), or the path as the loader has it.
pub fn module_key(path: &str, root: Option<&str>) -> String {
    let p = path.replace('\\', "/");
    let Some(root) = root.filter(|r| !r.is_empty()) else { return p };
    let r = format!("{}/", root.replace('\\', "/").trim_end_matches('/'));
    match p.strip_prefix(&r) {
        Some(rest) => rest.to_string(),
        None => p,
    }
}

/// A declaration's stable identity, `<module>|<scope>|<name>[#n]` (dev builds name its Solid nodes `rx:` + key): the
/// scope is the enclosing component's name ("" at module level); `#n` marks the n+1th declaration of the same scope and
/// name in the module, in source order. Sources, equations and actions get one (a wrapped server fn too, though
/// it binds no node and the model gives it none). `ref/src/model.ts` `declKeys`.
pub fn decl_keys(p: &Program, module: &str) -> HashMap<*const Decl, String> {
    struct Found {
        d: *const Decl,
        at: String,
        line: usize,
    }
    fn decls(ds: &[Decl], scope: &str, out: &mut Vec<Found>) {
        for d in ds {
            match d {
                Decl::Source { name, line, .. } | Decl::Eq { name, line, .. } | Decl::Action { name, line, .. } => out.push(Found { d: d as *const Decl, at: format!("{scope}|{name}"), line: *line }),
                Decl::Fn { decls: fd, .. } => decls(fd, scope, out),
                Decl::Component { name, decls: cd, view, .. } => {
                    decls(cd, name, out);
                    markup(view, name, out);
                }
                _ => {}
            }
        }
    }
    fn markup(ms: &[Markup], scope: &str, out: &mut Vec<Found>) {
        for m in ms {
            match &m.kind {
                MarkupKind::El { children, .. } => markup(children, scope, out),
                MarkupKind::Mif { t, t_decls, f, f_decls, .. } => {
                    decls(t_decls, scope, out);
                    markup(t, scope, out);
                    decls(f_decls, scope, out);
                    markup(f, scope, out);
                }
                MarkupKind::Mfor { decls: md, body, .. } => {
                    decls(md, scope, out);
                    markup(body, scope, out);
                }
                MarkupKind::Loading { fallback, decls: md, body, .. } | MarkupKind::Errored { fallback, decls: md, body, .. } => {
                    markup(fallback, scope, out);
                    decls(md, scope, out);
                    markup(body, scope, out);
                }
                MarkupKind::Portal { decls: md, body, .. } => {
                    decls(md, scope, out);
                    markup(body, scope, out);
                }
                _ => {}
            }
        }
    }
    let mut found = vec![];
    decls(&p.decls, "", &mut found);
    markup(&p.view, "", &mut found);
    found.sort_by_key(|f| f.line); // stable, as ref's sort
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut keys = HashMap::new();
    for f in found {
        let n = seen.entry(f.at.clone()).or_insert(0);
        keys.insert(f.d, if *n > 0 { format!("{module}|{}#{n}", f.at) } else { format!("{module}|{}", f.at) });
        *n += 1;
    }
    keys
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadMode {
    Tracked,
    Snapshot,
    Pre,
}
impl ReadMode {
    fn as_str(self) -> &'static str {
        match self {
            ReadMode::Tracked => "tracked",
            ReadMode::Snapshot => "snapshot",
            ReadMode::Pre => "pre",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Read {
    pub sym: usize,
    pub mode: ReadMode,
    pub field: Option<String>,
    pub probe: Option<&'static str>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Write {
    pub sym: usize,
    pub op: &'static str,
    pub path: bool,
    pub field: Option<String>,
}
#[derive(Debug, Clone)]
pub struct ModelRegion {
    pub id: usize,
    pub kind: &'static str,
    pub parent: Option<usize>,
    pub name: Option<String>,
    outline: Vec<(OutlinePart, Option<usize>)>,
    clipped: bool,
    /// R-f-4: the inner catch-all that wraps this typed `errored` region's children
    pub shadowed: Option<usize>,
}
#[derive(Debug, Clone)]
pub struct ModelSymbol {
    pub name: String,
    pub kind: &'static str,
    pub region: usize,
    pub line: i64,
    pub question: Option<bool>,
    pub io: bool,
    pub from: Option<String>,
    /// a source's or an equation's identity (`decl_keys`)
    pub key: Option<String>,
    /// MO-11f: a JS import's declaration — `{line, from, origin, helpers}`
    pub decl: Option<Value>,
}
#[derive(Debug, Clone)]
pub struct Computation {
    pub id: usize,
    pub kind: &'static str,
    pub region: usize,
    pub line: i64,
    pub name: Option<String>,
    pub at: Option<String>,
    pub r#in: Option<usize>,
    pub reads: Vec<Read>,
    pub writes: Vec<Write>,
    pub calls: Vec<usize>,
    /// an action's own catches (`try … catch`, `await … catch`) in source order: the classes each handles, `None` for a
    /// catch-all. Only on an action's computation, emitted when non-empty (`ref/src/model.ts` `ActionCatch`).
    pub catches: Vec<Option<Vec<String>>>,
}

/// Filled by the checker during its walk: symbols as they are bound (by the checker's own symbol index), computations as
/// the walk enters them.
#[derive(Default)]
pub struct ModelBuilder {
    pub regions: Vec<ModelRegion>,
    /// checker symbol index → model id
    ids: std::collections::HashMap<usize, usize>,
    order: Vec<usize>,
    pub computations: Vec<Computation>,
    cur: Option<usize>,
    pub snap: usize,
    pub probe: Option<&'static str>,
    pub hide_outline: usize,
}

const READ_KINDS: &[&str] = &["source", "eq", "props", "context"];
const CALL_KINDS: &[&str] = &["fn", "action", "server", "import"];

impl ModelBuilder {
    /// R-f-4: a typed `errored` region whose children an inner catch-all wraps. `by` is that catch-all's region.
    pub fn shadow(&mut self, id: usize, by: usize) {
        if let Some(r) = self.regions.iter_mut().find(|r| r.id == id) {
            r.shadowed = Some(by);
        }
    }
    pub fn region(&mut self, id: usize, kind: &'static str, parent: Option<usize>, name: Option<String>) {
        self.regions.push(ModelRegion { id, kind, parent, name, outline: vec![], clipped: false, shadowed: None });
    }
    pub fn outline(&mut self, region: usize, mut part: OutlinePart, line: Option<usize>) {
        use OutlinePart::*;
        let r = &mut self.regions[region];
        if self.hide_outline != 0 || r.clipped { return; }
        let out = &mut r.outline;
        match &mut part {
            Br => {
                if let Some((Text(text), _)) = out.last_mut() {
                    if text.ends_with(' ') { text.pop(); }
                    if text.is_empty() { out.pop(); }
                }
                if out.last().is_none_or(|(prev, _)| matches!(prev, Br)) { return; }
            }
            Text(text) => {
                *text = outline_text(text);
                if out.last().is_none_or(|(prev, _)| matches!(prev, Br)) && text.starts_with(' ') { text.remove(0); }
                if text.is_empty() { return; }
                if let Some((Text(prev), _)) = out.last_mut() {
                    if prev.ends_with(' ') && text.starts_with(' ') { text.remove(0); }
                    prev.push_str(text);
                    return;
                }
            }
            _ => {}
        }
        if out.len() >= OUTLINE_LIMIT && !matches!(part, Br) {
            out.truncate(OUTLINE_LIMIT);
            r.clipped = true;
            out.push((Text("…".into()), None));
        } else { out.push((part, line)); }
    }
    pub fn view_attr(&mut self, region: usize, attr: &str, e: &ExprKind, line: usize) {
        if self.hide_outline != 0 { return; }
        if let ExprKind::Lit(lit) = e {
            if !matches!(attr, "placeholder" | "title" | "alt" | "aria-label" | "value") { return; }
            let text = match lit {
                Lit::Str(s) => outline_text(s),
                Lit::Num(n) => if *n == 0.0 { "0".into() } else { dragonbox_ecma::Buffer::new().format(*n).into() },
                _ => return,
            };
            let text = text.trim_matches(' ');
            if !text.is_empty() { self.outline(region, OutlinePart::Attr(attr.into(), text.into()), Some(line)); }
        } else {
            self.outline(region, OutlinePart::Site(self.computations.len()), Some(line));
        }
    }
    /// A symbol bound (`kind` "value" is not one).
    pub fn sym(&mut self, index: usize, kind: &str) {
        if kind == "value" || self.ids.contains_key(&index) {
            return;
        }
        self.ids.insert(index, self.order.len());
        self.order.push(index);
    }
    pub fn within(&mut self, kind: &'static str, region: usize, line: i64, name: Option<String>, at: Option<String>) -> (Option<usize>, usize, Option<&'static str>) {
        let c = Computation { id: self.computations.len(), kind, region, line, name, at, r#in: self.cur, reads: vec![], writes: vec![], calls: vec![], catches: vec![] };
        let saved = (self.cur, self.snap, self.probe);
        self.cur = Some(c.id);
        self.computations.push(c);
        self.snap = 0;
        self.probe = None;
        saved
    }
    pub fn leave(&mut self, saved: (Option<usize>, usize, Option<&'static str>)) {
        (self.cur, self.snap, self.probe) = saved;
    }
    pub fn read(&mut self, index: usize, kind: &str, imperative: bool, pre: bool, field: Option<&str>) {
        let (Some(cur), Some(&id)) = (self.cur, self.ids.get(&index)) else { return };
        if !READ_KINDS.contains(&kind) {
            return;
        }
        let mode = if pre {
            ReadMode::Pre
        } else if imperative || self.snap > 0 {
            ReadMode::Snapshot
        } else {
            ReadMode::Tracked
        };
        let r = Read { sym: id, mode, field: field.map(String::from), probe: self.probe };
        let c = &mut self.computations[cur];
        if !c.reads.contains(&r) {
            c.reads.push(r);
        }
    }
    pub fn write(&mut self, index: Option<usize>, op: &'static str, path: bool, field: Option<&str>) {
        let (Some(cur), Some(index)) = (self.cur, index) else { return };
        let Some(&id) = self.ids.get(&index) else { return };
        let w = Write { sym: id, op, path, field: field.filter(|s| !s.is_empty()).map(String::from) };
        let c = &mut self.computations[cur];
        if !c.writes.contains(&w) {
            c.writes.push(w);
        }
    }
    /// An action's own catch: recorded on the action's computation, only there.
    pub fn catch(&mut self, classes: Option<&Vec<String>>) {
        let Some(cur) = self.cur else { return };
        let c = &mut self.computations[cur];
        if c.kind == "action" {
            c.catches.push(classes.cloned());
        }
    }
    pub fn call(&mut self, index: Option<usize>, kind: &str) {
        let (Some(cur), Some(index)) = (self.cur, index) else { return };
        let Some(&id) = self.ids.get(&index) else { return };
        if !CALL_KINDS.contains(&kind) {
            return;
        }
        let c = &mut self.computations[cur];
        if !c.calls.contains(&id) {
            c.calls.push(id);
        }
    }
    /// The model, given each recorded symbol as the checker ends with it.
    pub fn build(&self, file: &str, sym: impl Fn(usize) -> ModelSymbol) -> Value {
        let regions: Vec<Value> = self
            .regions
            .iter()
            .map(|r| {
                let mut m = Map::new();
                m.insert("id".into(), json!(r.id));
                m.insert("kind".into(), json!(r.kind));
                if let Some(p) = r.parent {
                    m.insert("parent".into(), json!(p));
                }
                if let Some(n) = &r.name {
                    m.insert("name".into(), json!(n));
                }
                if let Some(by) = r.shadowed {
                    m.insert("deadTyped".into(), json!(true));
                    m.insert("shadowed".into(), json!(by));
                }
                let mut outline = r.outline.as_slice();
                while let Some((part, _)) = outline.last() {
                    if matches!(part, OutlinePart::Br) || matches!(part, OutlinePart::Text(t) if t == " ") {
                        outline = &outline[..outline.len() - 1];
                    } else { break; }
                }
                m.insert("outline".into(), Value::Array(outline.iter().enumerate().map(|(i, (part, line))| {
                    let mut value = match part {
                        OutlinePart::Text(t) => json!({"text": if i + 1 == outline.len() { t.trim_end_matches(' ') } else { t.as_str() }}),
                        OutlinePart::Attr(attr, text) => json!({"attr": attr, "text": text}),
                        OutlinePart::Site(site) => json!({"site": site}),
                        OutlinePart::Region(region) => json!({"region": region}),
                        OutlinePart::Br => json!({"br": true}),
                    };
                    if let Some(line) = line { value["line"] = json!(line); }
                    value
                }).collect()));
                Value::Object(m)
            })
            .collect();
        let symbols: Vec<Value> = self
            .order
            .iter()
            .enumerate()
            .map(|(id, &index)| {
                let s = sym(index);
                let mut m = Map::new();
                m.insert("id".into(), json!(id));
                m.insert("name".into(), json!(s.name));
                m.insert("kind".into(), json!(s.kind));
                m.insert("region".into(), json!(s.region));
                m.insert("line".into(), json!(s.line));
                if let Some(q) = s.question {
                    m.insert("question".into(), json!(q));
                }
                if s.io {
                    m.insert("io".into(), json!(true));
                }
                if let Some(f) = s.from {
                    m.insert("from".into(), json!(f));
                }
                if let Some(k) = s.key {
                    m.insert("key".into(), json!(k));
                }
                if let Some(d) = s.decl {
                    m.insert("decl".into(), d);
                }
                Value::Object(m)
            })
            .collect();
        let comps: Vec<Value> = self
            .computations
            .iter()
            .map(|c| {
                let mut m = Map::new();
                m.insert("id".into(), json!(c.id));
                m.insert("kind".into(), json!(c.kind));
                m.insert("region".into(), json!(c.region));
                m.insert("line".into(), json!(c.line));
                if let Some(n) = &c.name {
                    m.insert("name".into(), json!(n));
                }
                if let Some(a) = &c.at {
                    m.insert("at".into(), json!(a));
                }
                if let Some(i) = c.r#in {
                    m.insert("in".into(), json!(i));
                }
                m.insert(
                    "reads".into(),
                    Value::Array(
                        c.reads
                            .iter()
                            .map(|r| {
                                let mut o = Map::new();
                                o.insert("sym".into(), json!(r.sym));
                                o.insert("mode".into(), json!(r.mode.as_str()));
                                if let Some(f) = &r.field {
                                    o.insert("field".into(), json!(f));
                                }
                                if let Some(p) = r.probe {
                                    o.insert("probe".into(), json!(p));
                                }
                                Value::Object(o)
                            })
                            .collect(),
                    ),
                );
                m.insert(
                    "writes".into(),
                    Value::Array(
                        c.writes
                            .iter()
                            .map(|w| {
                                let mut o = Map::new();
                                o.insert("sym".into(), json!(w.sym));
                                o.insert("op".into(), json!(w.op));
                                if w.path {
                                    o.insert("path".into(), json!(true));
                                }
                                if let Some(field) = &w.field {
                                    o.insert("field".into(), json!(field));
                                }
                                Value::Object(o)
                            })
                            .collect(),
                    ),
                );
                m.insert("calls".into(), json!(c.calls));
                if !c.catches.is_empty() {
                    m.insert("catches".into(), Value::Array(c.catches.iter().map(|k| json!({ "classes": k })).collect()));
                }
                Value::Object(m)
            })
            .collect();
        json!({ "file": file, "regions": regions, "symbols": symbols, "computations": comps })
    }
}

//! TY-1 (spec/13), ported from `ref/types/project.ts`: a checked program projected to TSX that TypeScript checks, and that an
//! editor asks for types (TY-1c). The projection is the reference's, text for text (`ref/crate.ts --project` diffs them);
//! what the crate adds is where each piece came from (CP-8): every name, member, literal and written type the projection
//! copies from the `.rx` is a mapping, generated offset to source offset, of text that is the same on both sides.

use crate::ast::*;
use crate::modules::ModuleSet;
use crate::parse::JsDecl;
use crate::signature::{ExportSig, ModSig};
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

/// The helpers every projection imports (`__`), and the prelude's names (`len`, `map`, …): `ref/types/project.ts`'s PRELUDE.
pub const PRELUDE: &str = include_str!("prelude.ts");

static ROW_WORDS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^((?:io|pending|lane|fails\([^)]*\))\s+)+").unwrap());
static SOURCE_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^source\s+").unwrap());
const BUILTINS: [&str; 13] = ["len", "str", "map", "filter", "sum", "fail", "fetch", "every", "indexOf", "log", "until", "onSettled", "onFlush"];
fn builtin(n: &str) -> bool {
    BUILTINS.contains(&n)
}

/// One mapping: `len` bytes at `gen` in the projection are the same text as `len` bytes at `src` in the `.rx`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mapping {
    pub gen: u32,
    pub src: u32,
    pub len: u32,
}

/// A coarser correspondence: `glen` bytes at `gen` in the projection were written for the `len` bytes at `src` (an
/// expression, a statement, a declaration's line), not the same text. An editor maps through it what falls between
/// mappings (a type error on `(a + b)` starts at its parenthesis); it is listed innermost first.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Range {
    pub gen: u32,
    pub glen: u32,
    pub src: u32,
    pub len: u32,
}

/// Text with the mappings of the pieces in it that came from the source.
#[derive(Default, Clone)]
struct Code {
    s: String,
    m: Vec<Mapping>,
    r: Vec<Range>,
}
impl Code {
    fn new() -> Self {
        Code::default()
    }
    fn of(s: &str) -> Self {
        Code { s: s.to_string(), m: vec![], r: vec![] }
    }
    /// All of this text was written for `sp`.
    fn from(mut self, sp: Span) -> Self {
        if !sp.is_none() {
            self.r.push(Range { gen: 0, glen: self.s.len() as u32, src: sp.start, len: sp.end - sp.start });
        }
        self
    }
    fn t(mut self, s: &str) -> Self {
        self.s.push_str(s);
        self
    }
    fn c(mut self, o: Code) -> Self {
        self.push(o);
        self
    }
    fn push(&mut self, o: Code) {
        let at = self.s.len() as u32;
        self.m.extend(o.m.into_iter().map(|m| Mapping { gen: m.gen + at, ..m }));
        self.r.extend(o.r.into_iter().map(|r| Range { gen: r.gen + at, ..r }));
        self.s.push_str(&o.s);
    }
    /// `text`, mapped to `src` when it was found there.
    fn at(mut self, text: &str, src: Option<usize>) -> Self {
        if let Some(src) = src {
            self.m.push(Mapping { gen: self.s.len() as u32, src: src as u32, len: text.len() as u32 });
        }
        self.s.push_str(text);
        self
    }
    fn join(xs: Vec<Code>, sep: &str) -> Code {
        let mut out = Code::new();
        for (i, x) in xs.into_iter().enumerate() {
            if i > 0 {
                out.s.push_str(sep);
            }
            out.push(x);
        }
        out
    }
}

/// The reference's `W`: lines, each with the `.rx` line it came from.
#[derive(Default)]
struct W {
    buf: Code,
    lines: Vec<usize>,
    last: usize,
}
impl W {
    fn new() -> Self {
        W { buf: Code::new(), lines: vec![], last: 1 }
    }
    /// A statement or a markup item carries no line of its own (0): it is on its declaration's.
    fn emit(&mut self, text: Code, line: usize) {
        if line != 0 {
            self.last = line;
        }
        let n = text.s.matches('\n').count() + 1;
        if !self.lines.is_empty() {
            self.buf.s.push('\n');
        }
        self.buf.push(text);
        for _ in 0..n {
            self.lines.push(if line != 0 { line } else { self.last });
        }
    }
}

/// One projected file: its TSX, for each of its lines the `.rx` line it came from, and its mappings onto the `.rx`.
pub struct Projected {
    pub path: String,
    pub code: String,
    pub lines: Vec<usize>,
    pub rx: String,
    pub mappings: Vec<Mapping>,
    pub ranges: Vec<Range>,
}

/// A written type, without its row words (`pending T` → `T`, 04 CN-4a) or a context's `source` (RG-7c).
fn type_text(t: &Option<String>) -> Option<String> {
    let t = t.as_ref()?;
    let x = ROW_WORDS.replace(t, "");
    let x = SOURCE_WORD.replace(&x, "");
    let x = crate::parse::js_trim(&x);
    if x.is_empty() {
        None
    } else {
        Some(x.to_string())
    }
}
/// `JSON.stringify` of a literal.
fn j(l: &Lit) -> String {
    match crate::ast::lit_json(l) {
        None => "undefined".into(),
        Some(v) => serde_json::to_string(&v).unwrap(),
    }
}
fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}
/// The namespace a `.d.rx` is declared as. Same spelling as `ref/types/project.ts`.
fn ns_name(declared: &str) -> String {
    let mut s = String::from("__D_");
    for c in declared.chars() {
        s.push(if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' });
    }
    s
}
fn is_handler(a: &str) -> bool {
    crate::awaits::is_handler(a)
}
fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// The file a module projects to: `main.rx` → `main.rx.tsx`, so `import … from "./lib.rx"` resolves to the projection.
pub fn projected_path(rx: &str) -> String {
    format!("{rx}.tsx")
}

pub fn project_modules(set: &ModuleSet) -> Vec<Projected> {
    project_modules_with(set, None)
}
/// Cheap preflight: only a `_` arm needs the checker. False positives (a
/// comment or an ordinary arrow) just make us check a little sooner.
fn may_have_default_arm(src: &str) -> bool {
    src.match_indices('_').any(|(at, _)| {
        if src[..at].chars().next_back().is_some_and(is_word) { return false; }
        let mut c = crate::parse::Cursor::new(src);
        c.i = at + 1;
        c.ws(true);
        if !c.eat("=>") { return false; }
        c.ws(true);
        c.eat("{")
    })
}

/// `prelude`: where the projections import the prelude from, in place of `__prelude.ts` at the program's root (an editor
/// writes it once, where the project's own `@solidjs/web` resolves).
pub fn project_modules_with(set: &ModuleSet, prelude: Option<&str>) -> Vec<Projected> {
    let mut out = vec![];
    let mut js_stubs: IndexMap<String, IndexSet<String>> = IndexMap::new();
    let arm_types = if set.sources.values().any(|src| may_have_default_arm(src)) {
        crate::check::check_modules(set, false).arm_types
    } else {
        HashMap::new()
    };
    for path in &set.order {
        let p = &set.programs[path];
        let src = set.sources.get(path).map(|s| s.as_str()).unwrap_or("");
        let mut pr = Proj { w: W::new(), set, path, src, js_stubs: &mut js_stubs, used: IndexSet::new(), declared: HashSet::new(), slots: HashSet::new(), snap: HashSet::new(), rename: HashMap::new(), ambients: HashSet::new(), bridged: HashSet::new(), prelude, arm_types: &arm_types };
        pr.module(p);
        let w = pr.w;
        out.push(Projected { path: projected_path(path), code: w.buf.s, lines: w.lines, rx: path.clone(), mappings: w.buf.m, ranges: w.buf.r });
    }
    for (rx, sig) in &set.signatures {
        out.push(Projected { path: format!("{rx}.d.ts"), code: signature_stub(sig), lines: vec![], rx: rx.strip_suffix(".rx").map(|s| format!("{s}.d.rx")).unwrap_or(rx.clone()), mappings: vec![], ranges: vec![] });
    }
    for (dts, decls) in &set.declarations {
        // a generated declaration's module is the TS module itself (TY-4b)
        if decls.iter().any(is_gen) {
            continue;
        }
        let path = dts.strip_suffix(".d.rx").map(|s| format!("{s}.d.ts")).unwrap_or(dts.clone());
        out.push(Projected { path, code: declaration_module(dts, decls, set), lines: vec![], rx: dts.clone(), mappings: vec![], ranges: vec![] });
    }
    for (m, names) in js_stubs {
        let code = names.iter().map(|n| if n == "default" { "declare const __d: any; export default __d;".to_string() } else { format!("export declare const {n}: any;") }).collect::<Vec<_>>().join("\n");
        out.push(Projected { path: m.clone(), code, lines: vec![], rx: m, mappings: vec![], ranges: vec![] });
    }
    out
}

/// Mappings whose two sides are not the same text: none, when the projection keeps its promise (CP-8).
pub fn unverified(p: &Projected, src: &str) -> Vec<Mapping> {
    p.mappings
        .iter()
        .filter(|m| {
            let g = p.code.get(m.gen as usize..(m.gen + m.len) as usize);
            let s = src.get(m.src as usize..(m.src + m.len) as usize);
            g.is_none() || g != s
        })
        .copied()
        .collect()
}

/// TY-4c: an `.rx` module read by its signature (MO-9) is typed by the `.d.ts` TypeScript emits from its projection (TY-1c);
/// none is shipped here, so its exports are `any`.
fn signature_stub(sig: &ModSig) -> String {
    sig.exports
        .iter()
        .map(|(n, x)| match x {
            ExportSig::Type => format!("export type {n} = any;"),
            ExportSig::Comp { .. } => format!("export declare function {n}(props: any): any;"),
            _ => format!("export declare const {n}: any;"),
        })
        .collect::<Vec<_>>()
        .join("\n")
}
/// A module-level alias of an imported type, so a declare namespace can name it without importing the sibling `.ts`.
fn bridge_name(path: &str, name: &str) -> String {
    let mut s = String::from("__T_");
    for c in path.chars() {
        s.push(if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' });
    }
    s.push('_');
    s.push_str(name);
    s
}
/// A path from `from_file`'s directory to `to_file`, for an `import type` of an `.rx` projection.
fn rel_module(from_file: &str, to_file: &str) -> String {
    let from: Vec<&str> = from_file.split('/').collect();
    let from = if from.is_empty() { &from[..] } else { &from[..from.len() - 1] };
    let to: Vec<&str> = to_file.split('/').collect();
    let mut i = 0;
    while i < from.len() && i + 1 < to.len() && from[i] == to[i] {
        i += 1;
    }
    let mut rel = "../".repeat(from.len() - i) + &to[i..].join("/");
    if !rel.starts_with('.') {
        rel = format!("./{rel}");
    }
    rel
}
/// MO-8: a `.d.rx` as TypeScript's `.d.ts` for the same JS module. An import is a local alias of its bridge (MO-8e).
fn declaration_file(decls: &[JsDecl]) -> String {
    decls
        .iter()
        .map(|d| match d {
            JsDecl::Import { names, target, .. } => names.iter().map(|n| format!("type {} = {};", n.alias, target.as_ref().map(|t| bridge_name(t, &n.name)).unwrap_or_else(|| "any".into()))).collect::<Vec<_>>().join("\n"),
            JsDecl::Type { text, exported, .. } => format!("{}{text}", if *exported { "export " } else { "" }),
            JsDecl::Error { name, .. } => format!("export declare class {name}$ extends Error {{}}\nexport declare const {name}: (message?: string) => {name}$;\nexport type {name} = {name}$;"),
            JsDecl::Const { name, ty, .. } => format!("export declare const {name}: {};", ty.as_deref().unwrap_or("any")),
            JsDecl::Fn { name, params, generics, ptypes, ret, .. } => {
                let ps = params.iter().enumerate().map(|(i, n)| match ptypes.get(i).and_then(|t| t.as_ref()) {
                    Some(t) => format!("{n}: {t}"),
                    None => n.clone(),
                });
                format!("export declare function {name}{}({}): {};", generics.as_deref().unwrap_or(""), ps.collect::<Vec<_>>().join(", "), ret.as_deref().unwrap_or("any"))
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}
fn ns_block(dts: &str, decls: &[JsDecl]) -> String {
    let body = declaration_file(decls).trim_end().replace("export declare ", "export ").lines().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n");
    format!("declare namespace {} {{\n{body}\n}}", ns_name(dts))
}
/// MO-11: a line generated from the TS module (its types are TypeScript's, TY-4b).
fn is_gen(d: &JsDecl) -> bool {
    d.generated().is_some()
}
fn stem_of(dts: &str) -> &str {
    dts.strip_suffix(".d.rx").unwrap_or(dts)
}
/// The written lines' namespace of a declaration with generated lines; `extra`: the bridges of the generated types.
fn ns_block_in(dts: &str, decls: &[JsDecl], extra: &[String], ind: &str) -> String {
    let written: Vec<JsDecl> = decls.iter().filter(|d| !is_gen(d)).cloned().collect();
    let mut parts = vec![declaration_file(&written).trim_end().to_string()];
    parts.extend(extra.iter().cloned());
    let text = parts.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n");
    let body = text.replace("export declare ", "export ").split('\n').map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n");
    format!("{ind}declare namespace {} {{\n{body}\n{ind}}}", ns_name(dts))
}
/// `<A, B extends X = Y>` → `<A, B>`: a type's parameters, passed through an alias.
fn type_args(generics: &str) -> String {
    let inner = generics.strip_prefix('<').and_then(|s| s.strip_suffix('>')).unwrap_or(generics);
    let names: Vec<String> = split_top(inner, ',')
        .iter()
        .map(|p| {
            let m: String = p.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$').collect();
            if m.is_empty() || m.chars().next().is_some_and(|c| c.is_ascii_digit()) { "any".to_string() } else { m }
        })
        .collect();
    format!("<{}>", names.join(", "))
}
fn split_top(s: &str, sep: char) -> Vec<String> {
    let cs: Vec<char> = s.chars().collect();
    let (mut out, mut depth, mut from) = (vec![], 0i64, 0usize);
    for i in 0..cs.len() {
        let ch = cs[i];
        if "([{<".contains(ch) {
            depth += 1;
        } else if ")]}>".contains(ch) && !(ch == '>' && i > 0 && cs[i - 1] == '=') {
            depth -= 1;
        } else if depth == 0 && ch == sep {
            out.push(cs[from..i].iter().collect::<String>());
            from = i + 1;
        }
    }
    out.push(cs[from..].iter().collect::<String>());
    out.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}
/// TY-4d: a primitive's result shape as `__.ReadResult` takes it.
fn shape_type(s: &crate::parse::Shape) -> String {
    use crate::parse::{Part, Shape};
    let part = |p: &Part| if *p == Part::Ref { "\"ref\"" } else { "\"value\"" };
    match s {
        Shape::Part(p) => part(p).to_string(),
        Shape::Items(xs) => format!("[{}]", xs.iter().map(part).collect::<Vec<_>>().join(", ")),
        Shape::Fields(fs) => format!("{{ {} }}", fs.iter().map(|(k, p)| format!("{}: {}", js_str(k), part(p))).collect::<Vec<_>>().join("; ")),
    }
}
/// TY-4b: each generated type and error class of a declaration, which its written lines may name, bridged to TypeScript's: a
/// module-level `import type` of it, and an alias in the namespace.
fn gen_bridges(dts: &str, decls: &[JsDecl], from_file: &str, bridged: &mut HashSet<String>) -> (String, Vec<String>) {
    let (mut pre, mut body) = (String::new(), vec![]);
    for d in decls {
        if !is_gen(d) || !matches!(d, JsDecl::Type { .. } | JsDecl::Error { .. }) {
            continue;
        }
        let name = d.name();
        let b = bridge_name(&ns_name(dts), name);
        if bridged.insert(b.clone()) {
            pre.push_str(&format!("import type {{ {name} as {b} }} from {};\n", js_str(&rel_module(from_file, stem_of(dts)))));
        }
        let gs = if let JsDecl::Type { generics: Some(g), .. } = d { Some(g.as_str()) } else { None };
        body.push(format!("export type {name}{} = {b}{};", gs.unwrap_or(""), gs.map(type_args).unwrap_or_default()));
    }
    (pre, body)
}
/// Dependency namespaces and the bridges this file's type imports name. `seen` holds `.d.rx` paths already emitted.
fn decl_preamble(decls: &[JsDecl], set: &ModuleSet, from_file: &str, seen: &mut HashSet<String>, bridged: &mut HashSet<String>) -> String {
    let mut out = String::new();
    for d in decls {
        let JsDecl::Import { names, target: Some(target), rx, .. } = d else { continue };
        if !rx {
            out.push_str(&dep_text(target, set, from_file, seen, bridged));
        }
        let td = if *rx { None } else { set.declarations.get(target) };
        for n in names {
            let b = bridge_name(target, &n.name);
            if !bridged.insert(b.clone()) {
                continue;
            }
            // MO-8e: a TS module's type, TypeScript's
            let gen = td.is_some_and(|td| td.iter().any(|y| is_gen(y) && y.name() == n.name));
            if *rx {
                out.push_str(&format!("import type {{ {} as {b} }} from {};\n", n.name, js_str(&rel_module(from_file, target))));
            } else if gen {
                out.push_str(&format!("import type {{ {} as {b} }} from {};\n", n.name, js_str(&rel_module(from_file, stem_of(target)))));
            } else {
                out.push_str(&format!("type {b} = {}.{};\n", ns_name(target), n.name));
            }
        }
    }
    out
}
fn dep_text(target: &str, set: &ModuleSet, from_file: &str, seen: &mut HashSet<String>, bridged: &mut HashSet<String>) -> String {
    if !seen.insert(target.to_string()) {
        return String::new();
    }
    let Some(decls) = set.declarations.get(target) else { return String::new() };
    if !decls.iter().any(is_gen) {
        return format!("{}{}\n", decl_preamble(decls, set, from_file, seen, bridged), ns_block(target, decls));
    }
    let written: Vec<JsDecl> = decls.iter().filter(|d| !is_gen(d)).cloned().collect();
    let pre = decl_preamble(&written, set, from_file, seen, bridged);
    if !written.iter().any(|d| !matches!(d, JsDecl::Import { .. })) {
        // all generated: no namespace, TypeScript has it
        return pre;
    }
    let (gpre, gbody) = gen_bridges(target, decls, from_file, bridged);
    format!("{pre}{gpre}{}\n", ns_block_in(target, decls, &gbody, ""))
}
/// The standalone `.d.ts`: a file with no type import is `declaration_file`, unchanged.
fn declaration_module(dts: &str, decls: &[JsDecl], set: &ModuleSet) -> String {
    if !decls.iter().any(|d| matches!(d, JsDecl::Import { .. })) {
        return declaration_file(decls);
    }
    let mut seen = HashSet::new();
    seen.insert(dts.to_string());
    let mut bridged = HashSet::new();
    format!("{}{}", decl_preamble(decls, set, dts, &mut seen, &mut bridged), declaration_file(decls))
}

/// `JSON.stringify(stmts).includes('"k":"await"')`: an `await` anywhere in them, closures included.
fn has_await(ss: &[Stmt]) -> bool {
    stmts_json(ss).to_string().contains("\"k\":\"await\"")
}
/// The names an expression reads, in the order the reference's walk meets them; a `pre` reads the previous instant, so
/// nothing under it orders.
fn free_ids(e: &Expr) -> IndexSet<String> {
    fn go(v: &Value, out: &mut IndexSet<String>) {
        match v {
            Value::Array(xs) => xs.iter().for_each(|x| go(x, out)),
            Value::Object(o) => {
                if o.get("k").and_then(|k| k.as_str()) == Some("id") {
                    if let Some(n) = o.get("name").and_then(|n| n.as_str()) {
                        out.insert(n.to_string());
                    }
                }
                if o.get("k").and_then(|k| k.as_str()) == Some("pre") {
                    return;
                }
                for (k, x) in o {
                    if k != "k" {
                        go(x, out);
                    }
                }
            }
            _ => {}
        }
    }
    let mut out = IndexSet::new();
    go(&e.to_json(), &mut out);
    out
}

struct Proj<'a> {
    w: W,
    set: &'a ModuleSet,
    path: &'a str,
    src: &'a str,
    js_stubs: &'a mut IndexMap<String, IndexSet<String>>,
    /// prelude names the module reads
    used: IndexSet<String>,
    /// names the module declares (they shadow the prelude)
    declared: HashSet<String>,
    /// sources and equations: a write checks this type, not a branch's narrowing (TY-2)
    slots: HashSet<String>,
    /// a handler read is a fresh snapshot of this name's type (TY-2)
    snap: HashSet<String>,
    /// inside a handler, a snap name reads as its snapshot binding
    rename: HashMap<String, String>,
    /// a JS module's `.d.rx`, emitted once as the types the import is checked against (TY-4b)
    ambients: HashSet<String>,
    /// MO-8e: a type bridge already emitted in this projection
    bridged: HashSet<String>,
    prelude: Option<&'a str>,
    arm_types: &'a HashMap<usize, Vec<String>>,
}

impl Proj<'_> {
    /// Locate the class in the arm header (not a use of the same class in its body).
    fn arm_type<T>(&self, arm: &ErrorArm<T>, within: Span, from: &mut usize) -> Code {
        let default_type = || {
            self.arm_types.get(&(arm as *const ErrorArm<T> as usize))
                .filter(|cs| !cs.is_empty()).map(|cs| cs.join(" | ")).unwrap_or_else(|| "Error".into())
        };
        let arm_line = self.src.split_inclusive('\n').take(arm.line.saturating_sub(1)).map(str::len).sum();
        *from = (*from).max(arm_line);
        let mut search = *from;
        while let Some(at) = self.find(&arm.cls, within, search) {
            search = at + arm.cls.len();
            let mut c = crate::parse::Cursor::new(self.src);
            c.i = search;
            c.ws(true);
            if c.eat("=>") {
                *from = c.i;
                return match arm.cls.as_str() {
                    "_" => Code::of(&default_type()),
                    "Panic" => Code::of("__.").at("Panic", Some(at)),
                    cls => Code::new().at(cls, Some(at)),
                };
            }
        }
        if arm.cls == "_" { Code::of(&default_type()) }
        else { Code::of(if arm.cls == "Panic" { "__.Panic" } else { &arm.cls }) }
    }

    fn arm_binding<T>(&mut self, name: &str, body: impl FnOnce(&mut Self) -> T) -> T {
        let alias = self.rename.remove(name);
        let snap = self.snap.remove(name);
        let out = body(self);
        if let Some(alias) = alias { self.rename.insert(name.to_string(), alias); }
        if snap { self.snap.insert(name.to_string()); }
        out
    }

    // ---- where a name or a written type is, in the source ----
    /// The first whole-word `word` in `within`, at or after `from`.
    fn find(&self, word: &str, within: Span, from: usize) -> Option<usize> {
        if within.is_none() || word.is_empty() {
            return None;
        }
        let (a, b) = ((within.start as usize).max(from), within.end as usize);
        let hay = self.src.get(a..b)?;
        let wordy = word.starts_with(is_word);
        hay.match_indices(word).find_map(|(i, _)| {
            let before = hay[..i].chars().next_back();
            let after = hay[i + word.len()..].chars().next();
            (!wordy || (!before.is_some_and(is_word) && !after.is_some_and(is_word))).then_some(a + i)
        })
    }
    /// `word` as found in `within` from `*from` on, mapped; `*from` moves past it.
    fn name(&self, word: &str, within: Span, from: &mut usize) -> Code {
        let at = self.find(word, within, *from);
        if let Some(a) = at {
            *from = a + word.len();
        }
        Code::new().at(word, at)
    }
    /// A written type's text (row words dropped), found after `*from`.
    fn ty(&self, t: &str, within: Span, from: &mut usize) -> Code {
        self.name(t, within, from)
    }
    /// `: T`, or nothing.
    fn ann(&self, t: &Option<String>, within: Span, from: &mut usize) -> Code {
        match type_text(t) {
            Some(x) => Code::of(": ").c(self.ty(&x, within, from)),
            None => Code::new(),
        }
    }
    /// `n` or `n: T` for a parameter list of names and their written types (no row words to drop).
    fn params(&self, params: &[String], ptypes: &[Option<String>], within: Span, from: &mut usize) -> Code {
        let ps = params
            .iter()
            .enumerate()
            .map(|(i, n)| {
                let c = self.name(n, within, from);
                match ptypes.get(i).and_then(|t| t.as_ref()) {
                    Some(t) => c.t(": ").c(self.ty(t, within, from)),
                    None => c,
                }
            })
            .collect();
        Code::join(ps, ", ")
    }

    fn module(&mut self, p: &Program) {
        let saved = std::mem::replace(&mut self.w, W::new());
        self.decls(&p.decls, "", true);
        if !p.view.is_empty() {
            self.w.emit(Code::of("export const __view = ("), p.view[0].line.unwrap_or(1));
            self.markup(&p.view, "  ");
            self.w.emit(Code::of(");"), p.view[p.view.len() - 1].line.unwrap_or(1));
        }
        if let Some(Decl::Component { line, .. }) = p.decls.iter().find(|d| matches!(d, Decl::Component { is_default: true, .. })) {
            // CP-4a: what JS imports from an entry
            self.w.emit(Code::of("declare const __main: __.Main; export default __main;"), *line);
        }
        let body = std::mem::replace(&mut self.w, saved);
        let prelude: Vec<String> = self.used.iter().filter(|n| !self.declared.contains(*n)).cloned().collect();
        let types: Vec<&str> = ["View", "Panic"].into_iter().filter(|n| !self.declared.contains(*n)).collect();
        let rel = self.prelude.map(|p| p.to_string()).unwrap_or_else(|| self.rel("__prelude.ts"));
        let mut head = format!("import * as __ from \"{rel}\"; import type {{ {} }} from \"{rel}\";", types.join(", "));
        if !prelude.is_empty() {
            head += &format!(" import {{ {} }} from \"{rel}\";", prelude.join(", "));
        }
        self.w.emit(Code::of(&head), 0);
        if !body.lines.is_empty() {
            self.w.buf.s.push('\n');
            self.w.buf.push(body.buf);
            self.w.lines.extend(body.lines);
        }
    }
    /// A path relative to this module's directory, for the prelude (at the root of the program).
    fn rel(&self, f: &str) -> String {
        let depth = self.path.split('/').count() as i64 - 1 - (self.set.entry.split('/').count() as i64 - 1);
        if depth > 0 {
            "../".repeat(depth as usize) + f
        } else {
            format!("./{f}")
        }
    }

    // ---- declarations, in dependency order (functions are hoisted; values are not) ----
    fn decls(&mut self, ds: &[Decl], ind: &str, top: bool) {
        let ex = |d: &Decl| if top && d.exported() { "export " } else { "" };
        for d in ds {
            if let Some(n) = d.name() {
                self.declared.insert(n.to_string());
            }
            if matches!(d, Decl::Source { .. } | Decl::Eq { .. }) {
                let n = d.name().unwrap().to_string();
                self.slots.insert(n.clone()); // before actions, whose writes name them
                self.snap.insert(n);
            }
        }
        for d in ds {
            let sp = d.span();
            let mut at = sp.start as usize;
            match d {
                Decl::Import { .. } => self.import_decl(d, ind),
                Decl::TypeDecl { text, line, .. } => {
                    let c = Code::of(ind).t(ex(d)).c(self.name(text, sp, &mut at));
                    self.w.emit(c, *line);
                }
                Decl::Error { name, params, ptypes, msg, line, .. } => {
                    let fields = params.iter().enumerate().map(|(i, n)| format!("declare {n}: {};", ptypes.get(i).and_then(|t| t.as_deref()).unwrap_or("any"))).collect::<Vec<_>>().join(" ");
                    let nm = self.name(name, sp, &mut at);
                    let ps = self.params(params, ptypes, sp, &mut at);
                    let body = match msg {
                        Some(m) => Code::of("{ void (").c(self.expr(m, false, None)).t(&format!("); return new {name}$(); }}")),
                        None => Code::of(&format!("new {name}$()")),
                    };
                    let c = Code::of(&format!("{ind}{}class {name}$ extends Error {{ {fields} }}\n{ind}{}const ", ex(d), ex(d)))
                        .c(nm.clone())
                        .t(" = (")
                        .c(ps)
                        .t(&format!("): {name}$ => "))
                        .c(body)
                        .t(&format!(";\n{ind}{}type ", ex(d)))
                        .c(nm)
                        .t(&format!(" = {name}$;"));
                    self.w.emit(c, *line);
                }
                Decl::Context { name, ty, dflt, line, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let t = match type_text(ty) {
                        Some(x) => self.ty(&x, sp, &mut at),
                        None => Code::of("any"),
                    };
                    let dv = dflt.as_ref().map(|e| self.expr(e, false, None)).unwrap_or_default();
                    let c = Code::of(ind).t(ex(d)).t("const ").c(nm).t(" = __.ctx<").c(t).t(">(").c(dv).t(");");
                    self.w.emit(c, *line);
                }
                _ => {}
            }
        }
        for d in ds {
            let sp = d.span();
            let mut at = sp.start as usize;
            match d {
                Decl::Fn { name, params, decls, tail, line, ret, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let ps = Code::join(
                        params
                            .iter()
                            .map(|p| {
                                let n = self.name(&p.name, sp, &mut at);
                                n.c(self.ann(&p.ty, sp, &mut at))
                            })
                            .collect(),
                        ", ",
                    );
                    let r = self.ann(ret, sp, &mut at);
                    let head = Code::of(ind).t(ex(d)).t("function ").c(nm).t("(").c(ps).t(")").c(r);
                    if decls.is_empty() {
                        let t = self.expr(tail, false, None);
                        self.w.emit(head.t(" { return ").c(t).t("; }"), *line);
                        continue;
                    }
                    self.w.emit(head.t(" {"), *line);
                    self.decls(decls, &format!("{ind}  "), false);
                    let t = self.expr(tail, false, None);
                    self.w.emit(Code::of(&format!("{ind}  return ")).c(t).t(&format!(";\n{ind}}}")), *line);
                }
                Decl::Component { name, props, decls, view, line, props_type, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let pn = self.name(props, sp, &mut at);
                    let pt = match props_type {
                        Some(t) => Code::of(": ").c(self.ty(t, sp, &mut at)),
                        None => Code::of(": any"),
                    };
                    self.w.emit(Code::of(ind).t(ex(d)).t("function ").c(nm).t("(").c(pn).c(pt).t(") {"), *line);
                    self.decls(decls, &format!("{ind}  "), false);
                    self.w.emit(Code::of(&format!("{ind}  return (")), *line);
                    self.markup(view, &format!("{ind}    "));
                    self.w.emit(Code::of(&format!("{ind}  );\n{ind}}}")), *line);
                }
                Decl::Action { name, params, ptypes, body, line, .. } | Decl::Server { name, params, ptypes, body, line, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let ps = self.params(params, ptypes, sp, &mut at);
                    let r = match d {
                        Decl::Server { ret: Some(r), .. } => Code::of(": Promise<").c(self.ty(r, sp, &mut at)).t(">"),
                        _ => Code::new(),
                    };
                    self.w.emit(Code::of(ind).t(ex(d)).t("async function ").c(nm).t("(").c(ps).t(")").c(r).t(" {"), *line);
                    self.stmts(body, &format!("{ind}  "));
                    self.w.emit(Code::of(&format!("{ind}}}")), *line);
                    if matches!(d, Decl::Server { .. }) {
                        // SF-6a, statically where the types are known
                        self.w.emit(Code::of(&format!("{ind}__.wire({name}, true);")), *line);
                    }
                }
                _ => {}
            }
        }
        for d in self.order(ds) {
            let sp = d.span();
            let mut at = sp.start as usize;
            match d {
                Decl::Source { name, init, line, ty, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let a = self.ann(ty, sp, &mut at);
                    let v = match type_text(ty) {
                        Some(t) => Code::of(&format!("__.typed<{t}>(")).c(self.expr(init, false, None)).t(")"),
                        None => Code::of("__.src(").c(self.expr(init, false, None)).t(")"),
                    };
                    self.w.emit(Code::of(ind).t(ex(d)).t("const ").c(nm).c(a).t(" = ").c(v).t(";").from(sp), *line);
                    self.w.emit(Code::of(&format!("{ind}type __W_{name} = typeof {name};")), *line);
                }
                Decl::Eq { name, e, line, ty, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let a = self.ann(ty, sp, &mut at);
                    let v = Code::of("__.eq(").c(self.expr(e, false, Some(name))).t(", true)");   // R-1: no promise without `await`
                    self.w.emit(Code::of(ind).t(ex(d)).t("const ").c(nm).c(a).t(" = ").c(v).t(";").from(sp), *line);
                    self.w.emit(Code::of(&format!("{ind}type __W_{name} = typeof {name};")), *line);
                }
                Decl::Provide { name, e, line, .. } => {
                    let nm = self.name(name, sp, &mut at);
                    let v = self.expr(e, false, None);
                    self.w.emit(Code::of(&format!("{ind}__.provide(")).c(nm).t(", ").c(v).t(");"), *line);
                }
                _ => {}
            }
        }
        for d in ds {
            if let Decl::Effect { inputs, body, line, .. } = d {
                self.w.emit(Code::of(&format!("{ind}__.effect(() => {{")), *line);
                for (i, e) in inputs.iter().enumerate() {
                    let v = self.expr(e, false, None);
                    self.w.emit(Code::of(&format!("{ind}  const ${i} = ")).c(v).t(";"), *line);
                }
                self.stmts(body, &format!("{ind}  "));
                self.w.emit(Code::of(&format!("{ind}}});")), *line);
            }
        }
    }

    fn import_decl(&mut self, d: &Decl, ind: &str) {
        let Decl::Import { names, from, line, resolved, declared, .. } = d else { return };
        let sp = d.span();
        let is_prelude = |n: &ImportName| from == "./prelude" && builtin(&n.name);
        for n in names {
            if is_prelude(n) {
                self.declared.remove(&n.alias);
            } else {
                self.declared.insert(n.alias.clone());
            }
        }
        for n in names.iter().filter(|n| is_prelude(n)) {
            self.used.insert(n.name.clone());
        }
        let rest: Vec<&ImportName> = names.iter().filter(|n| !is_prelude(n)).collect();
        if rest.is_empty() {
            return;
        }
        if resolved.is_none() && declared.is_none() {
            // a JS module with no declaration: `any`
            let key = self.mod_path(from) + ".ts";
            let s = self.js_stubs.entry(key).or_default();
            for n in &rest {
                s.insert(n.name.clone());
            }
        }
        if let Some(dts) = declared {
            if let Some(decls) = self.set.declarations.get(dts) {
                // TY-4b: the `.d.rx` is the type, even where a `.ts` sits beside it
                self.declared_import(d, &rest, decls, ind);
                return;
            }
        }
        let mut at = sp.start as usize;
        let def = rest.iter().find(|n| n.name == "default").map(|n| self.name(&n.alias, sp, &mut at));
        let parts: Vec<Code> = rest
            .iter()
            .filter(|n| n.name != "default")
            .map(|n| {
                if n.name == n.alias {
                    self.name(&n.name, sp, &mut at)
                } else {
                    let a = self.name(&n.name, sp, &mut at);
                    a.t(" as ").c(self.name(&n.alias, sp, &mut at))
                }
            })
            .collect();
        let mut c = Code::of(ind).t("import ");
        let has_parts = !parts.is_empty();
        if let Some(def) = def {
            c = c.c(def).t(if has_parts { ", " } else { "" });
        }
        if has_parts {
            c = c.t("{ ").c(Code::join(parts, ", ")).t(" }");
        }
        let q = js_str(from);
        let fa = self.find(&q[1..q.len() - 1], sp, at).map(|a| a - 1).filter(|a| self.src[*a..].starts_with(&q));
        c = c.t(" from ").at(&q, fa).t(";");
        self.w.emit(c, *line);
        for n in &rest {
            if !self.is_type_import(d, &n.name) {
                self.snap_alias(&n.alias, ind, *line);
            }
        }
    }
    fn is_type_import(&self, d: &Decl, name: &str) -> bool {
        let Decl::Import { resolved: Some(r), .. } = d else { return false };
        if self.set.programs.get(r).is_some_and(|p| p.decls.iter().any(|x| matches!(x, Decl::TypeDecl { name: n, .. } if n == name))) {
            return true;
        }
        self.set.signatures.get(r).and_then(|s| s.exports.get(name)).is_some_and(|x| matches!(x, ExportSig::Type))
    }
    /// Snap names a handler reads, not counting its parameters, its locals, or a nested arrow. Sorted, so both projections agree.
    fn handler_snaps(&self, params: &[String], body: &Expr, stmts: Option<&[Stmt]>) -> Vec<String> {
        let mut bound: HashSet<String> = params.iter().cloned().collect();
        let mut out = HashSet::new();
        fn expr(e: &Expr, snap: &HashSet<String>, bound: &HashSet<String>, out: &mut HashSet<String>) {
            match &e.k {
                ExprKind::Fn { .. } | ExprKind::ServerFn { .. } | ExprKind::Draft { .. } => {}
                ExprKind::Id(n) => {
                    if snap.contains(n) && !bound.contains(n) {
                        out.insert(n.clone());
                    }
                }
                ExprKind::Bin { l, r, .. } => { expr(l, snap, bound, out); expr(r, snap, bound, out); }
                ExprKind::Un { e, .. } | ExprKind::Peek(e) | ExprKind::Latest(e) | ExprKind::Pending(e) | ExprKind::Spread(e) | ExprKind::Throw(e) | ExprKind::As { e, .. } => expr(e, snap, bound, out),
                ExprKind::Pre { init, .. } => init.iter().for_each(|x| expr(x, snap, bound, out)),
                ExprKind::Await { e, init, .. } => { expr(e, snap, bound, out); init.iter().for_each(|x| expr(x, snap, bound, out)); }
                ExprKind::If { c, t, f } => { expr(c, snap, bound, out); expr(t, snap, bound, out); expr(f, snap, bound, out); }
                ExprKind::Member { o, .. } => expr(o, snap, bound, out),
                ExprKind::Index { o, i, .. } => { expr(o, snap, bound, out); expr(i, snap, bound, out); }
                ExprKind::Call { f, args } => { expr(f, snap, bound, out); args.iter().for_each(|a| expr(a, snap, bound, out)); }
                ExprKind::Arr(items) => items.iter().for_each(|a| expr(a, snap, bound, out)),
                ExprKind::Rec(fields) => fields.iter().for_each(|f| match f {
                    Field::Kv { v, .. } => expr(v, snap, bound, out),
                    Field::Computed { key, v } => { expr(key, snap, bound, out); expr(v, snap, bound, out); }
                    Field::Spread(x) => expr(x, snap, bound, out),
                }),
                ExprKind::Tpl(parts) => parts.iter().for_each(|p| if let TplPart::Expr(x) = p { expr(x, snap, bound, out) }),
                ExprKind::Catch { e, alt, name, arms, .. } => {
                    expr(e, snap, bound, out);
                    if let Some(arms) = arms {
                        let mut bound = bound.clone();
                        bound.extend(name.iter().cloned());
                        for a in arms { expr(&a.body, snap, &bound, out); }
                    } else {
                        expr(alt, snap, bound, out);
                    }
                }
                ExprKind::Omit { e, .. } => expr(e, snap, bound, out),
                _ => {}
            }
        }
        fn walk_stmts(ss: &[Stmt], snap: &HashSet<String>, bound: &mut HashSet<String>, out: &mut HashSet<String>) {
            for s in ss {
                match &s.k {
                    StmtKind::Let { name, e, .. } => { expr(e, snap, bound, out); bound.insert(name.clone()); }
                    StmtKind::Write { target, e } | StmtKind::Optimistic { target, e } => {
                        for p in &target.path {
                            if let PathSeg::Expr(x) = p { expr(x, snap, bound, out); }
                        }
                        expr(e, snap, bound, out);
                    }
                    StmtKind::Expr(e) | StmtKind::Throw(e) => expr(e, snap, bound, out),
                    StmtKind::Return(Some(e)) => expr(e, snap, bound, out),
                    StmtKind::Sif { c, t, f } => { expr(c, snap, bound, out); walk_stmts(t, snap, bound, out); walk_stmts(f, snap, bound, out); }
                    StmtKind::Try { body, handler, fin, catch_name, arms, .. } => {
                        walk_stmts(body, snap, bound, out);
                        for a in arms.iter().flatten() {
                            let mut bound = bound.clone();
                            bound.extend(catch_name.iter().cloned());
                            walk_stmts(&a.body, snap, &mut bound, out);
                        }
                        if let Some(h) = handler { walk_stmts(h, snap, bound, out); }
                        if let Some(h) = fin { walk_stmts(h, snap, bound, out); }
                    }
                    StmtKind::Action(body) => walk_stmts(body, snap, bound, out),
                    _ => {}
                }
            }
        }
        if let Some(ss) = stmts { walk_stmts(ss, &self.snap, &mut bound, &mut out); } else { expr(body, &self.snap, &bound, &mut out); }
        let mut v: Vec<String> = out.into_iter().collect();
        v.sort();
        v
    }
    /// A handler's read of this name is a snapshot of its type, not a branch's narrowing (TY-2).
    fn snap_alias(&mut self, alias: &str, ind: &str, line: usize) {
        self.snap.insert(alias.to_string());
        self.w.emit(Code::of(&format!("{ind}type __W_{alias} = typeof {alias};")), line);
    }
    /// TY-4b: check the import against its `.d.rx`, not whatever TypeScript would resolve the JS module to.
    fn declared_import(&mut self, d: &Decl, rest: &[&ImportName], decls: &[JsDecl], ind: &str) {
        let Decl::Import { from, line, declared, .. } = d else { return };
        // a declare namespace, not a module: nothing for TypeScript to resolve beside the `.ts`
        let ns = ns_name(declared.as_deref().unwrap_or(from));
        let dts = declared.clone().unwrap_or_default();
        // MO-11: lines generated from a TS module, typed by TypeScript
        let gen = decls.iter().any(is_gen);
        let first = self.ambients.insert(dts.clone());
        if first && !gen {
            let pre = if decls.iter().any(|d| matches!(d, JsDecl::Import { .. })) {
                decl_preamble(decls, self.set, self.path, &mut self.ambients, &mut self.bridged)
            } else {
                String::new()
            };
            let body = declaration_file(decls).trim_end().replace("export declare ", "export ").lines().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n");
            let block = format!("{ind}declare namespace {ns} {{\n{body}\n{ind}}}");
            let text = if pre.is_empty() { block } else { format!("{}\n{block}", pre.trim_end()) };
            self.w.emit(Code::of(&text), *line);
        } else if first {
            let written: Vec<JsDecl> = decls.iter().filter(|x| !is_gen(x)).cloned().collect();
            let pre = if written.iter().any(|d| matches!(d, JsDecl::Import { .. })) {
                decl_preamble(&written, self.set, self.path, &mut self.ambients, &mut self.bridged)
            } else {
                String::new()
            };
            if written.iter().any(|d| !matches!(d, JsDecl::Import { .. })) {
                // the written lines' namespace, which may name the generated types (TY-4b)
                let (gpre, gbody) = gen_bridges(&dts, decls, self.path, &mut self.bridged);
                let all = pre + &gpre;
                let block = ns_block_in(&dts, decls, &gbody, ind);
                let text = if all.is_empty() { block } else { format!("{}\n{block}", all.trim_end_matches('\n')) };
                self.w.emit(Code::of(&text), *line);
            } else if !pre.is_empty() {
                self.w.emit(Code::of(pre.trim_end_matches('\n')), *line);
            }
        }
        let of = |n: &str| decls.iter().find(|x| x.name() == n);
        let values: Vec<&&ImportName> = rest.iter().filter(|n| !matches!(of(&n.name), Some(JsDecl::Type { .. }))).collect();
        if !values.is_empty() {
            let def = values.iter().find(|n| n.name == "default");
            let parts: Vec<String> = values.iter().filter(|n| n.name != "default").map(|n| format!("{} as __js_{}", n.name, n.alias)).collect();
            let mut s = format!("{ind}import ");
            if let Some(def) = def {
                s.push_str(&format!("__js_{}", def.alias));
                if !parts.is_empty() {
                    s.push_str(", ");
                }
            }
            if !parts.is_empty() {
                s.push_str(&format!("{{ {} }}", parts.join(", ")));
            }
            s.push_str(&format!(" from {};", js_str(from)));
            self.w.emit(Code::of(&s), *line);
        }
        // MO-8d: erased; TypeScript's type
        let gen_types: Vec<String> = rest
            .iter()
            .filter(|n| matches!(of(&n.name), Some(x @ JsDecl::Type { .. }) if is_gen(x)))
            .map(|n| if n.name == n.alias { n.name.clone() } else { format!("{} as {}", n.name, n.alias) })
            .collect();
        if !gen_types.is_empty() {
            self.w.emit(Code::of(&format!("{ind}import type {{ {} }} from {};", gen_types.join(", "), js_str(from))), *line);
        }
        let mut import_at = d.span().start as usize;
        for n in rest {
            // A class arm names the import's instance type. Both the value
            // and the type alias should lead back to the written binding.
            if n.name != n.alias { self.name(&n.name, d.span(), &mut import_at); }
            let imported = self.name(&n.alias, d.span(), &mut import_at);
            let x = of(&n.name);
            if let Some(x) = x.filter(|x| is_gen(x)) {
                // TY-4b: TypeScript's declaration of the export
                let js = format!("__js_{}", n.alias);
                match x {
                    JsDecl::Type { .. } => continue,
                    JsDecl::Error { .. } => {
                        self.w.emit(Code::of(&format!("{ind}const ")).c(imported.clone()).t(&format!(" = {js} as unknown as __.Raise<typeof {js}>;")), *line);
                        self.snap_alias(&n.alias, ind, *line);
                        self.w.emit(Code::of(&format!("{ind}type ")).c(imported).t(&format!(" = {js};")), *line);
                        continue;
                    }
                    JsDecl::Fn { refs, shape, generics, .. } if refs.iter().any(|r| *r) || shape.has_ref() => {
                        // TY-4d: seen through its rows
                        let idx: Vec<String> = refs.iter().enumerate().filter(|(_, r)| **r).map(|(i, _)| i.to_string()).collect();
                        let g = if generics.is_some() { ", true" } else { "" };
                        let i = if idx.is_empty() { "never".to_string() } else { idx.join(" | ") };
                        self.w.emit(Code::of(&format!("{ind}const {} = {js} as unknown as (...a: __.ReadAt<Parameters<typeof {js}>, {i}{g}>) => __.ReadResult<ReturnType<typeof {js}>, {}{g}>;", n.alias, shape_type(shape))), *line);
                    }
                    _ => self.w.emit(Code::of(&format!("{ind}const {} = {js};", n.alias)), *line),
                }
                self.snap_alias(&n.alias, ind, *line);
                continue;
            }
            if x.is_none() || matches!(x, Some(JsDecl::Type { .. })) {
                self.w.emit(Code::of(&format!("{ind}type {} = {ns}.{};", n.alias, n.name)), *line);
            } else {
                let binding = if matches!(x, Some(JsDecl::Error { .. })) { imported.clone() } else { Code::of(&n.alias) };
                self.w.emit(Code::of(&format!("{ind}const ")).c(binding).t(&format!(" = __js_{} as typeof {ns}.{};", n.alias, n.name)), *line);
                self.snap_alias(&n.alias, ind, *line);
            }
            if matches!(x, Some(JsDecl::Error { .. })) {
                self.w.emit(Code::of(&format!("{ind}type ")).c(imported).t(&format!(" = {ns}.{};", n.name)), *line);
            }
        }
    }
    /// A JS import's module, from the program's root (where the stubs are written).
    fn mod_path(&self, from: &str) -> String {
        let mut parts: Vec<&str> = self.path.split('/').collect();
        parts.pop();
        for seg in from.split('/') {
            if seg == "." || seg.is_empty() {
                continue;
            }
            if seg == ".." {
                parts.pop();
            } else {
                parts.push(seg);
            }
        }
        parts.join("/")
    }
    /// E-7: values in dependency order (C-1 makes it a DAG; a `pre` reads the previous instant, so it is no edge).
    fn order<'d>(&self, ds: &'d [Decl]) -> Vec<&'d Decl> {
        let vals: Vec<&Decl> = ds.iter().filter(|d| matches!(d, Decl::Source { .. } | Decl::Eq { .. } | Decl::Provide { .. })).collect();
        let mut by_name: IndexMap<&str, usize> = IndexMap::new();
        for (i, d) in vals.iter().enumerate() {
            if !matches!(d, Decl::Provide { .. }) {
                by_name.insert(d.name().unwrap(), i);
            }
        }
        fn visit<'d>(i: usize, vals: &[&'d Decl], by_name: &IndexMap<&str, usize>, done: &mut Vec<bool>, busy: &mut Vec<bool>, out: &mut Vec<&'d Decl>) {
            if done[i] || busy[i] {
                return;
            }
            busy[i] = true;
            let e = match vals[i] {
                Decl::Eq { e, .. } | Decl::Provide { e, .. } => e,
                Decl::Source { init, .. } => init,
                _ => unreachable!(),
            };
            for n in free_ids(e) {
                if let Some(&t) = by_name.get(n.as_str()) {
                    if t != i {
                        visit(t, vals, by_name, done, busy, out);
                    }
                }
            }
            busy[i] = false;
            done[i] = true;
            out.push(vals[i]);
        }
        let (mut done, mut busy, mut out) = (vec![false; vals.len()], vec![false; vals.len()], vec![]);
        for i in 0..vals.len() {
            visit(i, &vals, &by_name, &mut done, &mut busy, &mut out);
        }
        out
    }

    // ---- imperative scope ----
    fn stmts(&mut self, ss: &[Stmt], ind: &str) {
        for s in ss {
            let sp = s.span;
            let mut at = sp.start as usize;
            match &s.k {
                StmtKind::Let { name, e, ty } => {
                    let nm = self.name(name, sp, &mut at);
                    let a = self.ann(ty, sp, &mut at);
                    let v = self.expr(e, true, None);
                    self.w.emit(Code::of(&format!("{ind}let ")).c(nm).c(a).t(" = ").c(v).t(";").from(sp), 0);
                }
                StmtKind::Expr(e) => {
                    let v = self.expr(e, true, None);
                    self.w.emit(Code::of(ind).c(v).t(";").from(sp), 0);
                }
                StmtKind::Return(e) => {
                    let v = match e {
                        Some(e) => Code::of(" ").c(self.expr(e, true, None)),
                        None => Code::new(),
                    };
                    self.w.emit(Code::of(&format!("{ind}return")).c(v).t(";").from(sp), 0);
                }
                StmtKind::Throw(e) => {
                    let v = self.expr(e, true, None);
                    self.w.emit(Code::of(&format!("{ind}throw ")).c(v).t(";").from(sp), 0);
                }
                StmtKind::Write { target, e } | StmtKind::Optimistic { target, e } => {
                    let v = self.expr(e, true, None);
                    // TY-2: a write is checked against the slot's type, not the type a branch has narrowed the read to.
                    if !target.is_ctx() && self.slots.contains(&target.name) {
                        let mut path = String::new();
                        for p in &target.path {
                            match p {
                                PathSeg::Name(n) => path.push_str(&format!(".{n}")),
                                PathSeg::Expr(x) => path.push_str(&format!("[{}]", self.expr(x, true, None).s)),
                            }
                        }
                        let base = if target.path.is_empty() {
                            format!("({} as __W_{})", target.name, target.name)
                        } else {
                            format!("({} as NonNullable<__W_{}>)", target.name, target.name)
                        };
                        self.w.emit(Code::of(&format!("{ind}__.set({base}{path})(")).c(v).t(");").from(sp), 0);
                    } else {
                        let t = self.target(target, sp, &mut at);
                        self.w.emit(Code::of(&format!("{ind}__.set(")).c(t).t(")(").c(v).t(");").from(sp), 0);
                    }
                }
                StmtKind::Refresh(n) | StmtKind::Affects(n) => {
                    let nm = self.name(n, sp, &mut at);
                    self.w.emit(Code::of(&format!("{ind}void ")).c(nm).t(";"), 0);
                }
                StmtKind::Action(body) => {
                    self.w.emit(Code::of(&format!("{ind}void (async () => {{")), 0);
                    self.stmts(body, &format!("{ind}  "));
                    self.w.emit(Code::of(&format!("{ind}}})();")), 0);
                }
                StmtKind::Sif { c, t, f } => {
                    let v = self.expr(c, true, None);
                    self.w.emit(Code::of(&format!("{ind}if (")).c(v).t(") {"), 0);
                    self.stmts(t, &format!("{ind}  "));
                    self.w.emit(Code::of(&format!("{ind}}} else {{")), 0);
                    self.stmts(f, &format!("{ind}  "));
                    self.w.emit(Code::of(&format!("{ind}}}")), 0);
                }
                StmtKind::Try { body, catch_name, catch_classes, handler, fin, arms } => {
                    self.w.emit(Code::of(&format!("{ind}try {{")), 0);
                    self.stmts(body, &format!("{ind}  "));
                    if let Some(arms) = arms {
                        self.w.emit(Code::of(&format!("{ind}}} catch {{")), 0);
                        let n = catch_name.as_deref().unwrap_or("__e");
                        if let Some(s) = body.last() { at = s.span.end as usize; }
                        let mut binding_at = self.find("catch", sp, at).map_or(at, |p| p + 5);
                        let binding = self.name(n, sp, &mut binding_at);
                        at = binding_at;
                        for (i, a) in arms.iter().enumerate() {
                            let alt = if i == 0 { "" } else { "else " };
                            let test = if a.cls == "_" { "" } else { "if (__.matchesArm()) " };
                            let ty = self.arm_type(a, sp, &mut at);
                            self.w.emit(Code::of(&format!("{ind}  {alt}{test}{{ const ")).c(binding.clone()).t(" = __.armError<").c(ty).t(">();"), a.line);
                            self.arm_binding(n, |this| this.stmts(&a.body, &format!("{ind}    ")));
                            if let Some(s) = a.body.last() { at = s.span.end as usize; }
                            self.w.emit(Code::of(&format!("{ind}  }}")), a.line);
                        }
                        if arms.last().is_some_and(|a| a.cls != "_") {
                            self.w.emit(Code::of(&format!("{ind}  else {{ throw __.armError<Error>(); }}")), 0);
                        }
                    } else if let Some(h) = handler {
                        let bind = match catch_name {
                            Some(n) => format!(" const {n} = __e as {};", catch_classes.as_ref().map(|c| c.join(" | ")).unwrap_or("Error".into())),
                            None => String::new(),
                        };
                        self.w.emit(Code::of(&format!("{ind}}} catch (__e) {{{bind}")), 0);
                        self.stmts(h, &format!("{ind}  "));
                    }
                    if let Some(f) = fin {
                        self.w.emit(Code::of(&format!("{ind}}} finally {{")), 0);
                        self.stmts(f, &format!("{ind}  "));
                    }
                    self.w.emit(Code::of(&format!("{ind}}}")), 0);
                }
            }
        }
    }
    fn target(&mut self, t: &Target, within: Span, at: &mut usize) -> Code {
        let nm = self.name(&t.name, within, at);
        let mut s = if t.is_ctx() { Code::of("__.use(").c(nm).t(")") } else { nm };
        for p in &t.path {
            s = match p {
                PathSeg::Name(n) => {
                    let m = self.name(n, within, at);
                    s.t(".").c(m)
                }
                PathSeg::Expr(e) => s.t("[").c(self.expr(e, true, None)).t("]"),
            };
        }
        s
    }

    // ---- expressions: `imp` imperative scope (a real `await`); `me` the equation being defined (its own `pre`) ----
    fn expr(&mut self, e: &Expr, imp: bool, me: Option<&str>) -> Code {
        self.expr_text(e, imp, me).from(e.span)
    }
    fn expr_text(&mut self, e: &Expr, imp: bool, me: Option<&str>) -> Code {
        let sp = e.span;
        let src_at = |text: &str| -> Option<usize> { (!sp.is_none() && sp.text(self.src) == text).then_some(sp.start as usize) };
        macro_rules! go {
            ($x:expr) => {
                self.expr($x, imp, me)
            };
        }
        match &e.k {
            ExprKind::Lit(l) => {
                let t = j(l);
                let at = src_at(&t);
                Code::new().at(&t, at)
            }
            ExprKind::Id(n) => {
                if builtin(n) && !self.declared.contains(n) {
                    self.used.insert(n.clone());
                }
                let at = src_at(n);
                match self.rename.get(n) {
                    Some(r) => Code::of(r),
                    None => Code::new().at(n, at),
                }
            }
            ExprKind::Pre { name, init } => {
                let mut from = sp.start as usize;
                if me == Some(name.as_str()) {
                    match init {
                        Some(i) => Code::of("__.pre(").c(go!(i)).t(")"),
                        None => Code::of("__.pre<any>()"),
                    }
                } else {
                    let nm = self.name(name, sp, &mut from);
                    let iv = init.as_ref().map(|i| go!(i)).unwrap_or_default();
                    Code::of("__.pre<typeof ").c(nm).t(">(").c(iv).t(")")
                }
            }
            ExprKind::Peek(x) | ExprKind::Latest(x) => go!(x),
            ExprKind::As { e: x, ty } => Code::of("(").c(go!(x)).t(" as ").c(self.ty(ty, e.span, &mut (x.span.end as usize))).t(")"),
            ExprKind::Pending(x) => Code::of("__.pending(").c(go!(x)).t(")"),
            ExprKind::Await { e: x, init, stream } => {
                if imp {
                    return Code::of("(await ").c(go!(x)).t(")");
                }
                let v = Code::of(if *stream { "__.awaitS(" } else { "__.await_(" }).c(go!(x)).t(")");
                match init {
                    Some(i) => Code::of("__.first(").c(v).t(", ").c(go!(i)).t(")"),
                    None => v,
                }
            }
            ExprKind::If { c, t, f } => Code::of("(").c(go!(c)).t(" ? ").c(go!(t)).t(" : ").c(go!(f)).t(")"),
            ExprKind::Throw(x) => Code::of("__.raise(").c(go!(x)).t(")"),
            ExprKind::Catch { e: x, name, classes, alt, arms } => {
                let v = go!(x);
                if let Some(arms) = arms {
                    let n = name.as_deref().unwrap_or("__e");
                    let mut at = self.find("catch", sp, x.span.end as usize).map_or(x.span.end as usize, |p| p + 5);
                    let binding = self.name(n, sp, &mut at);
                    let mut out = if imp {
                        Code::of("(await (async () => { try { return ").c(v).t("; } catch { ")
                    } else {
                        Code::of("__.caughtArms(").c(v)
                    };
                    for (i, a) in arms.iter().enumerate() {
                        let ty = self.arm_type(a, sp, &mut at);
                        let body = self.arm_binding(n, |this| this.expr(&a.body, imp, me));
                        at = a.body.span.end as usize;
                        if imp {
                            if i > 0 { out = out.t(" else "); }
                            if a.cls != "_" { out = out.t("if (__.matchesArm()) "); }
                            out = out.t("{ const ").c(binding.clone()).t(" = __.armError<").c(ty).t(">(); return ").c(body).t("; }");
                        } else {
                            out = out.t(", (").c(binding.clone()).t(": ").c(ty).t(") => ").c(body);
                        }
                    }
                    if imp {
                        if arms.last().is_some_and(|a| a.cls != "_") { out = out.t(" else { throw __.armError<Error>(); }"); }
                        return out.t(" } })())");
                    }
                    return out.t(")");
                }
                let a = go!(alt);
                Code::of("__.caught(").c(v).t(&format!(", ({}: {}) => ", name.as_deref().unwrap_or("__e"), classes.as_ref().map(|c| c.join(" | ")).unwrap_or("Error".into()))).c(a).t(")")
            }
            ExprKind::Tpl(parts) => {
                let mut c = Code::of("`");
                for p in parts {
                    match p {
                        TplPart::Str(s) => c = c.t(&escape_tpl(s)),
                        TplPart::Expr(x) => c = c.t("${").c(go!(x)).t("}"),
                    }
                }
                c.t("`")
            }
            ExprKind::Member { o, p, opt } => {
                // `.p` with its dot, so that a position just after the dot (what is being typed) is mapped too
                let dot = format!(".{p}");
                let at = (!sp.is_none() && sp.text(self.src).ends_with(dot.as_str())).then(|| sp.end as usize - dot.len());
                go!(o).t(if *opt { "?" } else { "" }).at(&dot, at)
            }
            ExprKind::Index { o, i, opt } => go!(o).t(if *opt { "?.[" } else { "[" }).c(go!(i)).t("]"),
            ExprKind::StyleMap { css, .. } => Code::of(&class_map(css)),
            ExprKind::Call { f, args } => {
                let fc = go!(f);
                let a = args.iter().map(|a| go!(a)).collect();
                fc.t("(").c(Code::join(a, ", ")).t(")")
            }
            ExprKind::Arr(items) => {
                let a = items.iter().map(|a| go!(a)).collect();
                Code::of("[").c(Code::join(a, ", ")).t("]")
            }
            ExprKind::Rec(fields) => {
                let fs = fields
                    .iter()
                    .map(|f| match f {
                        Field::Spread(x) => Code::of("...").c(go!(x)),
                        Field::Kv { key, v } => Code::of(&js_str(key)).t(": ").c(go!(v)),
                        Field::Computed { key, v } => Code::of("[").c(go!(key)).t("]: ").c(go!(v)),
                    })
                    .collect();
                Code::of("({ ").c(Code::join(fs, ", ")).t(" })")
            }
            ExprKind::Spread(x) => Code::of("...").c(go!(x)),
            ExprKind::Omit { e: x, keys } => {
                let ks: String = keys.iter().map(|k| format!(", {}", js_str(k))).collect();
                Code::of("__.omit(").c(go!(x)).t(&ks).t(")")
            }
            ExprKind::Fn { params, body, stmts } => {
                let mut from = sp.start as usize;
                let ps = Code::join(params.iter().map(|p| self.name(p, sp, &mut from)).collect(), ", ");
                let names = if imp { self.handler_snaps(params, body, stmts.as_deref()) } else { vec![] };
                let saved = self.rename.clone();
                if !names.is_empty() {
                    for n in &names {
                        self.rename.insert(n.clone(), format!("__s_{n}"));
                    }
                }
                let (inner, is_stmt, is_async) = if let Some(ss) = stmts {
                    (self.nested(|me| me.stmts(ss, "  ")), true, has_await(ss))
                } else {
                    (self.expr(body, imp, me), false, false)
                };
                self.rename = saved;
                if names.is_empty() {
                    return if is_stmt {
                        Code::of(if is_async { "(async (" } else { "((" }).c(ps).t(") => {\n").c(inner).t("\n})")
                    } else {
                        Code::of("((").c(ps).t(") => ").c(inner).t(")")
                    };
                }
                let params_s = names.iter().map(|n| format!("__s_{n}: __W_{n}")).collect::<Vec<_>>().join(", ");
                let args = names.join(", ");
                if is_stmt {
                    Code::of("((").c(ps).t(&format!(") => (({params_s}) => {{\n")).c(inner).t(&format!("\n}})({args}))"))
                } else {
                    Code::of("((").c(ps).t(&format!(") => (({params_s}) => ")).c(inner).t(&format!(")({args}))"))
                }
            }
            ExprKind::ServerFn { params, ptypes, ret, body } => {
                let mut from = sp.start as usize;
                let ps = self.params(params, ptypes, sp, &mut from);
                let r = match ret {
                    Some(r) => Code::of(": Promise<").c(self.ty(r, sp, &mut from)).t(">"),
                    None => Code::new(),
                };
                let inner = self.nested(|me| me.stmts(body, "  "));
                // SF-1d: an async function, its wire checked (TY-5a)
                Code::of("((__f) => (__.wire(__f, true), __f))(async (").c(ps).t(")").c(r).t(" => {\n").c(inner).t("\n})")
            }
            ExprKind::Draft { seed, body } => {
                let s = go!(seed);
                let inner = self.nested(|me| me.stmts(body, "  "));
                Code::of("__.draft(").c(s).t(", (d) => {\n").c(inner).t("\n})")
            }
            ExprKind::Use(n) => {
                let mut from = sp.start as usize + 3;
                Code::of("__.use(").c(self.name(n, sp, &mut from)).t(")")
            }
            ExprKind::Bin { op, l, r } => {
                let o = match op.as_str() {
                    "==" => "===",
                    "!=" => "!==",
                    o => o,
                };
                Code::of("(").c(go!(l)).t(&format!(" {o} ")).c(go!(r)).t(")")
            }
            ExprKind::Un { op, e: x } => Code::of("(").t(op).c(go!(x)).t(")"),
        }
    }
    /// What `f` writes, as one piece of text (a closure's body).
    fn nested(&mut self, f: impl FnOnce(&mut Self)) -> Code {
        let saved = std::mem::replace(&mut self.w, W::new());
        f(self);
        std::mem::replace(&mut self.w, saved).buf
    }

    // ---- views: JSX over Solid's JSX types ----
    fn markup(&mut self, ms: &[Markup], ind: &str) {
        if ms.is_empty() {
            self.w.emit(Code::of(&format!("{ind}null")), 0);
            return;
        }
        self.w.emit(Code::of(&format!("{ind}<>")), ms[0].line.unwrap_or(0));
        for m in ms {
            self.child(m, &format!("{ind}  "));
        }
        self.w.emit(Code::of(&format!("{ind}</>")), ms[ms.len() - 1].line.unwrap_or(0));
    }
    fn region(&mut self, decls: &[Decl], view: &[Markup], ind: &str, line: usize) {
        if decls.is_empty() {
            self.markup(view, ind);
            return;
        }
        self.w.emit(Code::of(&format!("{ind}(() => {{")), line);
        self.decls(decls, &format!("{ind}  "), false);
        self.w.emit(Code::of(&format!("{ind}  return (")), line);
        self.markup(view, &format!("{ind}    "));
        self.w.emit(Code::of(&format!("{ind}  );\n{ind}}})()")), line);
    }
    fn child(&mut self, m: &Markup, ind: &str) {
        let line = m.line.unwrap_or(0);
        let sp = m.span;
        let i2 = format!("{ind}  ");
        match &m.kind {
            MarkupKind::Text(s) => self.w.emit(Code::of(&format!("{ind}{{{}}}", js_str(s))), line),
            MarkupKind::Style(_) => {}
            MarkupKind::Read(e) => {
                let v = self.expr(e, false, None);
                self.w.emit(Code::of(&format!("{ind}{{")).c(v).t("}").from(sp), line);
            }
            MarkupKind::El { tag, attrs, children } => {
                if tag.is_empty() {
                    self.w.emit(Code::of(&format!("{ind}<>")), line);
                    for c in children {
                        self.child(c, &i2);
                    }
                    self.w.emit(Code::of(&format!("{ind}</>")), line);
                    return;
                }
                let tag_at = (!sp.is_none() && sp.text(self.src)[1..].starts_with(tag.as_str())).then_some(sp.start as usize + 1);
                let mut a = Code::new();
                for at in attrs {
                    // 07 §4: a spread, as JSX's
                    if at.name == "..." {
                        a = a.t(" {...").c(self.expr(&at.e, false, None)).t("}");
                        continue;
                    }
                    let name_at = (!at.span.is_none() && at.span.text(self.src) == at.name).then_some(at.span.start as usize);
                    a = a.t(" ").at(&at.name, name_at);
                    if !matches!(at.e.k, ExprKind::Lit(Lit::Bool(true))) {
                        a = a.t("={").c(self.expr(&at.e, is_handler(&at.name), None)).t("}");
                    }
                }
                let open = Code::of(&format!("{ind}<")).at(tag, tag_at).c(a);
                if children.is_empty() {
                    self.w.emit(open.t(" />"), line);
                    return;
                }
                self.w.emit(open.t(">"), line);
                for c in children {
                    self.child(c, &i2);
                }
                let close_at = self.src.get(..sp.end as usize).filter(|s| !sp.is_none() && s.ends_with(&format!("</{tag}>"))).map(|_| sp.end as usize - tag.len() - 1);
                self.w.emit(Code::of(&format!("{ind}</")).at(tag, close_at).t(">"), line);
            }
            MarkupKind::Mif { c, t, t_decls, f, f_decls } => {
                let v = self.expr(c, false, None);
                self.w.emit(Code::of(&format!("{ind}{{")).c(v).t(" ? ("), line);
                self.region(t_decls, t, &i2, line);
                self.w.emit(Code::of(&format!("{ind}) : (")), line);
                self.region(f_decls, f, &i2, line);
                self.w.emit(Code::of(&format!("{ind})}}")), line);
            }
            MarkupKind::Mfor { name, xs, decls, body } => {
                let mut from = sp.start as usize;
                let nm = self.name(name, sp, &mut from);
                let v = self.expr(xs, false, None);
                self.w.emit(Code::of(&format!("{ind}{{__.each(")).c(v).t(", (").c(nm).t(") => ("), line);
                self.region(decls, body, &i2, line);
                self.w.emit(Code::of(&format!("{ind}))}}")), line);
            }
            MarkupKind::Loading { on, fallback, decls, body } => {
                if let Some(on) = on {
                    let v = self.expr(on, false, None);
                    self.w.emit(Code::of(&format!("{ind}{{void ")).c(v).t("}"), line);
                }
                self.w.emit(Code::of(&format!("{ind}{{(")), line);
                self.markup(fallback, &i2);
                self.w.emit(Code::of(&format!("{ind})}}{{(")), line);
                self.region(decls, body, &i2, line);
                self.w.emit(Code::of(&format!("{ind})}}")), line);
            }
            MarkupKind::Portal { to, decls, body } => {
                if let Some(to) = to {
                    let v = self.expr(to, false, None);
                    self.w.emit(Code::of(&format!("{ind}{{void ")).c(v).t("}"), line);
                }
                self.w.emit(Code::of(&format!("{ind}{{(")), line);
                self.region(decls, body, &i2, line);
                self.w.emit(Code::of(&format!("{ind})}}")), line);
            }
            MarkupKind::Errored { fallback, decls, body, err_name, classes, arms } => {
                if let Some(arms) = arms {
                    let n = err_name.as_deref().unwrap_or("__err");
                    let mut at = self.find("fallback", m.span, m.span.start as usize).map_or(m.span.start as usize, |p| p + 8);
                    let binding = self.name(n, m.span, &mut at);
                    for a in arms {
                        let ty = self.arm_type(a, m.span, &mut at);
                        self.w.emit(Code::of(&format!("{ind}{{((")).c(binding.clone()).t(": ").c(ty).t(") => ("), a.line);
                        self.arm_binding(n, |this| this.markup(&a.body, &i2));
                        if let Some(m) = a.body.last() { at = m.span.end as usize; }
                        self.w.emit(Code::of(&format!("{ind}))(null!)}}")), a.line);
                    }
                    self.w.emit(Code::of(&format!("{ind}{{(")), line);
                    self.region(decls, body, &i2, line);
                    self.w.emit(Code::of(&format!("{ind})}}")), line);
                    return;
                }
                let head = format!("{ind}{{(({}: {}) => (", err_name.as_deref().unwrap_or("__err"), classes.as_ref().map(|c| c.join(" | ")).unwrap_or("Error".into()));
                self.w.emit(Code::of(&head), line);
                self.markup(fallback, &i2);
                self.w.emit(Code::of(&format!("{ind}))(null!)}}{{(")), line);
                self.region(decls, body, &i2, line);
                self.w.emit(Code::of(&format!("{ind})}}")), line);
            }
        }
    }
}

/// A template literal's cooked text, escaped back into TSX.
fn escape_tpl(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '`' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '$' if it.peek() == Some(&'{') => {
                out.push_str("\\${");
                it.next();
            }
            '\x00'..='\x1f' => out.push_str(&format!("\\x{:02x}", c as u32)),
            _ => out.push(c),
        }
    }
    out
}

/// 07 CSS-5: TSRX's class map, as its typecheck projection writes it — each class a `string`.
fn class_map(css: &str) -> String {
    use solidjs_compiler::style::*;
    let r = compile_style(StyleInput { css, location: StyleLocation { filename: "class-map.tsrx", line: 1, column: 19 }, elements: &[], kind: StyleKind::Expression, minify: false });
    let Ok(r) = r else { return "({} as const)".into() };
    if r.class_map.is_empty() {
        return "({} as const)".into();
    }
    let fields: Vec<String> = r.class_map.into_iter().map(|c| format!("{}: \"\" as string", js_str(&c.class_name))).collect();
    format!("({{ {} }} as const)", fields.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::load_modules;
    use std::collections::HashMap;

    #[test]
    fn ordered_error_arms_map_classes_and_bindings_in_all_three_positions() {
        let src = "\
error Offline(reason: string)
export default component App() {
  action save() {
    try { await fetch(\"save\") } catch (e) { Offline => { log(e.reason) } _ => {} }
    let msg = await fetch(\"msg\") catch (e) { Offline => { e.reason } _ => { null } }
  }
  errored fallback(e) {
    Offline /* a comment */ => { <p>{e.reason}</p> }
    _ => { <p>{e.message}</p> }
  } { <p>{await fetch(\"data\")}</p> }
}
";
        let set = load_modules("main.rx", &|p| (p == "main.rx").then(|| src.into())).unwrap();
        assert!(set.diags.is_empty(), "{:?}", set.diags);
        let out = project_modules(&set);
        let p = &out[0];
        assert!(unverified(p, src).is_empty());
        for (search, expected) in [("Offline =>", 2), ("Offline /*", 1), ("e.reason", 3)] {
            let spans = src.match_indices(search).map(|(at, _)| at).collect::<Vec<_>>();
            let token = search.split(' ').next().unwrap().split('.').next().unwrap();
            assert_eq!(spans.len(), expected);
            for at in spans {
                assert!(p.mappings.iter().any(|m| m.src as usize == at && m.len as usize == token.len()), "unmapped {search} @ {at}\n{}", p.code);
            }
        }
        assert!(!p.code.contains("instanceof"), "{}", p.code);
    }

    #[test]
    fn an_entry_default_is_the_apps_main_and_its_component_keeps_its_mappings() {
        let files: HashMap<&str, &str> = [
            ("app/main.rx", "import { Badge } from \"./badge.rx\"\nexport default component App() {\n  source n := 0\n  <Badge n={n} />\n}\n"),
            ("app/badge.rx", "export component Badge(props: { n: number }) {\n  <b>{props.n}</b>\n}\n"),
        ]
        .into_iter()
        .collect();
        let set = load_modules("app/main.rx", &|p| files.get(p).map(|s| s.to_string())).expect("loads");
        let out = project_modules(&set);
        let main = out.iter().find(|p| p.rx == "app/main.rx").unwrap();
        assert!(main.code.ends_with("\ndeclare const __main: __.Main; export default __main;"), "{}", main.code);
        assert_eq!(main.code.matches("export default").count(), 1);
        assert_eq!(main.lines.len(), main.code.lines().count());
        let at = main.code.find("export function App(").unwrap() + "export function ".len();
        let src = files["app/main.rx"].find("App").unwrap();
        assert!(main.mappings.iter().any(|m| m.gen as usize == at && m.src as usize == src && m.len == 3));
        let dep = out.iter().find(|p| p.rx == "app/badge.rx").unwrap();
        assert!(!dep.code.contains("export default"), "{}", dep.code);
        assert!(PRELUDE.contains("export type Main = (app: object) => () => View;"));
    }
}

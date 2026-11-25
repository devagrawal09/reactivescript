//! 09-modules: a program is a set of `.rx` modules (`ref/src/modules.ts`). The loader resolves each `.rx` import to a path,
//! parses every module once, and orders them dependencies first (MO-1). A cycle is refused (MO-5).

use crate::ast::{Decl, Program};
use crate::check::Diagnostic;
use crate::parse::{parse_declarations, parse_program, JsDecl, ParseError};
use crate::signature::{parse_signature, ModSig};
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};

pub struct ModuleSet {
    pub entry: String,
    pub programs: HashMap<String, Program>,
    pub order: Vec<String>,
    pub diags: Vec<Diagnostic>,
    /// MO-8, by `.d.rx` path
    pub declarations: IndexMap<String, Vec<JsDecl>>,
    /// MO-8c: relative JS specifiers with a local module, keyed by joined path.
    pub js_files: HashSet<String>,
    /// MO-9, by `.rx` path
    pub signatures: IndexMap<String, ModSig>,
    /// each program's text, which its spans index
    pub sources: HashMap<String, String>,
    /// an editor's load (CP-8e): what the parse recovered from, each with its file
    pub parse_errors: Vec<ParseError>,
}

pub fn is_rx(from: &str) -> bool {
    from.ends_with(".rx")
}

/// POSIX-style join and normalisation, for module keys (no file system involved).
pub fn join_path(from_file: &str, rel: &str) -> String {
    let segs: Vec<&str> = from_file.split('/').collect();
    let base = &segs[..segs.len() - 1];
    let mut parts: Vec<String> = if rel.starts_with('/') { vec![] } else { base.iter().map(|s| s.to_string()).collect() };
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if !parts.is_empty() && parts.last().unwrap() != ".." {
                parts.pop();
            } else {
                parts.push("..".into());
            }
        } else {
            parts.push(seg.into());
        }
    }
    format!("{}{}", if rel.starts_with('/') { "/" } else { "" }, parts.join("/"))
}

#[derive(PartialEq, Clone, Copy)]
enum State {
    Busy,
    Done,
}

struct Loader<'r> {
    read: &'r dyn Fn(&str) -> Option<String>,
    programs: HashMap<String, Program>,
    order: Vec<String>,
    diags: Vec<Diagnostic>,
    declarations: IndexMap<String, Vec<JsDecl>>,
    js_files: HashSet<String>,
    signatures: IndexMap<String, ModSig>,
    sources: HashMap<String, String>,
    state: HashMap<String, State>,
    recover: bool,
    parse_errors: Vec<ParseError>,
}

/// MO-10c: the file a package import resolves to, as a bundler finds it — `node_modules` up from the importer, the
/// package's `exports` (a subpath, then the first of its conditions that a Solid build sets, in the package's order; `*`
/// patterns), else `module` or `main`. Its declaration is beside it: the same name, `.d.rx`.
pub fn package_declaration(from_file: &str, spec: &str, read: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    use serde_json::Value;
    const CONDITIONS: [&str; 4] = ["solid", "browser", "import", "default"];
    let seg: Vec<&str> = spec.split('/').collect();
    let n = if spec.starts_with('@') { 2 } else { 1 };
    if seg.len() < n || seg[..n].iter().any(|x| x.is_empty()) {
        return None;
    }
    let pkg = seg[..n].join("/");
    let sub = if seg.len() > n { format!("./{}", seg[n..].join("/")) } else { ".".to_string() };
    let all: Vec<&str> = from_file.split('/').collect();
    let dirs = &all[..all.len() - 1];
    let min = if from_file.starts_with('/') { 1 } else { 0 };
    fn pick(t: &Value) -> Option<String> {
        match t {
            Value::String(s) => Some(s.clone()),
            Value::Array(xs) => xs.iter().find_map(pick),
            Value::Object(m) => m.iter().filter(|(k, _)| CONDITIONS.contains(&k.as_str())).find_map(|(_, v)| pick(v)),
            _ => None,
        }
    }
    let mut i = dirs.len() as i64;
    while i >= min {
        let mut parts: Vec<&str> = dirs[..i as usize].to_vec();
        parts.push("node_modules");
        parts.push(&pkg);
        let root = parts.join("/");
        i -= 1;
        let Some(pj) = read(&format!("{root}/package.json")) else { continue };
        let Ok(json) = serde_json::from_str::<Value>(&pj) else { return None };
        let target: Option<String> = match json.get("exports") {
            Some(ex) => {
                let map = match ex {
                    Value::Object(m) if m.keys().any(|k| k.starts_with('.')) => Some(m),
                    _ => None,
                };
                match map {
                    None => (sub == ".").then(|| pick(ex)).flatten(),
                    Some(m) => match m.get(&sub) {
                        Some(v) => pick(v),
                        None => m.iter().find_map(|(k, v)| {
                            let star = k.find('*')?;
                            let (pre, post) = (&k[..star], &k[star + 1..]);
                            if sub.starts_with(pre) && sub.ends_with(post) && sub.len() >= pre.len() + post.len() {
                                Some(pick(v).map(|t| t.replace('*', &sub[pre.len()..sub.len() - post.len()])))
                            } else {
                                None
                            }
                        }).flatten(),
                    },
                }
            }
            None => {
                if sub == "." {
                    Some(json.get("module").and_then(|v| v.as_str()).or_else(|| json.get("main").and_then(|v| v.as_str())).unwrap_or("./index.js").to_string())
                } else {
                    Some(sub.clone())
                }
            }
        };
        let target = target?;
        let file = join_path(&format!("{root}/package.json"), &target);
        let stem = PKG_EXT.replace(&file, "").to_string();
        return Some(stem + ".d.rx");
    }
    None
}
static PKG_EXT: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\.(m?js|cjs|jsx|ts|tsx)$").unwrap());

/// MO-11a: the TS module for a stem, the first of these that exists.
pub const TS_CANDIDATES: [&str; 9] = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".d.mts", "/index.ts", "/index.tsx", "/index.d.ts"];
/// MO-11d: what a generator answers at `rx-dts:<stem>` — the generated text, its diagnostics (in the TS module), and every
/// file it read (for staleness).
#[derive(Debug, Clone)]
pub struct DtsRecord {
    pub from: String,
    pub text: String,
    pub errors: Vec<DtsError>,
    pub files: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct DtsError {
    pub file: String,
    pub line: i64,
    pub code: String,
    pub message: String,
}
/// The key a host answers with a stem's record, as JSON (`null`: none).
pub const DTS_KEY: &str = "rx-dts:";
pub fn read_record(read: &dyn Fn(&str) -> Option<String>, stem: &str) -> Option<DtsRecord> {
    use serde_json::Value;
    let s = read(&format!("{DTS_KEY}{stem}"))?;
    let j: Value = serde_json::from_str(&s).ok()?;
    let (Some(from), Some(text)) = (j.get("from").and_then(|v| v.as_str()), j.get("text").and_then(|v| v.as_str())) else { return None };
    let errors = j
        .get("errors")
        .and_then(|v| v.as_array())
        .map(|xs| {
            xs.iter()
                .map(|e| DtsError {
                    file: e.get("file").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    line: e.get("line").and_then(|v| v.as_i64()).unwrap_or(0),
                    code: e.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    message: e.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let files = j.get("files").and_then(|v| v.as_array()).map(|xs| xs.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    Some(DtsRecord { from: from.to_string(), text: text.to_string(), errors, files })
}
fn base(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}
fn rule_of(code: &str) -> &'static str {
    match code {
        "DECLARATION_BRAND" => "MO-11c",
        "DECLARATION_UNAVAILABLE" => "MO-11d",
        _ => "MO-11",
    }
}
pub const UNAVAILABLE_FIX: &str = "install the generator, `npm i -D @reactivescript/compiler typescript`, or set RX_DTS to a command that prints it (`rx-dts --record <stem>`)";

fn replace_js_ext(from: &str) -> String {
    for ext in [".mjs", ".js", ".ts"] {
        if let Some(s) = from.strip_suffix(ext) {
            return s.to_string();
        }
    }
    from.to_string()
}

impl Loader<'_> {
    fn visit(&mut self, path: &str, stack: &[String]) -> Result<(), ParseError> {
        if self.state.get(path) == Some(&State::Done) {
            return Ok(());
        }
        let Some(src) = (self.read)(path) else { return Ok(()) };
        let mut p = if self.recover {
            let (p, errs) = crate::parse::parse_program_recovering(&src);
            self.parse_errors.extend(errs.into_iter().map(|e| ParseError(e.0, e.1, Some(path.to_string()), e.3)));
            p
        } else {
            parse_program(&src).map_err(|e| ParseError(format!("{}: {}", path, e.0), e.1, Some(path.to_string()), e.3))?
        };
        self.state.insert(path.to_string(), State::Busy);
        for d in p.decls.iter_mut() {
            let Decl::Import { from, line, resolved, declared, declared_errors, declared_pure, declared_side, .. } = d else { continue };
            if !is_rx(from) && from.starts_with('.') {
                let stem = join_path(path, from);
                let exts = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".cjs", ".cts", ".json"];
                if (self.read)(&stem).is_some()
                    || exts.iter().any(|ext| (self.read)(&format!("{stem}{ext}")).is_some() || (self.read)(&format!("{stem}/index{ext}")).is_some())
                    || (self.read)(&format!("{stem}/package.json")).is_some()
                {
                    self.js_files.insert(stem);
                }
            }
            // MO-10c: a package's declaration, beside the file it resolves to
            let pkg_dts = if !is_rx(from) && !from.starts_with('.') && !from.starts_with('/') { package_declaration(path, from, &*self.read) } else { None };
            if !is_rx(from) && (from.starts_with('.') || pkg_dts.is_some()) {
                // MO-8: a JS module with a declaration file beside it
                let is_pkg = pkg_dts.is_some();
                let dts = pkg_dts.unwrap_or_else(|| join_path(path, &(replace_js_ext(from) + ".d.rx")));
                if is_pkg {
                    self.load_declaration(&dts)?;
                } else {
                    let stem = dts.strip_suffix(".d.rx").unwrap_or(&dts).to_string();
                    if !self.load_js_declaration(&stem)? {
                        // MO-11d: a TS module, and no generator
                        let ts = self.ts_module(&stem).unwrap_or_default();
                        self.diags.push(Diagnostic {
                            code: "DECLARATION_UNAVAILABLE".into(),
                            rule: "MO-11d".into(),
                            line: *line as i64,
                            file: Some(path.to_string()),
                            msg: format!("{} is the TS module {}, whose declaration is generated (MO-11d), and no generator answered: {}", from, base(&ts), UNAVAILABLE_FIX),
                        });
                    }
                }
                if let Some(ds) = self.declarations.get(&dts) {
                    *declared = Some(dts.clone());
                    *declared_errors = Some(ds.iter().filter_map(|x| if let JsDecl::Error { name, .. } = x { Some(name.clone()) } else { None }).collect());
                    *declared_pure = Some(ds.iter().filter_map(|x| if let JsDecl::Fn { name, pure: true, .. } = x { Some(name.clone()) } else { None }).collect());
                    *declared_side = Some(ds.iter().filter_map(|x| if let JsDecl::Fn { name, side: Some(s), .. } = x { Some((name.clone(), *s)) } else { None }).collect());
                }
                continue;
            }
            if !is_rx(from) {
                continue;
            }
            let to = join_path(path, from);
            *resolved = Some(to.clone());
            if self.state.get(&to) == Some(&State::Busy) {
                let mut chain: Vec<String> = stack.to_vec();
                chain.push(path.to_string());
                let at = stack.iter().position(|s| *s == to).unwrap_or(0);
                let mut cyc: Vec<String> = chain[at..].to_vec();
                cyc.push(to.clone());
                self.diags.push(Diagnostic {
                    code: "MODULE_CYCLE".into(),
                    rule: "MO-5".into(),
                    line: *line as i64,
                    file: Some(path.to_string()),
                    msg: format!("{}: modules may not import each other in a cycle (signatures are computed dependencies first)", cyc.join(" → ")),
                });
                continue;
            }
            if self.state.get(&to) != Some(&State::Done) && !self.signatures.contains_key(&to) && (self.read)(&to).is_none() {
                // MO-9: no body — its signature, read in place
                let dts = to.strip_suffix(".rx").map(|s| format!("{}.d.rx", s)).unwrap_or_else(|| to.clone());
                if let Some(sig) = (self.read)(&dts) {
                    let s = parse_signature(&sig, &to).map_err(|e| ParseError(e.0, None, Some(dts.clone()), "PARSE"))?;
                    self.signatures.insert(to.clone(), s);
                    continue;
                }
            }
            if self.signatures.contains_key(&to) {
                continue;
            }
            if self.state.get(&to) != Some(&State::Done) && (self.read)(&to).is_none() {
                self.diags.push(Diagnostic { code: "MODULE_NOT_FOUND".into(), rule: "MO-6".into(), line: *line as i64, file: Some(path.to_string()), msg: format!("no module {} (from {})", from, path) });
                continue;
            }
            let mut st = stack.to_vec();
            st.push(path.to_string());
            self.visit(&to, &st)?;
        }
        self.programs.insert(path.to_string(), p);
        self.sources.insert(path.to_string(), src);
        self.state.insert(path.to_string(), State::Done);
        self.order.push(path.to_string());
        Ok(())
    }
    fn ts_module(&self, stem: &str) -> Option<String> {
        TS_CANDIDATES.iter().map(|x| format!("{stem}{x}")).find(|p| (self.read)(p).is_some())
    }
    /// MO-11: a relative JS import's declaration, `<stem>.d.rx` — the written file (W), the one generated from the TS module
    /// (G), or both merged per export (MO-11e: W's line where W declares the name). False: there is a TS module and no
    /// generator answered.
    fn load_js_declaration(&mut self, stem: &str) -> Result<bool, ParseError> {
        let dts = format!("{stem}.d.rx");
        if self.declarations.contains_key(&dts) {
            return Ok(true);
        }
        let ts = self.ts_module(stem);
        let rec = if ts.is_some() { read_record(self.read, stem) } else { None };
        let written = (self.read)(&dts);
        let Some(rec) = rec else {
            // MO-8, unchanged
            if written.is_some() {
                self.load_declaration(&dts)?;
                return Ok(true);
            }
            return Ok(ts.is_none());
        };
        for e in &rec.errors {
            self.diags.push(Diagnostic { code: e.code.clone(), rule: rule_of(&e.code).into(), line: e.line, file: Some(e.file.clone()), msg: e.message.clone() });
        }
        if written.is_none() && rec.errors.iter().any(|e| e.code == "DECLARATION_UNAVAILABLE") {
            return Ok(true); // reported at the TS module
        }
        let mut gen = crate::parse::parse_declarations_in(&rec.text, true).map_err(|e| ParseError(format!("{} (generated from {}): {}", dts, rec.from, e.0), e.1, Some(dts.clone()), e.3))?;
        gen.retain(|x| !matches!(x, JsDecl::Import { .. }));
        for x in gen.iter_mut() {
            x.set_generated(&rec.from);
        }
        let Some(written) = written else {
            self.declarations.insert(dts, gen);
            return Ok(true);
        };
        let ws = parse_declarations(&written).map_err(|e| ParseError(format!("{}: {}", dts, e.0), e.1, Some(dts.clone()), e.3))?;
        let exports_of = |ds: &[JsDecl]| -> HashSet<String> { ds.iter().filter(|x| x.exported()).map(|x| x.name().to_string()).collect() };
        let (mine, theirs) = (exports_of(&ws), exports_of(&gen));
        for x in &ws {
            // a written type is the declaration's own: it binds no value
            if x.exported() && !matches!(x, JsDecl::Type { .. }) && !theirs.contains(x.name()) {
                self.diags.push(Diagnostic {
                    code: "NOT_EXPORTED".into(),
                    rule: "MO-11e".into(),
                    line: x.line() as i64,
                    file: Some(dts.clone()),
                    msg: format!("{}: {} exports no {} — a written line overrides an export of the TS module; remove the line, or export {} from {}", base(&dts), base(&rec.from), x.name(), x.name(), base(&rec.from)),
                });
            }
        }
        let mut merged = ws;
        merged.extend(gen.into_iter().filter(|x| !mine.contains(x.name())));
        self.declarations.insert(dts.clone(), merged);
        self.resolve_decl_imports(&dts)?;
        Ok(true)
    }
    /// MO-8: parse a `.d.rx` once, then resolve its type imports (MO-8e).
    fn load_declaration(&mut self, dts: &str) -> Result<(), ParseError> {
        if self.declarations.contains_key(dts) {
            return Ok(());
        }
        let Some(src) = (self.read)(dts) else { return Ok(()) };
        let ds = parse_declarations(&src).map_err(|e| ParseError(format!("{}: {}", dts, e.0), e.1, Some(dts.to_string()), e.3))?;
        self.declarations.insert(dts.to_string(), ds);
        self.resolve_decl_imports(dts)
    }
    /// MO-8e: `./x` in a `.d.rx` is `x.d.rx`, else the TS module's generated declaration (MO-11, the third: that module),
    /// else `x.rx`. A path ending in `.rx` is that module.
    fn decl_target(&self, from_file: &str, spec: &str) -> Option<(String, bool, Option<String>)> {
        if !spec.starts_with('.') && !spec.starts_with('/') {
            return None;
        }
        let s = spec.strip_suffix(".mjs").or_else(|| spec.strip_suffix(".js")).or_else(|| spec.strip_suffix(".ts")).unwrap_or(spec);
        if let Some(p) = s.strip_suffix(".d.rx") {
            let path = join_path(from_file, s);
            let _ = p;
            return (self.read)(&path).map(|_| (path, false, None));
        }
        if s.ends_with(".rx") {
            let path = join_path(from_file, s);
            return (self.read)(&path).map(|_| (path, true, None));
        }
        let stem = join_path(from_file, s);
        let dts = format!("{stem}.d.rx");
        if (self.read)(&dts).is_some() {
            return Some((dts, false, None));
        }
        if let Some(ts) = self.ts_module(&stem) {
            return Some((dts, false, Some(ts)));
        }
        let rx = format!("{stem}.rx");
        if (self.read)(&rx).is_some() {
            return Some((rx, true, None));
        }
        None
    }
    fn resolve_decl_imports(&mut self, file: &str) -> Result<(), ParseError> {
        let imports: Vec<(usize, String, Vec<crate::ast::ImportName>)> = self
            .declarations
            .get(file)
            .map(|ds| ds.iter().filter_map(|d| if let JsDecl::Import { line, from, names, .. } = d { Some((*line, from.clone(), names.clone())) } else { None }).collect())
            .unwrap_or_default();
        let who = file.rsplit('/').next().unwrap_or(file).to_string();
        for (line, from, names) in imports {
            let Some((path, rx, ts)) = self.decl_target(file, &from) else {
                self.diags.push(Diagnostic { code: "MODULE_NOT_FOUND".into(), rule: "MO-8".into(), line: line as i64, file: Some(file.to_string()), msg: format!("{who}: no module {from} (a `.d.rx` imports types from a `.d.rx` or an `.rx`)") });
                continue;
            };
            if let Some(ds) = self.declarations.get_mut(file) {
                for d in ds.iter_mut() {
                    if let JsDecl::Import { from: f, line: l, target, rx: r, .. } = d {
                        if f == &from && *l == line && target.is_none() {
                            *target = Some(path.clone());
                            *r = rx;
                        }
                    }
                }
            }
            if let Some(ts) = &ts {
                if !self.load_js_declaration(path.strip_suffix(".d.rx").unwrap_or(&path))? {
                    self.diags.push(Diagnostic {
                        code: "DECLARATION_UNAVAILABLE".into(),
                        rule: "MO-11d".into(),
                        line: line as i64,
                        file: Some(file.to_string()),
                        msg: format!("{who}: {from} is the TS module {}, whose declaration is generated (MO-11d), and no generator answered: {UNAVAILABLE_FIX}", base(ts)),
                    });
                    continue;
                }
            }
            if !rx {
                self.load_declaration(&path)?;
                let td = self.declarations.get(&path).cloned().unwrap_or_default();
                let where_ = path.rsplit('/').next().unwrap_or(&path).to_string();
                for n in &names {
                    let x = td.iter().find(|y| y.name() == n.name && y.exported());
                    match x {
                        None => self.diags.push(Diagnostic { code: "NOT_EXPORTED".into(), rule: "MO-8".into(), line: line as i64, file: Some(file.to_string()), msg: format!("{who}: {where_} exports no type {}", n.name) }),
                        Some(JsDecl::Fn { .. } | JsDecl::Const { .. }) => self.diags.push(Diagnostic { code: "TYPE_IMPORT".into(), rule: "MO-8".into(), line: line as i64, file: Some(file.to_string()), msg: format!("{who}: `{}` is a value, not a type — a declaration file imports types only (`import {{ T }} from \"./x\"`)", n.name) }),
                        _ => {}
                    }
                }
                continue;
            }
            if self.state.get(&path) != Some(&State::Done) && self.state.get(&path) != Some(&State::Busy) {
                self.visit(&path, &[])?;
            }
            let kind = if let Some(p) = self.programs.get(&path) {
                rx_export_kind(p, &names.iter().map(|n| n.name.clone()).collect::<Vec<_>>())
            } else if let Some(src) = (self.read)(&path) {
                parse_program(&src).map(|p| rx_export_kind(&p, &names.iter().map(|n| n.name.clone()).collect::<Vec<_>>())).unwrap_or_default()
            } else {
                vec![]
            };
            let where_ = path.rsplit('/').next().unwrap_or(&path);
            for n in &names {
                let k = kind.iter().find(|(name, _)| name == &n.name).map(|(_, k)| *k).unwrap_or("missing");
                if k == "missing" {
                    self.diags.push(Diagnostic { code: "NOT_EXPORTED".into(), rule: "MO-8".into(), line: line as i64, file: Some(file.to_string()), msg: format!("{who}: {where_} exports no type {}", n.name) });
                } else if k == "value" {
                    self.diags.push(Diagnostic { code: "TYPE_IMPORT".into(), rule: "MO-8".into(), line: line as i64, file: Some(file.to_string()), msg: format!("{who}: `{}` is a value, not a type — a declaration file imports types only (`import {{ T }} from \"./x\"`)", n.name) });
                }
            }
        }
        Ok(())
    }
}

fn rx_export_kind(p: &Program, names: &[String]) -> Vec<(String, &'static str)> {
    names.iter().map(|name| {
        let k = match p.decls.iter().find(|d| d.name() == Some(name) && d.exported()) {
            Some(Decl::TypeDecl { .. }) => "type",
            Some(_) => "value",
            None => "missing",
        };
        (name.clone(), k)
    }).collect()
}

/// Load `entry` and everything it imports from `.rx`. `read` returns a module's source, or `None` when there is none.
pub fn load_modules(entry: &str, read: &dyn Fn(&str) -> Option<String>) -> Result<ModuleSet, ParseError> {
    load(entry, read, false)
}
/// CP-8e: an editor's load. Each module is parsed recovering (`parse_program_recovering`), its errors in `parse_errors`;
/// a declaration file that does not parse is still an error.
pub fn load_modules_recovering(entry: &str, read: &dyn Fn(&str) -> Option<String>) -> Result<ModuleSet, ParseError> {
    load(entry, read, true)
}
fn load(entry: &str, read: &dyn Fn(&str) -> Option<String>, recover: bool) -> Result<ModuleSet, ParseError> {
    let mut l = Loader { read, programs: HashMap::new(), order: vec![], diags: vec![], declarations: IndexMap::new(), js_files: HashSet::new(), signatures: IndexMap::new(), sources: HashMap::new(), state: HashMap::new(), recover, parse_errors: vec![] };
    l.visit(entry, &[])?;
    Ok(ModuleSet { entry: entry.to_string(), programs: l.programs, order: l.order, diags: l.diags, declarations: l.declarations, js_files: l.js_files, signatures: l.signatures, sources: l.sources, parse_errors: l.parse_errors })
}

//! The resolved model (spec/11 CP-6, issue #1): what the checker resolved, as facts a lowering or another analysis consumes
//! instead of recognising source spellings. `ref/src/model.ts` defines it; this is the same builder, filled by the same walk,
//! so `ref/crate.ts` diffs the two. Not a stable format: no one outside this crate depends on it yet.
//!
//! A read is of a reactive symbol (a source, an equation, props, a context through `use`) and carries its mode:
//! `tracked` (reactive scope, SC-1), `snapshot` (imperative scope SC-2, `peek` E-5, a seed E-4, a value parameter's
//! argument E-10) or `pre` (C-2), and a `probe` under `latest` / `pending?` (R-9, R-12).

use serde_json::{json, Map, Value};

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
}
#[derive(Debug, Clone)]
pub struct ModelRegion {
    pub id: usize,
    pub kind: &'static str,
    pub parent: Option<usize>,
    pub name: Option<String>,
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
}

const READ_KINDS: &[&str] = &["source", "eq", "props", "context"];
const CALL_KINDS: &[&str] = &["fn", "action", "server", "import"];

impl ModelBuilder {
    pub fn region(&mut self, id: usize, kind: &'static str, parent: Option<usize>, name: Option<String>) {
        self.regions.push(ModelRegion { id, kind, parent, name });
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
        let c = Computation { id: self.computations.len(), kind, region, line, name, at, r#in: self.cur, reads: vec![], writes: vec![], calls: vec![] };
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
    pub fn write(&mut self, index: Option<usize>, op: &'static str, path: bool) {
        let (Some(cur), Some(index)) = (self.cur, index) else { return };
        let Some(&id) = self.ids.get(&index) else { return };
        let w = Write { sym: id, op, path };
        let c = &mut self.computations[cur];
        if !c.writes.contains(&w) {
            c.writes.push(w);
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
                                Value::Object(o)
                            })
                            .collect(),
                    ),
                );
                m.insert("calls".into(), json!(c.calls));
                Value::Object(m)
            })
            .collect();
        json!({ "file": file, "regions": regions, "symbols": symbols, "computations": comps })
    }
}

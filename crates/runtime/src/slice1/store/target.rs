//! Solid: store/target.ts — the store target, its family, ownership and the
//! raw → target lookup.
use super::super::*;
use super::{KeyMap, OrdSet, Wk};
use std::collections::HashMap;

/// Solid: target.ts:64-133 `StoreTarget` (the proxy's handler, built by
/// store.ts `TargetShape`). The proxy is `Value::Proxy(id)`; `shell_array`
/// is the proxy's shell (`Array.isArray(value)` at creation).
pub(in crate::slice1) struct StoreTarget {
    pub v: Obj,
    pub pb: Option<Obj>,
    pub ch: bool,
    pub nc: usize,
    pub n: Option<KeyMap<NodeId>>,
    pub h: Option<KeyMap<NodeId>>,
    pub k: Option<NodeId>,
    pub wk: Option<Wk>,
    pub dk: Option<NodeId>,
    pub u: Option<TargetId>,
    pub pk: Option<Key>,
    pub d: bool,
    pub a: bool,
    pub sc: u8,
    pub kc: usize,
    pub ovl: bool,
    pub del: Option<Vec<Key>>,
    pub fam: Option<FamId>,
    pub s: bool,
    pub shell_array: bool,
}

/// A family's row key (`fam.key`): the normalized key fn of a field, or
/// `null` (positional).
pub(in crate::slice1) type FamKey = Option<Rc<str>>;

/// Solid: target.ts:23-56 `StoreFamily`.
pub(in crate::slice1) struct Family {
    pub opt: bool,
    pub overlaid: Option<OrdSet<TargetId>>,
    pub asked: Option<i64>,
    pub key: FamKey,
    /// `map`: raw (or a draft wrapper) → target, by identity.
    pub map: HashMap<u64, TargetId>,
    pub node: Option<NodeId>,
    pub live: OrdSet<TargetId>,
    pub shallow: bool,
    pub run: u32,
    pub woke: bool,
    pub w: u32,
}

/// The identity a lookup map keys an object by.
// Solid: target.ts:153 (`storeLookup` / `fam.map` are WeakMaps by identity)
pub(in crate::slice1) fn ident(v: &Value) -> Option<u64> {
    match v {
        Value::Obj(o) => Some(o.id),
        Value::Draft(d) => Some(d.id),
        _ => None,
    }
}

impl Runtime {
    // Solid: target.ts:155-157
    pub(in crate::slice1) fn set_lookup(&mut self, raw: &Value, t: TargetId) {
        let id = ident(raw).expect("a lookup key is an object");
        match self.store.targets[t].fam {
            Some(f) => self.store.families[f].map.insert(id, t),
            None => self.store.lookup.insert(id, t),
        };
    }

    // Solid: target.ts:159-161 (`raw[$OWNER] !== undefined`: a proxy's and a
    // draft wrapper's traps answer `undefined`)
    pub(in crate::slice1) fn is_owned(&self, raw: &Value) -> bool {
        matches!(raw, Value::Obj(o) if o.owner().is_some())
    }

    // Solid: target.ts:165-168
    pub(in crate::slice1) fn lookup_target(
        &self,
        raw: &Value,
        fam: Option<FamId>,
    ) -> Option<TargetId> {
        if let Value::Obj(o) = raw {
            if let Some(owner) = o.owner() {
                if self.store.targets[owner].fam == fam {
                    return Some(owner);
                }
            }
        }
        let id = ident(raw)?;
        match fam {
            Some(f) => self.store.families[f].map.get(&id).copied(),
            None => self.store.lookup.get(&id).copied(),
        }
    }

    /// `(fam?.map ?? storeLookup).delete(raw)`.
    // Solid: reconcile.ts:326 (`(fam?.map ?? storeLookup).delete(raw)`)
    pub(in crate::slice1) fn delete_lookup(&mut self, raw: &Value, fam: Option<FamId>) {
        let Some(id) = ident(raw) else { return };
        match fam {
            Some(f) => self.store.families[f].map.remove(&id),
            None => self.store.lookup.remove(&id),
        };
    }

    // Solid: target.ts:185-191
    pub(in crate::slice1) fn mark_descendants(&mut self, target: TargetId) {
        let mut t = Some(target);
        while let Some(x) = t {
            if self.store.targets[x].d {
                break;
            }
            self.store.targets[x].d = true;
            t = self.store.targets[x].u;
        }
    }
}

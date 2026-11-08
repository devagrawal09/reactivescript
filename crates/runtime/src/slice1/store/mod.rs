//! Solid: store/*.ts — stores: plain (`store.ts`), reconcile
//! (`reconcile.ts`), optimistic (`optimistic.ts`) and derived
//! (`projection.ts`) ones, over the target model of `target.ts`.
//!
//! One Rust module per Solid file. The module-level `let`s of those files
//! are `StoreState` fields on the runtime. The optional-machinery slots of
//! `hooks.ts` (`optHooks`) are always installed in the prod bundle, so the
//! hook calls are direct calls here; `affectsHooks` stays null (no
//! `affects()`), and the dev/observe tiers are folded away (prod build).
//!
//! Not ported (unreached by tiers B and C; each arm panics "not ported"
//! where it would be taken): accessor properties (getters/setters on store
//! data), prototype-overlay drafts (records over 32 keys), chained backings
//! (a store over another store's proxy, §7b), shallow derived families,
//! `deep()` /
//! `snapshot`, `ownKeys` / descriptor traps, and a derive that writes its
//! draft (`pairRows`, the draft's write override).
pub(super) mod optimistic;
pub(super) mod projection;
pub(super) mod reconcile;
#[allow(clippy::module_inception)]
pub(super) mod store;
pub(super) mod target;
pub(super) mod types;

use super::*;
use std::{cell::RefCell, collections::HashMap};
use target::{Family, StoreTarget};

/// A family's row key option (`options.key`): a field name (`"id"` by
/// default) or `null` (positional).
#[derive(Clone, Debug)]
pub enum StoreKey {
    Field(Rc<str>),
    Positional,
}

/// A JS `Set` (insertion order; an iteration skips entries deleted before
/// it reaches them and visits entries added during it).
#[derive(Clone)]
pub(in crate::slice1) struct OrdSet<T: Copy + PartialEq> {
    items: Vec<Option<T>>,
    size: usize,
}
impl<T: Copy + PartialEq> Default for OrdSet<T> {
    fn default() -> Self {
        OrdSet {
            items: vec![],
            size: 0,
        }
    }
}
impl<T: Copy + PartialEq> OrdSet<T> {
    pub fn has(&self, x: T) -> bool {
        self.items.contains(&Some(x))
    }
    pub fn add(&mut self, x: T) {
        if !self.has(x) {
            self.items.push(Some(x));
            self.size += 1;
        }
    }
    pub fn delete(&mut self, x: T) -> bool {
        match self.items.iter().position(|y| *y == Some(x)) {
            Some(i) => {
                self.items[i] = None;
                self.size -= 1;
                true
            }
            None => false,
        }
    }
    pub fn clear(&mut self) {
        self.items.clear();
        self.size = 0;
    }
    pub fn size(&self) -> usize {
        self.size
    }
    /// The entry at iteration cursor `i`: `None` past the end, `Some(None)`
    /// for a deleted one.
    pub fn at(&self, i: usize) -> Option<Option<T>> {
        self.items.get(i).copied()
    }
    pub fn values(&self) -> Vec<T> {
        self.items.iter().flatten().copied().collect()
    }
}

/// A null-prototype record keyed by property keys (`Object.create(null)`):
/// `Reflect.ownKeys` order (integer keys ascending, then the rest in
/// insertion order).
#[derive(Clone)]
pub(in crate::slice1) struct KeyMap<V: Clone> {
    idx: std::collections::BTreeMap<u32, V>,
    names: Vec<(Key, V)>,
}
impl<V: Clone> Default for KeyMap<V> {
    fn default() -> Self {
        KeyMap {
            idx: Default::default(),
            names: vec![],
        }
    }
}
impl<V: Clone> KeyMap<V> {
    pub fn get(&self, k: &Key) -> Option<V> {
        match k {
            Key::Idx(i) => self.idx.get(i).cloned(),
            _ => self
                .names
                .iter()
                .find(|(m, _)| m == k)
                .map(|(_, v)| v.clone()),
        }
    }
    pub fn insert(&mut self, k: Key, v: V) {
        match k {
            Key::Idx(i) => {
                self.idx.insert(i, v);
            }
            k => match self.names.iter_mut().find(|(m, _)| *m == k) {
                Some(slot) => slot.1 = v,
                None => self.names.push((k, v)),
            },
        }
    }
    pub fn remove(&mut self, k: &Key) {
        match k {
            Key::Idx(i) => {
                self.idx.remove(i);
            }
            k => self.names.retain(|(m, _)| m != k),
        }
    }
    /// `Reflect.ownKeys(record)`.
    pub fn keys(&self) -> Vec<Key> {
        let mut out: Vec<Key> = self.idx.keys().map(|i| Key::Idx(*i)).collect();
        let (strs, syms): (Vec<_>, Vec<_>) = self
            .names
            .iter()
            .partition(|(k, _)| matches!(k, Key::Name(_)));
        out.extend(strs.into_iter().map(|(k, _)| k.clone()));
        out.extend(syms.into_iter().map(|(k, _)| k.clone()));
        out
    }
    pub fn len(&self) -> usize {
        self.idx.len() + self.names.len()
    }
}

/// One setter's written keys (`WrittenKeys`, target.ts:60-62): `u` chains
/// the batch's earlier setters' sets.
pub(in crate::slice1) struct WkSet {
    pub keys: Vec<Key>,
    pub u: Option<WkRef>,
}
pub(in crate::slice1) type WkRef = Rc<RefCell<WkSet>>;
/// `t.wk`: a written-keys set, or `WK_ALL` (an array length write).
#[derive(Clone)]
pub(in crate::slice1) enum Wk {
    All,
    Set(WkRef),
}

/// `scopeKey(target)`: a family, or a plain store's root target.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(in crate::slice1) enum ScopeKey {
    Fam(FamId),
    Root(TargetId),
}

/// A slot node's key (`_key`): a property key, `$TRACK` (the container) or
/// `$DEEP` (the deep witness, made only by `deep()`, which is not ported:
/// `t.dk` stays null).
#[derive(Clone, PartialEq, Debug)]
pub(in crate::slice1) enum SlotKey {
    Key(Key),
    Track,
    #[allow(dead_code)]
    Deep,
}

/// The module-level state of store.ts, optimistic.ts and projection.ts.
#[derive(Default)]
pub(in crate::slice1) struct StoreState {
    pub targets: Vec<StoreTarget>,
    pub families: Vec<Family>,
    /// target.ts `storeLookup` (raw → target for family-less stores).
    pub lookup: HashMap<u64, TargetId>,
    // store.ts
    pub deferred_releases: OrdSet<NodeId>,
    pub fold_list: Vec<TargetId>,
    pub fold_olds: Vec<Obj>,
    pub direct_commit: bool,
    pub held_derivation_hit: bool,
    pub user_write: bool,
    pub writing: u32,
    pub write_scopes: Option<Vec<ScopeKey>>,
    pub pending_notify: OrdSet<TargetId>,
    /// `frameRaws`: `Object.values(frame)` per frame, by identity.
    pub frame_raws: HashMap<u64, Vec<Value>>,
    // types.ts
    pub write_override: bool,
    /// `rawValues` (a WeakSet, by identity) and `rawValuesUsed`.
    pub raw_values: std::collections::HashSet<u64>,
    pub raw_values_used: bool,
    // optimistic.ts
    pub opt_staged: Vec<(TargetId, Obj)>,
    pub overlaid_families: OrdSet<FamId>,
    pub held_c: Option<NodeId>,
    pub held_at: u64,
    pub held_v: u8,
}

impl Runtime {
    // Solid: target.ts:64-133 (a target's fields)
    pub(in crate::slice1) fn st(&self, t: TargetId) -> &StoreTarget {
        &self.store.targets[t]
    }
    // Solid: target.ts:64-133 (a target's fields)
    pub(in crate::slice1) fn stm(&mut self, t: TargetId) -> &mut StoreTarget {
        &mut self.store.targets[t]
    }
    /// `getObserver()` (owner.ts:306-308).
    pub(in crate::slice1) fn get_observer(&self) -> Option<NodeId> {
        if self.tracking {
            self.context
        } else {
            None
        }
    }

    /// A token for an identity: the target a proxy wraps.
    // Solid: store.ts:199 (`t.px`: one proxy per target)
    pub fn proxy_identity(&self, v: &Value) -> u64 {
        match v {
            Value::Proxy(t) => *t as u64,
            _ => unreachable!("a proxy"),
        }
    }

    /// `o[k]` for any value: a store proxy's `get` trap, a draft wrapper's,
    /// a raw object's own property or its prototype's; `undefined` for a
    /// primitive.
    // Solid: store.ts:2088-2262 (a proxy's `get` trap); projection.ts:109-114 (a draft's)
    pub fn js_get(&mut self, o: &Value, k: &Key) -> Result<Value, Error> {
        match o {
            Value::Obj(x) => Ok(x.get(k)),
            Value::Proxy(t) => self.trap_get(*t, k),
            Value::Draft(d) => self.draft_get(d, k),
            Value::Undef | Value::Int(_) | Value::Bool(_) => Ok(Value::Undef),
            // A string's own `length` and index properties; the probes the
            // runtime makes on any value (`then`, `Symbol.asyncIterator`,
            // async.ts) are `undefined` on `String.prototype`. Its methods
            // are not values of this domain.
            Value::Str(s) => match Value::str_get(s, k) {
                Some(v) => Ok(v),
                None if matches!(k, Key::Idx(_) | Key::Sym(_)) || k.is("then") => Ok(Value::Undef),
                None => panic!(
                    "a read of String.prototype.{} is outside the op language",
                    k.text()
                ),
            },
            // A host node: the runtime's probes only (`then`,
            // `Symbol.asyncIterator`); the renderer owns its properties.
            Value::Node(_) if matches!(k, Key::Sym(_)) || k.is("then") => Ok(Value::Undef),
            // `valueInserts`' `v.nodeType > 0` (verdict.ts:836-840): the
            // recording host's nodes, like the JS hosts it mirrors
            // (`fuzz/universal.mjs` `FakeNode`, the reference string
            // renderer's `{kind, …}` objects), have no `nodeType`. A DOM
            // host's would be 1 and reach `bornHeldOpen`, which is not
            // ported (docs/PLAN-V2-CONSUMER.md, "Gaps").
            Value::Node(_) if k.is("nodeType") => Ok(Value::Undef),
            other => panic!("a property read of {other:?} is outside the op language"),
        }
    }
    /// `k in o`.
    // Solid: store.ts:2264-2293 (a proxy's `has` trap)
    pub fn js_has(&mut self, o: &Value, k: &Key) -> Result<bool, Error> {
        match o {
            Value::Obj(x) => Ok(x.has(k)),
            Value::Proxy(t) => self.trap_has(*t, k),
            other => panic!("`in` on {other:?} is outside the op language"),
        }
    }
    /// `o[k] = v`.
    // Solid: store.ts:2342-2386 (a proxy's `set` trap)
    pub fn js_set(&mut self, o: &Value, k: &Key, v: Value) -> Result<(), Error> {
        match o {
            Value::Obj(x) => {
                x.set(k, v);
                Ok(())
            }
            Value::Proxy(t) => self.trap_set(*t, k, v),
            other => panic!("a write to {other:?} is outside the op language"),
        }
    }
    /// `delete o[k]`.
    // Solid: store.ts:2407-2433 (a proxy's `deleteProperty` trap)
    pub fn js_delete(&mut self, o: &Value, k: &Key) -> Result<(), Error> {
        match o {
            Value::Obj(x) => {
                x.delete(k);
                Ok(())
            }
            Value::Proxy(t) => self.trap_delete(*t, k),
            other => panic!("a delete on {other:?} is outside the op language"),
        }
    }
    /// `Array.isArray(o)`: a proxy answers by its shell.
    // Solid: store.ts:199 (the proxy's shell: `Array.isArray(value) ? [] : {}`)
    pub fn is_array(&self, o: &Value) -> bool {
        match o {
            Value::Obj(x) => x.array,
            Value::Proxy(t) => self.st(*t).shell_array,
            Value::Draft(d) => self.is_array(&d.inner),
            _ => false,
        }
    }

    /// `createStore(value)` (index.ts:103-106 → store.ts:2576-2615).
    pub fn create_store(&mut self, v: Value, shallow: bool) -> Value {
        self.create_plain_store(v, shallow)
    }
    /// `createOptimisticStore(value, {key})` (optimistic.ts:895-916).
    pub fn create_optimistic_store(&mut self, v: Value, key: StoreKey) -> Value {
        self.create_optimistic_store_internal(None, v, key, false)
    }
    /// `createOptimisticStore(fn, seed, {key, seedLoadingValue})`.
    pub fn create_optimistic_store_derived(
        &mut self,
        f: BodyFn,
        seed: Value,
        key: StoreKey,
        seed_loading: bool,
    ) -> Value {
        self.create_optimistic_store_internal(Some(f), seed, key, seed_loading)
    }
    /// The setter: `storeSetter(proxy, fn)` (store.ts:2613; optimistic.ts:911-914).
    pub fn store_set(
        &mut self,
        proxy: &Value,
        f: &mut dyn FnMut(&mut Runtime, Value) -> Result<Value, Error>,
    ) -> Result<(), Error> {
        self.store_setter(proxy, f, true)
    }
    /// `set(reconcile(value, key))` (index.ts:113-118).
    pub fn store_reconcile(&mut self, proxy: &Value, v: Value, key: StoreKey) -> Result<(), Error> {
        let key = match key {
            StoreKey::Field(f) => Some(f),
            StoreKey::Positional => None,
        };
        self.store_setter(
            proxy,
            &mut |rt: &mut Runtime, state: Value| {
                rt.reconcile_state(&v, &state, key.clone(), false)?;
                Ok(Value::Undef)
            },
            true,
        )
    }
    /// `refresh(proxy)` (signals.ts:923-1004): `$REFRESH` is the family's
    /// derive node; a store with none resolves at once.
    pub fn refresh_store(&mut self, proxy: &Value) {
        let Value::Proxy(t) = proxy else {
            panic!("refresh of a non-store")
        };
        let node = self.st(*t).fam.and_then(|f| self.store.families[f].node);
        if let Some(node) = node {
            self.refresh(node);
        }
    }
}

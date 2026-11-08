//! Solid: store/store.ts — plain stores on L2: targets and proxies, slot
//! nodes, the pending backing and its fold, write-time notification,
//! visibility (which backing a read serves), the proxy traps, and shallow
//! stores (`s`: values served verbatim, raw-marked records, the list
//! driver's `shallowView`).
//!
//! Not ported (each arm panics "not ported" where it would be taken):
//! accessor keys (`acc`, FORCE), prototype-overlay drafts (`ovl`, records
//! over 32 keys), chained backings (`ch`), shallow families, the deep
//! witness's readers (`deep()`), `ownKeys`/descriptor traps, the observe
//! and dev tiers, `affects()` hooks (`affectsHooks` is null) and snapshots.
use super::super::*;
use super::target::StoreTarget;
use super::{KeyMap, ScopeKey, SlotKey, Wk, WkSet};
use std::cell::RefCell;

/// `OVERLAY_MIN_KEYS` (store.ts:661).
const OVERLAY_MIN_KEYS: usize = 32;

/// `protoOf(o)` for the values a store meets.
#[derive(PartialEq, Eq, Clone, Copy)]
enum Proto {
    Object,
    Array,
    LaneView,
}

/// The backing a value is, as raw: a backing is always a raw object here
/// (a chained backing — another store's proxy — is not ported).
// Solid: target.ts:64-70 (`v`/`pb` are raw records; a chained backing, §7b, is not ported)
pub(in crate::slice1) fn raw(v: &Value) -> Obj {
    match v {
        Value::Obj(o) => o.clone(),
        Value::Proxy(_) | Value::Draft(_) => {
            panic!("a chained backing (a store proxy as a backing, §7b) is not ported")
        }
        other => panic!("a backing that is not an object ({other:?})"),
    }
}

impl Runtime {
    // Solid: store.ts:2437-2439 (the `getPrototypeOf` trap: the backing's)
    pub(in crate::slice1) fn trap_get_prototype_of(&self, t: TargetId) -> Value {
        Value::Obj(self.st(t).v.clone())
    }

    // Solid: store.ts:667-670 (`plainProto`): the prototype of `o` is
    // `Object.prototype`, `Array.prototype` or null.
    pub(in crate::slice1) fn plain_proto(&self, o: &Value) -> bool {
        self.proto_of(o) != Proto::LaneView
    }

    // Solid: store.ts:573 (`protoOf`)
    fn proto_of(&self, v: &Value) -> Proto {
        match v {
            Value::Obj(o) if o.array => Proto::Array,
            Value::Obj(_) => Proto::Object,
            Value::View(_) => Proto::LaneView,
            Value::NotPending => Proto::Object,
            Value::Proxy(t) => {
                if self.st(*t).v.array {
                    Proto::Array
                } else {
                    Proto::Object
                }
            }
            other => panic!("protoOf({other:?})"),
        }
    }

    /// `value[$TARGET]`: a proxy's target (a draft wrapper answers its
    /// inner store's); `undefined` for anything else.
    // Solid: store.ts:2093 (`$TARGET` answered by the trap); projection.ts:109-114 for a draft wrapper
    pub(in crate::slice1) fn target_of(&self, v: &Value) -> Option<TargetId> {
        match v {
            Value::Proxy(t) => Some(*t),
            Value::Draft(d) => self.target_of(&d.inner),
            _ => None,
        }
    }

    // Solid: store.ts:157-203 (`TargetShape`, `createTarget`)
    pub(in crate::slice1) fn create_target(
        &mut self,
        value: &Value,
        parent: Option<TargetId>,
        parent_key: Option<Key>,
        fam: Option<FamId>,
    ) -> TargetId {
        let v = raw(value);
        let t = self.store.targets.len();
        let shell_array = v.array;
        self.store.targets.push(StoreTarget {
            v,
            // `value[$TARGET] !== undefined`: a raw object has no brand.
            ch: false,
            pb: None,
            n: None,
            h: None,
            k: None,
            dk: None,
            u: parent,
            pk: parent_key,
            d: false,
            a: false,
            sc: 0,
            kc: 0,
            nc: 0,
            fam,
            s: false,
            ovl: false,
            del: None,
            wk: None,
            shell_array,
        });
        self.set_lookup(value, t);
        t
    }

    // Solid: store.ts:205-224 (`rawValuesUsed` is false: nothing is
    // markRaw'd)
    pub(in crate::slice1) fn wrap(
        &mut self,
        value: &Value,
        parent: Option<TargetId>,
        parent_key: Option<Key>,
        fam: Option<FamId>,
    ) -> Value {
        // markRaw'd values never wrap through any store (R42).
        if self.store.raw_values_used && self.is_raw_value(value) {
            return value.clone();
        }
        if let Some(existing) = self.lookup_target(value, fam) {
            return Value::Proxy(existing);
        }
        if let Some(t) = self.target_of(value) {
            if *value == Value::Proxy(t) {
                if fam.is_none() || self.st(t).fam == fam {
                    return value.clone();
                }
                panic!(
                    "re-wrapping a foreign family's proxy (a chained target, §7b) is not ported"
                );
            }
        }
        Value::Proxy(self.create_target(value, parent, parent_key, fam))
    }

    // Solid: store.ts:230-241
    pub(in crate::slice1) fn unwrap_value(&mut self, v: &Value) -> Value {
        if !v.is_object() {
            return v.clone();
        }
        let Some(t) = self.target_of(v) else {
            return v.clone();
        };
        let fam = self.st(t).fam;
        if *v == Value::Proxy(t) || self.lookup_target(v, fam) == Some(t) {
            if self.st(t).ovl {
                self.materialize_pb(t);
            }
            let target = self.st(t);
            return Value::Obj(target.pb.clone().unwrap_or_else(|| target.v.clone()));
        }
        v.clone()
    }

    // Solid: store.ts:252-254 (`slotNodeEquals`, `this` the node)
    pub(in crate::slice1) fn slot_node_equals(&self, node: NodeId, a: &Value, b: &Value) -> bool {
        a == b || self.same_logical_slot(self.nodes[node].host.expect("a slot node"), a, b)
    }

    // Solid: store.ts:294-296 (`containerEquals`)
    pub(in crate::slice1) fn container_equals(&self, node: NodeId, a: &Value, b: &Value) -> bool {
        a == b || self.arrangement(self.nodes[node].host.expect("a slot node"), a, b)
    }

    // Solid: store.ts:298-302
    fn same_logical_slot(&self, target: TargetId, a: &Value, b: &Value) -> bool {
        if !a.is_object() || !b.is_object() {
            return false;
        }
        let fam = self.st(target).fam;
        let at = self.lookup_target(a, fam);
        at.is_some() && at == self.lookup_target(b, fam)
    }

    // Solid: store.ts:308-328
    pub(in crate::slice1) fn release_slot(&mut self, node: NodeId) {
        let t = self.nodes[node].host.expect("a slot node");
        let key = self.nodes[node].key.clone();
        let target = self.stm(t);
        match &key {
            SlotKey::Track => {
                if target.k == Some(node) {
                    target.k = None;
                }
            }
            SlotKey::Deep => {
                if target.dk == Some(node) {
                    target.dk = None;
                }
            }
            SlotKey::Key(k) => {
                if target.n.as_ref().and_then(|n| n.get(k)) == Some(node) {
                    target.n.as_mut().unwrap().remove(k);
                    target.nc -= 1;
                } else if target.h.as_ref().and_then(|h| h.get(k)) == Some(node) {
                    target.h.as_mut().unwrap().remove(k);
                }
            }
        }
        let target = self.st(t);
        if let Some(f) = target.fam {
            if target.nc == 0
                && target.k.is_none()
                && target.dk.is_none()
                && target.h.as_ref().is_none_or(|h| h.len() == 0)
            {
                self.store.families[f].live.delete(t);
            }
        }
    }

    // Solid: store.ts:331-335 (`affectsHooks` is null)
    fn note_node(&mut self, target: TargetId) {
        if let Some(f) = self.st(target).fam {
            self.store.families[f].live.add(target);
        }
        self.mark_descendants(target);
    }

    // Solid: store.ts:345-348
    pub(in crate::slice1) fn slot_kept(&self, node: NodeId) -> bool {
        let n = &self.nodes[node];
        n.pending.is_some()
            || n.config & CONFIG_OVERRIDE != 0
            || self
                .st(n.host.expect("a slot node"))
                .k
                .is_some_and(|k| self.nodes[k].config & CONFIG_HELD != 0)
    }

    // Solid: store.ts:349-352 (`setSlotUnobserved`'s handler)
    pub(in crate::slice1) fn slot_unobserved(&mut self, node: NodeId) {
        if self.slot_kept(node) {
            self.store.deferred_releases.add(node);
        } else {
            self.release_slot(node);
        }
    }

    // Solid: core.ts:1679-1724 (`slotSignal`)
    fn slot_signal(
        &mut self,
        v: Value,
        eq: Equals,
        host: TargetId,
        key: SlotKey,
        acc: bool,
    ) -> NodeId {
        let n = self.add_node(Kind::Signal, v);
        let node = &mut self.nodes[n];
        node.eq = eq;
        node.config = CONFIG_OWNED_WRITE | CONFIG_SLOT_NODE;
        node.host = Some(host);
        node.key = key;
        node.acc = acc;
        n
    }

    // Solid: store.ts:359-387
    fn born_staged(&mut self, target: TargetId, node: NodeId, staged: Value, key: &Key) {
        if self.has_equals(node) && self.equals(node, &self.nodes[node].value.clone(), &staged) {
            return;
        }
        self.queue_pending_node(node);
        self.nodes[node].pending = Some(staged);
        let Some(k) = self.st(target).k else { return };
        if self.nodes[k].config & (CONFIG_OVERRIDE | CONFIG_GUESS) == CONFIG_OVERRIDE {
            let l = self.tx_of(k);
            self.hold_with_derive(target, node, Some(l));
        } else if self.nodes[k].config & CONFIG_HELD != 0
            && self.held_key_changed(target, key, true)
        {
            let l = self.tx_of(k);
            if self.nodes[k].config & CONFIG_OVERRIDE == 0 || self.txs[l].folded {
                let t = self.txs[l].parent.unwrap_or(l);
                let t = self.resolve_tx(t);
                self.hold_node(node, t);
            }
        }
        if self.nodes[k].config & CONFIG_PROMOTED != 0 {
            self.note_promoted_write(node);
        }
    }

    // Solid: store.ts:389-431 (`__OBSERVE__` naming folded away)
    pub(in crate::slice1) fn get_node(
        &mut self,
        target: TargetId,
        key: &Key,
        acc_known: i8,
    ) -> NodeId {
        if self.st(target).n.is_none() {
            self.stm(target).n = Some(KeyMap::default());
        }
        if let Some(node) = self.st(target).n.as_ref().unwrap().get(key) {
            return node;
        }
        let pb = self.st(target).pb.clone();
        let committed = self.committed(target);
        let acc = if acc_known == -1 {
            self.is_own_accessor(pb.as_ref().unwrap_or(&self.st(target).v), key)
        } else {
            acc_known == 1
        };
        let created = self.slot_signal(
            committed.get(key),
            Equals::Slot,
            target,
            SlotKey::Key(key.clone()),
            acc,
        );
        if let Some(pb) = pb {
            if !self.nodes[created].acc {
                let deleted = self
                    .st(target)
                    .del
                    .as_ref()
                    .is_some_and(|d| d.contains(key));
                let staged = if deleted { Value::Undef } else { pb.get(key) };
                self.born_staged(target, created, staged, key);
            }
        }
        self.stm(target)
            .n
            .as_mut()
            .unwrap()
            .insert(key.clone(), created);
        self.stm(target).nc += 1;
        self.note_node(target);
        created
    }

    // Solid: store.ts:433-445
    pub(in crate::slice1) fn get_has_node(&mut self, target: TargetId, key: &Key) -> NodeId {
        if self.st(target).h.is_none() {
            self.stm(target).h = Some(KeyMap::default());
        }
        if let Some(node) = self.st(target).h.as_ref().unwrap().get(key) {
            return node;
        }
        let present = self.committed(target).has(key);
        let created = self.slot_signal(
            Value::Bool(present),
            Equals::IsEqual,
            target,
            SlotKey::Key(key.clone()),
            false,
        );
        if let Some(pb) = self.st(target).pb.clone() {
            let deleted = self
                .st(target)
                .del
                .as_ref()
                .is_some_and(|d| d.contains(key));
            self.born_staged(target, created, Value::Bool(pb.has(key) && !deleted), key);
        }
        self.stm(target)
            .h
            .as_mut()
            .unwrap()
            .insert(key.clone(), created);
        self.note_node(target);
        created
    }

    // Solid: store.ts:450-467
    pub(in crate::slice1) fn get_container_node(&mut self, target: TargetId) -> NodeId {
        if let Some(k) = self.st(target).k {
            return k;
        }
        let v = Value::Obj(self.st(target).v.clone());
        let k = self.slot_signal(v, Equals::Container, target, SlotKey::Track, false);
        self.stm(target).k = Some(k);
        self.note_node(target);
        if let Some(pb) = self.st(target).pb.clone() {
            if !self.store.direct_commit {
                self.nodes[k].value = Value::Obj(self.pre_batch(target));
                self.nodes[k].pending = Some(Value::Obj(pb));
                self.queue_pending_node(k);
            }
        }
        k
    }

    // Solid: store.ts:479-494
    fn stage_on(&mut self, target: TargetId, pb: &Obj) {
        if self.st(target).k.is_none()
            && self.pass_lane.is_none()
            && (self.context.is_none() || self.running)
            && !self.derive_holds(target)
        {
            return;
        }
        let k = self.get_container_node(target);
        if self.nodes[k].pending.is_none() {
            self.queue_pending_node(k);
        }
        self.nodes[k].pending = Some(Value::Obj(pb.clone()));
        if self.context.is_some() {
            self.note_promoted_write(k);
        }
        if self.st(target).fam.is_some() && !self.store.user_write {
            let lane = self.pass_lane;
            self.hold_with_derive(target, k, lane);
        }
    }

    // Solid: store.ts:498-501
    fn derive_holds(&self, target: TargetId) -> bool {
        let fw = self
            .st(target)
            .fam
            .and_then(|f| self.store.families[f].node);
        fw.is_some_and(|fw| !self.store.user_write && self.nodes[fw].config & CONFIG_HELD != 0)
    }

    // Solid: store.ts:503-509 (`storePark`, the scheduler's `storeParkHook`)
    pub(in crate::slice1) fn store_park(&mut self, t: TxId) {
        let mut i = 0;
        while i < self.store.fold_list.len() {
            let target = self.store.fold_list[i];
            i += 1;
            if self.st(target).k.is_none() && self.st(target).pb.is_some() {
                let k = self.get_container_node(target);
                self.hold_node(k, t);
            }
        }
        self.opt_park(t);
    }

    // Solid: store.ts:521-523 (the deep witness exists only for `deep()`)
    fn bump_deep(&mut self, t: TargetId) {
        if self.st(t).dk.is_some() {
            panic!("the deep witness (deep()) is not ported");
        }
    }

    // Solid: store.ts:529-541 (no snapshot capture)
    fn notify_container(&mut self, k: NodeId, pb: &Obj) {
        if self.nodes[k].config & CONFIG_OVERRIDE != 0 {
            self.set_signal(k, Value::Obj(pb.clone()));
        } else {
            if self.nodes[k].config & CONFIG_HELD != 0 {
                let t = self.tx_of(k);
                self.join_future(Some(t));
            }
            self.insert_subs(k);
            self.schedule();
        }
    }

    // Solid: store.ts:579-584. Store data here is plain: no accessor
    // properties exist.
    fn is_own_accessor(&self, _src: &Obj, _key: &Key) -> bool {
        false
    }

    // Solid: store.ts:588-623. Both clone paths (the spread of plain data,
    // the `slice()` or descriptor copy of an array) copy the own data
    // properties; the stamp is then the target's.
    pub(in crate::slice1) fn clone_raw(&mut self, source: &Obj, t: TargetId) -> Obj {
        if self.st(t).sc == 0 {
            self.scan_accessors_once(t);
        }
        let clone = source.shallow_clone();
        clone.set_owner(Some(t));
        clone
    }

    // Solid: store.ts:642-657 (no accessors: plain records grade 2; arrays,
    // whose prototype is not `Object.prototype`, grade 1)
    fn scan_accessors_once(&mut self, target: TargetId) -> bool {
        let src = self.st(target).v.clone();
        let plain = !src.array;
        let t = self.stm(target);
        t.sc = if plain { 2 } else { 1 };
        t.kc = src.own_key_count();
        !t.a
    }

    // Solid: store.ts:688-701 (an overlay is never made: see `ensure_pb`)
    fn materialize_pb(&mut self, target: TargetId) -> Obj {
        if self.st(target).ovl {
            panic!("prototype-overlay drafts (#3044) are not ported");
        }
        self.st(target).pb.clone().expect("a pending backing")
    }

    // Solid: store.ts:706-738
    pub(in crate::slice1) fn ensure_pb(&mut self, target: TargetId) -> Obj {
        let pb = self.st(target).pb.clone();
        if self.store.user_write
            && self
                .st(target)
                .fam
                .is_some_and(|f| self.store.families[f].opt)
            && !self.store.pending_notify.has(target)
        {
            let d = self.optimistic_draft(target);
            self.stm(target).pb = Some(d.clone());
            return d;
        }
        match pb {
            Some(pb) if !self.is_owned(&Value::Obj(pb.clone())) => {
                let pb = self.clone_raw(&pb, target);
                self.stm(target).pb = Some(pb.clone());
                if let Some(k) = self.st(target).k {
                    if self.nodes[k].config & CONFIG_HELD == 0 {
                        self.nodes[k].pending = Some(Value::Obj(pb.clone()));
                    }
                }
                pb
            }
            Some(pb) => pb,
            None => {
                let v = self.st(target).v.clone();
                if !self.store.direct_commit {
                    self.queue_fold(target);
                }
                let overlay = !self.st(target).ch
                    && !v.array
                    && (if self.st(target).sc != 0 {
                        !self.st(target).a
                    } else {
                        self.scan_accessors_once(target)
                    })
                    && self.st(target).kc > OVERLAY_MIN_KEYS
                    && self.is_owned(&Value::Obj(v.clone()));
                if overlay {
                    panic!("prototype-overlay drafts (#3044) are not ported");
                }
                let pb = self.clone_raw(&v, target);
                self.stm(target).pb = Some(pb.clone());
                if !self.store.direct_commit {
                    self.stage_on(target, &pb);
                }
                pb
            }
        }
    }

    // Solid: store.ts:742-757
    fn privatize_committed(&mut self, target: TargetId) {
        let before = self.st(target).v.clone();
        if self.is_owned(&Value::Obj(before.clone())) {
            return;
        }
        let clone = self.clone_raw(&before, target);
        self.stm(target).v = clone;
        self.stm(target).ch = false;
        if let Some(u) = self.st(target).u {
            self.privatize_committed(u);
            let pv = self.st(u).v.clone();
            let slot = self.parent_slot_key(target, &Value::Obj(before.clone()));
            if pv.get(&slot) == Value::Obj(before) {
                pv.set(&slot, Value::Obj(self.st(target).v.clone()));
            }
        }
    }

    // Solid: store.ts:764-772
    fn parent_slot_key(&mut self, target: TargetId, expected: &Value) -> Key {
        let pk = self
            .st(target)
            .pk
            .clone()
            .expect("a child target has a key");
        let pv = self.st(self.st(target).u.unwrap()).v.clone();
        let tv = Value::Obj(self.st(target).v.clone());
        if pv.get(&pk) == *expected || pv.get(&pk) == tv || !pv.array {
            return pk;
        }
        let Some(at) = pv.elements().iter().position(|x| x == expected) else {
            return pk;
        };
        let at = Key::Idx(at as u32);
        self.stm(target).pk = Some(at.clone());
        at
    }

    // Solid: store.ts:809-844
    pub(in crate::slice1) fn adopt_pb(&mut self, target: TargetId, incoming: &Obj, notify: bool) {
        if !self.store.direct_commit {
            self.queue_fold(target);
        }
        let base = match self.st(target).pb.clone() {
            Some(_) => {
                if self.st(target).ovl {
                    self.materialize_pb(target);
                }
                self.st(target).pb.clone().unwrap()
            }
            None => self.st(target).v.clone(),
        };
        if self.store.direct_commit {
            self.stm(target).pb = None;
            if let Some(k) = self.st(target).k {
                self.nodes[k].value = Value::Obj(incoming.clone());
            }
        } else {
            self.stm(target).pb = Some(incoming.clone());
            self.stage_on(target, incoming);
        }
        let t = self.stm(target);
        t.v = incoming.clone();
        t.ch = false;
        t.ovl = false;
        t.del = None;
        t.sc = 0;
        t.a = false;
        t.wk = None;
        let fam = t.fam;
        match incoming.owner() {
            Some(owner) if self.st(owner).fam == fam => incoming.set_owner(Some(target)),
            _ => self.set_lookup(&Value::Obj(incoming.clone()), target),
        }
        if notify && !Rc::ptr_eq(&base, incoming) {
            self.notify_fold(target, &base, incoming);
        }
    }

    // Solid: store.ts:883-889
    fn queue_fold(&mut self, target: TargetId) {
        if self.st(target).pb.is_some() {
            return;
        }
        self.schedule();
        self.store.fold_list.push(target);
        let v = self.st(target).v.clone();
        self.store.fold_olds.push(v);
    }

    // Solid: store.ts:892-899 (the index map is a search: a target is
    // queued at most once per list)
    fn pre_batch(&self, t: TargetId) -> Obj {
        match self.store.fold_list.iter().position(|x| *x == t) {
            Some(at) => self.store.fold_olds[at].clone(),
            None => self.st(t).v.clone(),
        }
    }

    // Solid: store.ts:906-936
    fn drain_folds(&mut self) {
        if !self.store.fold_list.is_empty() {
            let list = std::mem::take(&mut self.store.fold_list);
            let olds = std::mem::take(&mut self.store.fold_olds);
            for (t, old) in list.into_iter().zip(olds) {
                if self.st(t).pb.is_none() {
                    continue;
                }
                let k = self.st(t).k;
                if k.is_some_and(|k| self.nodes[k].pending.is_some()) {
                    self.store.fold_list.push(t);
                    self.store.fold_olds.push(old);
                } else {
                    self.fold_target(t, &old);
                }
            }
        }
        if self.store.deferred_releases.size() != 0 {
            let mut i = 0;
            while let Some(entry) = self.store.deferred_releases.at(i) {
                i += 1;
                let Some(node) = entry else { continue };
                if self.nodes[node].subs.is_none() && !self.slot_kept(node) {
                    self.store.deferred_releases.delete(node);
                    self.release_slot(node);
                }
            }
        }
    }

    // Solid: store.ts:941-944 (`GlobalQueue._slotFlight`)
    pub(in crate::slice1) fn slot_flight(&self, n: NodeId) -> bool {
        let fam = self.nodes[n].host.and_then(|t| self.st(t).fam);
        fam.and_then(|f| self.store.families[f].node)
            .is_some_and(|d| self.nodes[d].status & STATUS_PENDING != 0)
    }

    // Solid: store.ts:949-958 (`GlobalQueue._slotCovered`)
    pub(in crate::slice1) fn slot_covered(&self, n: NodeId) -> Value {
        let t = self.nodes[n].host.expect("a slot node");
        if self.st(t).ch {
            panic!("a chained link's covered value (§7b) is not ported");
        }
        self.nodes[n].value.clone()
    }

    /// The scheduler's `storeCommitHook` (store.ts:959-962).
    pub(in crate::slice1) fn store_commit(&mut self) {
        self.drain_folds();
        self.sweep_overlaid();
    }

    // Solid: store.ts:973-981
    pub(in crate::slice1) fn run_direct<T>(&mut self, f: impl FnOnce(&mut Runtime) -> T) -> T {
        let was = self.store.direct_commit;
        self.store.direct_commit = true;
        let r = f(self);
        self.store.direct_commit = was;
        r
    }

    /// `copyOwn(to, from, key)` for plain data: `to[key] = from[key]` (an
    /// array's `length` is defined, which truncates or extends alike).
    // Solid: store.ts:634-639
    fn copy_own(to: &Obj, from: &Obj, key: &Key) {
        to.set(key, from.get_own(key).unwrap_or(Value::Undef));
    }

    // Solid: store.ts:984-1049
    pub(in crate::slice1) fn fold_target(&mut self, t: TargetId, old: &Obj) {
        let k = self.st(t).k;
        if let Some(pb) = self.st(t).pb.clone() {
            let v0 = self.st(t).v.clone();
            if Rc::ptr_eq(&pb, &v0) {
                // An eager adoption nothing wrote after.
            } else if self.st(t).ovl {
                panic!("prototype-overlay drafts (#3044) are not ported");
            } else if !Rc::ptr_eq(&v0, old) {
                self.privatize_committed(t);
                let v = self.st(t).v.clone();
                match self.st(t).wk.clone() {
                    Some(Wk::Set(wk)) => {
                        let mut w = Some(wk);
                        while let Some(set) = w {
                            let keys = set.borrow().keys.clone();
                            for key in keys {
                                if pb.has_own(&key) {
                                    Self::copy_own(&v, &pb, &key);
                                } else {
                                    v.delete(&key);
                                }
                            }
                            w = set.borrow().u.clone();
                        }
                    }
                    _ => {
                        for key in pb.own_keys() {
                            Self::copy_own(&v, &pb, &key);
                        }
                        for key in old.own_keys() {
                            if !pb.has_own(&key) {
                                v.delete(&key);
                            }
                        }
                    }
                }
            } else {
                let v = if self.st(t).ovl {
                    self.materialize_pb(t)
                } else {
                    pb
                };
                self.stm(t).v = v;
                self.stm(t).ch = false;
            }
            self.stm(t).pb = None;
            self.stm(t).wk = None;
        }
        if let Some(k) = k {
            let tv = self.st(t).v.clone();
            if self.nodes[k].subs.is_none() {
                self.stm(t).k = None;
            } else if let Value::View(view) = &self.nodes[k].value {
                view.borrow_mut().base = tv;
            } else {
                self.nodes[k].value = Value::Obj(tv);
            }
        }
        let tv = self.st(t).v.clone();
        if !Rc::ptr_eq(&tv, old) {
            if let Some(u) = self.st(t).u {
                let slot = self.parent_slot_key(t, &Value::Obj(old.clone()));
                if self.st(u).v.get(&slot) == Value::Obj(old.clone()) {
                    self.privatize_committed(u);
                    let uv = self.st(u).v.clone();
                    uv.set(&slot, Value::Obj(self.st(t).v.clone()));
                }
            }
        }
    }

    // Solid: store.ts:1135-1137
    pub(in crate::slice1) fn user_writing(&self) -> bool {
        self.store.user_write
    }

    // Solid: store.ts:1138-1152
    fn held_derivation(&mut self, t: TargetId, node: Option<NodeId>, key: &Key) -> bool {
        if self.st(t).fam.is_none() || !self.store.user_write {
            return false;
        }
        if let Some(node) = node {
            return self.nodes[node].config & (CONFIG_HELD | CONFIG_MANUAL_WRITE) == CONFIG_HELD
                && Some(self.tx_of(node)) != self.flush_transaction;
        }
        let Some(k) = self.st(t).k else { return false };
        self.nodes[k].config & CONFIG_HELD != 0
            && Some(self.tx_of(k)) != self.flush_transaction
            && self.held_key_changed(t, key, true)
    }

    // Solid: store.ts:1157-1309 (`__DEV__`/`__OBSERVE__` arms folded away)
    pub(in crate::slice1) fn notify_writes(&mut self, t: TargetId) {
        let Some(pb) = self.st(t).pb.clone() else {
            return;
        };
        if self.st(t).fam.is_some_and(|f| self.store.families[f].opt) {
            if self.store.user_write {
                self.stm(t).pb = None;
                self.stm(t).wk = None;
                let staged = self.notify_optimistic_writes(t, &pb);
                self.stm(t).pb = staged;
                return;
            }
            self.pair_rows(t, &pb);
        }
        let old = self.st(t).v.clone();
        // `writtenKeys`: this setter's keys — null for WK_ALL (an array
        // length write), accessors seen (`t.a`) or a non-plain prototype
        // (every record here is plain); else `t.wk` (itself null when no
        // trap wrote).
        let plain = self.plain_proto(&Value::Obj(if self.st(t).ovl {
            self.st(t).v.clone()
        } else {
            pb.clone()
        }));
        let written: Option<Vec<Key>> = match &self.st(t).wk {
            Some(Wk::Set(w)) if !self.st(t).a && plain => Some(w.borrow().keys.clone()),
            _ => None,
        };
        if self.st(t).fam.is_some() && !self.store.held_derivation_hit {
            if let Some(keys) = &written {
                for key in keys {
                    let node = self.st(t).n.as_ref().and_then(|n| n.get(key));
                    if self.held_derivation(t, node, key) {
                        self.store.held_derivation_hit = true;
                        break;
                    }
                }
            }
        }
        if let Some(nodes) = self.st(t).n.clone() {
            let keys = written.clone().unwrap_or_else(|| nodes.keys());
            for key in keys {
                let Some(node) = self.st(t).n.as_ref().and_then(|n| n.get(&key)) else {
                    continue;
                };
                if self.nodes[node].acc {
                    panic!("an accessor key's notification is not ported");
                }
                let own = pb.has_own(&key);
                let deleted = self.st(t).del.as_ref().is_some_and(|d| d.contains(&key));
                let nv = if own || !(deleted || key.is("__proto__")) {
                    pb.get(&key)
                } else {
                    Value::Undef
                };
                self.set_signal(node, nv);
                if self.st(t).fam.is_some() {
                    if !self.store.user_write {
                        self.nodes[node].config &= !CONFIG_MANUAL_WRITE;
                        let lane = self.pass_lane;
                        self.hold_with_derive(t, node, lane);
                    } else {
                        self.nodes[node].config |= CONFIG_MANUAL_WRITE;
                    }
                }
            }
        }
        if let Some(has) = self.st(t).h.clone() {
            let keys = written.clone().unwrap_or_else(|| has.keys());
            for key in keys {
                let Some(node) = self.st(t).h.as_ref().and_then(|h| h.get(&key)) else {
                    continue;
                };
                let deleted = self.st(t).del.as_ref().is_some_and(|d| d.contains(&key));
                self.set_signal(node, Value::Bool(pb.has(&key) && !deleted));
                if self.st(t).fam.is_some() && !self.store.user_write {
                    let lane = self.pass_lane;
                    self.hold_with_derive(t, node, lane);
                }
            }
        }
        if self.st(t).dk.is_some() {
            self.bump_deep(t);
        }
        if let Some(k) = self.st(t).k {
            if self.nodes[k].subs.is_some() || self.nodes[k].config & CONFIG_OVERRIDE != 0 {
                let changed = if self.st(t).ovl {
                    panic!("prototype-overlay drafts (#3044) are not ported");
                } else if pb.array && old.array {
                    self.array_structure_changed(&old, &pb)
                } else {
                    self.membership_changed(&old, &pb)
                };
                if changed {
                    self.notify_container(k, &pb);
                }
            }
        }
    }

    // Solid: store.ts:1315-1319
    pub(in crate::slice1) fn targets_equal(&self, ov: &Value, nv: &Value) -> bool {
        if !ov.is_object() || !nv.is_object() {
            return false;
        }
        let ot = self.lookup_target(ov, None);
        ot.is_some() && ot == self.lookup_target(nv, None)
    }

    // Solid: store.ts:1322-1330
    pub(in crate::slice1) fn array_structure_changed(&self, old: &Obj, neu: &Obj) -> bool {
        if old.len() != neu.len() {
            return true;
        }
        for i in 0..neu.len() {
            let ov = old.get(&Key::Idx(i));
            let nv = neu.get(&Key::Idx(i));
            if ov != nv && !self.targets_equal(&ov, &nv) {
                return true;
            }
        }
        false
    }

    // Solid: store.ts:1332-1340
    pub(in crate::slice1) fn membership_changed(&self, old: &Obj, neu: &Obj) -> bool {
        let nk = neu.own_keys();
        if old.own_keys().len() != nk.len() {
            return true;
        }
        nk.iter().any(|k| !old.has(k))
    }

    // Solid: store.ts:1348-1352
    pub(in crate::slice1) fn leaf_set(&mut self, node: NodeId, v: Value) {
        self.set_signal(node, v);
        let host = self.nodes[node].host.expect("a slot node");
        if self.pass_lane.is_some() && !self.store.user_write && self.st(host).fam.is_some() {
            let lane = self.pass_lane;
            self.hold_with_derive(host, node, lane);
        }
    }

    // Solid: store.ts:1355-1388 (plain data: the accessor arm is not taken)
    pub(in crate::slice1) fn notify_key_diff(
        &mut self,
        node: NodeId,
        key: &Key,
        old: &Obj,
        neu: &Obj,
    ) {
        if self.nodes[node].acc {
            panic!("an accessor key's notification is not ported");
        }
        let ov = old.get(key);
        let nv = neu.get(key);
        if ov != nv && !self.targets_equal(&ov, &nv) {
            self.leaf_set(node, nv);
        }
    }

    // Solid: store.ts:1390-1392
    pub(in crate::slice1) fn has_accessor_flag(&self, node: NodeId) -> bool {
        self.nodes[node].acc
    }

    // Solid: store.ts:1395-1409
    pub(in crate::slice1) fn notify_key_value(
        &mut self,
        node: NodeId,
        key: &Key,
        ov: &Value,
        nv: &Value,
        old: &Obj,
        neu: &Obj,
    ) {
        if self.nodes[node].acc {
            self.notify_key_diff(node, key, old, neu);
            return;
        }
        if ov != nv && !self.targets_equal(ov, nv) {
            self.leaf_set(node, nv.clone());
        }
    }

    // Solid: store.ts:1432-1452 (`old` is raw here: never a live chained proxy)
    pub(in crate::slice1) fn notify_fold_tail(&mut self, t: TargetId, old: &Obj, neu: &Obj) {
        if let Some(has) = self.st(t).h.clone() {
            for key in has.keys() {
                if old.has(&key) != neu.has(&key) {
                    let node = self
                        .st(t)
                        .h
                        .as_ref()
                        .and_then(|h| h.get(&key))
                        .expect("a presence node released mid-walk is a TypeError");
                    self.leaf_set(node, Value::Bool(neu.has(&key)));
                }
            }
        }
        if let Some(k) = self.st(t).k {
            if self.nodes[k].subs.is_some() || self.nodes[k].config & CONFIG_OVERRIDE != 0 {
                let changed = if neu.array && old.array {
                    self.array_structure_changed(old, neu)
                } else {
                    self.membership_changed(old, neu)
                };
                if changed {
                    self.notify_container(k, neu);
                }
            }
        }
    }

    // Solid: store.ts:1457-1468
    pub(in crate::slice1) fn notify_fold(&mut self, t: TargetId, old: &Obj, neu: &Obj) {
        if self.st(t).dk.is_some() && !Rc::ptr_eq(old, neu) {
            self.bump_deep(t);
        }
        if let Some(nodes) = self.st(t).n.clone() {
            for key in nodes.keys() {
                let node = nodes.get(&key).unwrap();
                self.notify_key_diff(node, &key, old, neu);
            }
        }
        self.notify_fold_tail(t, old, neu);
    }

    // Solid: store.ts:1480-1485
    pub(in crate::slice1) fn scope_key(&self, target: TargetId) -> ScopeKey {
        if let Some(f) = self.st(target).fam {
            return ScopeKey::Fam(f);
        }
        let mut t = target;
        while let Some(u) = self.st(t).u {
            t = u;
        }
        ScopeKey::Root(t)
    }

    // Solid: store.ts:1486-1488
    pub(in crate::slice1) fn in_draft(&self, target: TargetId) -> bool {
        let key = self.scope_key(target);
        self.store
            .write_scopes
            .as_ref()
            .is_some_and(|s| s.contains(&key))
    }

    // Solid: store.ts:1498-1504
    fn draft_serve(&mut self, target: TargetId, proxy: Value) -> Value {
        if self.store.write_scopes.is_some() && self.in_draft(target) {
            if let Some(ct) = self.target_of(&proxy) {
                let key = self.scope_key(ct);
                if let Some(scopes) = self.store.write_scopes.as_mut() {
                    if !scopes.contains(&key) {
                        scopes.push(key);
                    }
                }
            }
        }
        proxy
    }

    // Solid: store.ts:1510-1515
    pub(in crate::slice1) fn committed(&self, t: TargetId) -> Obj {
        let target = self.st(t);
        if let Some(k) = target.k {
            return if self.nodes[k].pending.is_some() {
                self.as_backing(&self.nodes[k].value)
            } else {
                target.v.clone()
            };
        }
        if target.pb.is_some() {
            self.pre_batch(t)
        } else {
            target.v.clone()
        }
    }

    /// `asBacking(v)` (store.ts:287-289).
    pub(in crate::slice1) fn as_backing(&self, v: &Value) -> Obj {
        match v {
            Value::View(view) => view.borrow().base.clone(),
            other => raw(other),
        }
    }

    // Solid: store.ts:1522-1527
    fn staging_reader(&self) -> Option<NodeId> {
        let mut c = self.context?;
        if self.nodes[c].kind == Kind::Root {
            c = self.parent_computed(c)?;
        }
        if self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
            None
        } else {
            Some(c)
        }
    }

    // Solid: store.ts:1542-1643
    pub(in crate::slice1) fn read_source(
        &mut self,
        target: TargetId,
        key: Option<&Key>,
        shape: bool,
    ) -> Result<Obj, Error> {
        if self.store.user_write
            && self
                .st(target)
                .fam
                .is_some_and(|f| self.store.families[f].opt)
            && !self.store.pending_notify.has(target)
            && self.in_draft(target)
        {
            let draft = self.ensure_pb(target);
            self.store.pending_notify.add(target);
            return Ok(draft);
        }
        let Some(pb) = self.st(target).pb.clone() else {
            return Ok(self.st(target).v.clone());
        };
        if self.in_draft(target) || self.store.write_override {
            if self.store.write_override && !self.store.user_write {
                let leaf = key.and_then(|k| self.st(target).n.as_ref().and_then(|n| n.get(k)));
                match leaf {
                    Some(leaf) => {
                        if self.nodes[leaf].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
                        {
                            let t = self.tx_of(leaf);
                            self.join_pass_tx(t, false);
                        }
                    }
                    None => {
                        if let Some(k) = self.st(target).k {
                            if self.nodes[k].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
                                && key.is_none_or(|key| self.held_key_changed(target, key, true))
                            {
                                let t = self.tx_of(k);
                                self.join_pass_tx(t, false);
                            }
                        }
                    }
                }
            }
            return Ok(pb);
        }
        let k = self.st(target).k;
        if let Some(key) = key {
            let leaf = self.st(target).n.as_ref().and_then(|n| n.get(key));
            if leaf.is_some_and(|l| self.nodes[l].config & CONFIG_OVERRIDE != 0) {
                return Ok(self.committed(target));
            }
        }
        let held = k.is_some_and(|k| self.nodes[k].config & CONFIG_HELD != 0);
        if held {
            if let Some(key) = key {
                if !self.held_key_changed(target, key, shape) {
                    return Ok(pb);
                }
            }
        }
        let Some(c) = self.staging_reader() else {
            if self.get_observer().is_some() {
                return Ok(pb);
            }
            if self.family_ahead(target) {
                return Ok(pb);
            }
            if !self.verdict
                || (!held && key.is_some_and(|key| !self.key_changed(target, key, shape)))
            {
                return Ok(if held {
                    self.as_backing(&self.nodes[k.unwrap()].value.clone())
                } else {
                    self.st(target).v.clone()
                });
            }
            return Ok(match k {
                None => self.committed(target),
                Some(k) => {
                    let v = self.read_node(k)?;
                    self.as_backing(&v)
                }
            });
        };
        if !held {
            if self.nodes[c].flags & REACTIVE_STAGED_READ != 0
                && self.nodes[c].config & (CONFIG_VERDICT | CONFIG_CHILDREN_FORBIDDEN) == 0
            {
                return Ok(pb);
            }
            if let Some(key) = key {
                if !self.key_changed(target, key, shape) {
                    return Ok(self.committed(target));
                }
            }
            if k.is_none() {
                if self.nodes[c].config & CONFIG_VERDICT != 0 && self.staged_screen(c, None) {
                    return Ok(self.committed(target));
                }
                self.staged_read(c, None);
                return Ok(pb);
            }
        }
        let k = k.unwrap();
        let v = self.untrack(|rt| rt.read_node(k))?;
        Ok(self.as_backing(&v))
    }

    // Solid: store.ts:1647-1652
    fn held_key_changed(&mut self, target: TargetId, key: &Key, shape: bool) -> bool {
        let k = self.st(target).k.expect("a held container");
        let v = self.nodes[k].value.clone();
        let pb = self.nodes[k].pending.clone().expect("a held staging");
        self.changed_between(target, &v, &pb, key, shape) && !self.adopt_child(target, key)
    }

    // Solid: store.ts:1658-1663 (`rawsOf`, built once per frame)
    fn raws_of(&mut self, frame: &Obj) -> Vec<Value> {
        if let Some(r) = self.store.frame_raws.get(&frame.id) {
            return r.clone();
        }
        let raws: Vec<Value> = frame.keys().iter().map(|k| frame.get(k)).collect();
        self.store.frame_raws.insert(frame.id, raws.clone());
        raws
    }

    /// A family's key fn (`fam.key`, projection.ts:403-410): `isWrappable(row)
    /// ? row[key] : undefined` (a proxy row answers through its trap).
    pub(in crate::slice1) fn fam_key(
        &mut self,
        key: &Rc<str>,
        row: &Value,
    ) -> Result<Value, Error> {
        if !self.is_wrappable(row) {
            return Ok(Value::Undef);
        }
        self.js_get(row, &Key::name(key))
    }

    // Solid: store.ts:1666-1674
    pub(in crate::slice1) fn same_row(
        &mut self,
        pv: &Value,
        nv: &Value,
        key_fn: &Option<Rc<str>>,
    ) -> Result<bool, Error> {
        if !pv.is_object() || !nv.is_object() {
            return Ok(false);
        }
        let Some(key) = key_fn else { return Ok(true) };
        let a = self.fam_key(key, pv)?;
        let b = self.fam_key(key, nv)?;
        Ok(a == b)
    }

    // Solid: store.ts:1684-1712
    fn adopt_child(&mut self, target: TargetId, key: &Key) -> bool {
        let k = self.st(target).k.expect("a held container");
        let old = self.as_backing(&self.nodes[k].value.clone());
        let ov = old.get(key);
        let staging = raw(&self.nodes[k].pending.clone().expect("a held staging"));
        let nv = staging.get(key);
        // `Array.isArray(old) ? target._fam?.key : null`; `undefined` (no
        // family) declines.
        let key_fn: Option<Option<Rc<str>>> = if old.array {
            self.st(target)
                .fam
                .map(|f| self.store.families[f].key.clone())
        } else {
            Some(None)
        };
        let fam = self.st(target).fam;
        let Some(key_fn) = key_fn else { return false };
        if self.st(target).s {
            return false;
        }
        let same = self.same_row(&ov, &nv, &key_fn).unwrap_or_else(|e| {
            panic!("a key read that throws ({}) is outside tier B", e.message())
        });
        if !same
            || !self.is_wrappable(&ov)
            || !self.is_wrappable(&nv)
            || self.is_array(&ov) != self.is_array(&nv)
            || self.lookup_target(&ov, fam).is_some()
            || self.lookup_target(&nv, fam).is_some()
            || self.raws_of(&old).contains(&nv)
            || self.raws_of(&staging).contains(&ov)
        {
            return false;
        }
        let w = self.wrap(&ov, Some(target), Some(key.clone()), fam);
        let Some(ct) = self.target_of(&w) else {
            return false;
        };
        if Value::Obj(self.st(ct).v.clone()) != ov {
            return false;
        }
        self.adopt_pb(ct, &raw(&nv), false);
        let ck = self.get_container_node(ct);
        let t = self.tx_of(k);
        self.hold_node(ck, t);
        true
    }

    // Solid: store.ts:1715-1717
    fn family_ahead(&self, target: TargetId) -> bool {
        self.st(target).fam.is_some()
            && self.context.is_none()
            && self
                .st(target)
                .k
                .is_none_or(|k| self.nodes[k].config & CONFIG_HELD == 0)
    }

    // Solid: store.ts:1731-1733
    fn key_changed(&mut self, target: TargetId, key: &Key, shape: bool) -> bool {
        let committed = Value::Obj(self.committed(target));
        let pb = Value::Obj(self.st(target).pb.clone().expect("a staging"));
        self.changed_between(target, &committed, &pb, key, shape)
    }

    // Solid: store.ts:1735-1763 (plain data: no accessor or enumerability
    // differences)
    fn changed_between(
        &mut self,
        target: TargetId,
        v: &Value,
        pb: &Value,
        key: &Key,
        _shape: bool,
    ) -> bool {
        if self.st(target).ch
            || self.target_of(pb).is_some()
            || self.proto_of(pb) != self.proto_of(v)
            || !self.plain_proto(v)
        {
            return true;
        }
        let (v, pb) = (raw(v), raw(pb));
        if self
            .st(target)
            .del
            .as_ref()
            .is_some_and(|d| d.contains(key))
        {
            return v.has(key);
        }
        let in_new = pb.has_own(key) || (self.st(target).ovl && self.st(target).v.has_own(key));
        if in_new != v.has_own(key) {
            return true;
        }
        if !in_new {
            return false;
        }
        let nv = pb.get(key);
        let ov = v.get(key);
        ov != nv && !self.same_logical_slot(target, &ov, &nv)
    }

    // Solid: store.ts:1772-1789
    fn node_value(&mut self, node: NodeId, target: TargetId) -> Result<Value, Error> {
        let fam = self.st(target).fam;
        let uninit = fam
            .and_then(|f| self.store.families[f].node)
            .is_some_and(|d| self.nodes[d].status & STATUS_UNINITIALIZED != 0);
        if self.nodes[node].pending.is_some()
            && self.nodes[node].config & CONFIG_HELD == 0
            && fam.is_some()
            && (self.context.is_none() || uninit)
        {
            if let Some(c) = self.context {
                if self.tracking {
                    self.link(node, c);
                }
            }
            return Ok(self.nodes[node].pending.clone().unwrap());
        }
        self.read_node(node)
    }

    // Solid: store.ts:1793-1835 (plain data, no chained backing)
    fn serve_data_key(
        &mut self,
        target: TargetId,
        key: &Key,
        backing_value: Value,
        node: Option<NodeId>,
        acc_known: i8,
    ) -> Result<Value, Error> {
        let mut v = backing_value;
        let mut node = node;
        if !self.in_draft(target) && !self.store.write_override {
            if node.is_none() && self.get_observer().is_some() {
                node = Some(self.get_node(target, key, acc_known));
            }
            if let Some(n) = node {
                v = self.node_value(n, target)?;
            }
        }
        if self.st(target).s {
            return Ok(self.serve_shallow(target, key, v));
        }
        let fam = self.st(target).fam;
        if let Some(n) = node {
            if self.nodes[n].pxv == v && !v.is_undef() {
                let px = self.nodes[n].px.clone();
                return Ok(self.draft_serve(target, px));
            }
            if !self.is_wrappable(&v) {
                return Ok(v);
            }
            let p = self.wrap(&v, Some(target), Some(key.clone()), fam);
            self.nodes[n].px = p.clone();
            self.nodes[n].pxv = v;
            return Ok(self.draft_serve(target, p));
        }
        if !self.is_wrappable(&v) {
            return Ok(v);
        }
        let p = self.wrap(&v, Some(target), Some(key.clone()), fam);
        Ok(self.draft_serve(target, p))
    }

    // Solid: store.ts:1839-1842
    pub(in crate::slice1) fn linked_to(&self, c: NodeId, n: NodeId) -> bool {
        let mut s = self.nodes[n].subs;
        while let Some(l) = s {
            if self.links[l].sub == c {
                return true;
            }
            s = self.links[l].next_sub;
        }
        false
    }

    // Solid: store.ts:1852-1929
    pub(in crate::slice1) fn pull_family(&mut self, target: TargetId) -> Result<(), Error> {
        let fam = self.st(target).fam.expect("a family target");
        let Some(fw) = self.store.families[fam].node else {
            return Ok(());
        };
        if self.store.write_override || self.in_draft(target) {
            return Ok(());
        }
        if self.nodes[fw].status & (STATUS_PENDING | STATUS_ERROR) != 0
            || self.nodes[fw].config & CONFIG_STAGED_ERROR != 0
        {
            if !self.verdict
                && self.nodes[fw].status & STATUS_PENDING != 0
                && self.opt_stands(target)?
            {
                return Ok(());
            }
            let c = self.context;
            if let Some(c) = c {
                if self.nodes[c].effect_type == EFFECT_RENDER
                    && self.nodes[fw].status & STATUS_PENDING != 0
                    && self.nodes[fw].config & CONFIG_HELD != 0
                    && {
                        let tf = self.tx_of(fw);
                        self.flush_transaction != Some(tf)
                    }
                    && !self.linked_to(c, fw)
                {
                    return Ok(());
                }
                if self.nodes[fw].config & CONFIG_STAGED_ERROR != 0 {
                    self.link(fw, c);
                }
            }
            self.read_node(fw)?;
        } else {
            self.untrack(|rt| rt.read_node(fw))?;
            if self.nodes[fw].config & CONFIG_VERDICT != 0
                && self.nodes[fw].flags & (EFFECT_RENDER << 21) == 0
                && self.tracking
            {
                panic!("a derive that is a verdict reader (#4491) is not ported");
            }
        }
        Ok(())
    }

    // Solid: store.ts:1939-1974
    pub(in crate::slice1) fn hold_with_derive(
        &mut self,
        target: TargetId,
        node: NodeId,
        lane: Option<TxId>,
    ) {
        let fw = self
            .st(target)
            .fam
            .and_then(|f| self.store.families[f].node);
        if let Some(lane) = lane {
            if self.nodes[node].pending.is_some() && self.nodes[node].config & CONFIG_OVERRIDE == 0
            {
                self.list(node, lane);
                self.nodes[node].lane = self.nodes[node].pending.take();
                self.nodes[node].pending_err = None;
                self.nodes[node].config |= CONFIG_OVERRIDE;
                return;
            }
        }
        if let Some(fw) = fw {
            if self.nodes[fw].config & CONFIG_HELD != 0
                && self.nodes[node].pending.is_some()
                && self.nodes[node].config & (CONFIG_HELD | CONFIG_OVERRIDE) == 0
            {
                let t = self.tx_of(fw);
                self.hold_node(node, t);
                self.nodes[node].reask = self.nodes[fw].reask;
            }
        }
    }

    // Solid: store.ts:2011-2013
    pub(in crate::slice1) fn opt_read(&self, target: TargetId) -> bool {
        self.st(target)
            .fam
            .is_some_and(|f| self.store.families[f].opt)
            && !self.in_draft(target)
            && !self.store.write_override
    }

    // Solid: store.ts:2025-2036
    fn touch(&mut self, target: TargetId, key: &Key) {
        let mut wk = self.st(target).wk.clone();
        if !self.store.pending_notify.has(target) {
            self.store.pending_notify.add(target);
            if let Some(Wk::Set(prev)) = &wk {
                let fresh = Rc::new(RefCell::new(WkSet {
                    keys: vec![],
                    u: Some(prev.clone()),
                }));
                self.stm(target).wk = Some(Wk::Set(fresh.clone()));
                wk = Some(Wk::Set(fresh));
            }
        }
        if !matches!(wk, Some(Wk::All)) {
            let set = match self.st(target).wk.clone() {
                Some(Wk::Set(s)) => s,
                _ => {
                    let s = Rc::new(RefCell::new(WkSet {
                        keys: vec![],
                        u: None,
                    }));
                    self.stm(target).wk = Some(Wk::Set(s.clone()));
                    s
                }
            };
            let mut set = set.borrow_mut();
            if !set.keys.contains(key) {
                set.keys.push(key.clone());
            }
        }
    }

    // Solid: store.ts:2088-2262 (the `get` trap; `receiver` is the proxy)
    pub(in crate::slice1) fn trap_get(
        &mut self,
        target: TargetId,
        key: &Key,
    ) -> Result<Value, Error> {
        if let Key::Sym(sym) = key {
            // The brand symbols (`$TARGET` is answered by `target_of`).
            if *sym == "$TRACK" {
                if self.st(target).fam.is_some() {
                    self.pull_family(target)?;
                }
                if !self.in_draft(target) && self.get_observer().is_some() {
                    let k = self.get_container_node(target);
                    self.read_node(k)?;
                    // A chained backing reads through (§7b): the backing
                    // here is always raw, so `srcT[$TARGET]` is undefined.
                    self.read_source(target, None, false)?;
                }
                return Ok(Value::Undef);
            }
            // User symbols fall through to the generic path.
        }
        if self.st(target).fam.is_some() {
            self.pull_family(target)?;
        }
        let node0 = self.st(target).n.as_ref().and_then(|n| n.get(key));
        if self.store.write_scopes.is_none() && !self.store.write_override {
            if let Some(h) = node0 {
                if !self.nodes[h].acc
                    && (!self.st(target).ch || self.nodes[h].config & CONFIG_OVERRIDE != 0)
                {
                    let nv = self.node_value(h, target)?;
                    if !nv.is_object() {
                        return Ok(nv);
                    }
                    if self.st(target).s {
                        return Ok(self.serve_shallow(target, key, nv));
                    }
                    if self.nodes[h].pxv == nv {
                        return Ok(self.nodes[h].px.clone());
                    }
                    if self.is_wrappable(&nv) {
                        let fam = self.st(target).fam;
                        let p = self.wrap(&nv, Some(target), Some(key.clone()), fam);
                        self.nodes[h].px = p.clone();
                        self.nodes[h].pxv = nv;
                        return Ok(p);
                    }
                    return Ok(nv);
                }
            }
        }
        let src = self.read_source(target, Some(key), false)?;
        let is_pb = self
            .st(target)
            .pb
            .as_ref()
            .is_some_and(|pb| Rc::ptr_eq(pb, &src));
        if is_pb
            && self
                .st(target)
                .del
                .as_ref()
                .is_some_and(|d| d.contains(key))
        {
            if !self.in_draft(target) && self.get_observer().is_some() {
                let n = self.get_node(target, key, -1);
                self.read_node(n)?;
            }
            return Ok(Value::Undef);
        }
        let mut acc_probe: i8 = -1;
        let acc = match node0 {
            Some(n) => self.nodes[n].acc,
            None if !self.in_draft(target) && self.get_observer().is_some() => {
                let acc = self.is_own_accessor(&src, key);
                let cur = self
                    .st(target)
                    .pb
                    .clone()
                    .unwrap_or_else(|| self.st(target).v.clone());
                if Rc::ptr_eq(&src, &cur) {
                    acc_probe = if acc { 1 } else { 0 };
                }
                acc
            }
            None => false,
        };
        if acc {
            panic!("accessor keys are not ported");
        }
        let view_ovl = self.st(target).ovl && is_pb;
        if view_ovl {
            panic!("prototype-overlay drafts (#3044) are not ported");
        }
        let guarded = if key.is("constructor") {
            self.store.write_override || self.in_draft(target)
        } else {
            key.is("__proto__") || key.is("prototype")
        };
        if guarded && !src.has_own(key) {
            return Ok(Value::Undef);
        }
        let v = src.get_own(key);
        let Some(v) = v else {
            // Inherited: prototype methods run with the proxy receiver.
            let v = value::proto_get(src.array, key);
            if matches!(v, Value::Func(_)) {
                return Ok(v);
            }
            if v.is_undef() && !self.in_draft(target) {
                if self.get_observer().is_some() {
                    self.get_node(target, key, acc_probe);
                }
                if let Some(node) = self.st(target).n.as_ref().and_then(|n| n.get(key)) {
                    let nv = self.node_value(node, target)?;
                    if self.st(target).s {
                        return Ok(self.serve_shallow(target, key, nv));
                    }
                    if !self.is_wrappable(&nv) {
                        return Ok(nv);
                    }
                    let fam = self.st(target).fam;
                    let p = self.wrap(&nv, Some(target), Some(key.clone()), fam);
                    return Ok(self.draft_serve(target, p));
                }
            }
            if self.st(target).s {
                return Ok(self.serve_shallow(target, key, v));
            }
            if !self.is_wrappable(&v) {
                return Ok(v);
            }
            let fam = self.st(target).fam;
            let p = self.wrap(&v, Some(target), Some(key.clone()), fam);
            return Ok(self.draft_serve(target, p));
        };
        self.serve_data_key(target, key, v, node0, acc_probe)
    }

    /// The list driver's slot view of a shallow store (`shallowView`,
    /// types.ts:186-194): installed by store.ts's top level.
    // Solid: store.ts:2623-2627
    pub(in crate::slice1) fn shallow_view(
        &mut self,
        t: Option<TargetId>,
    ) -> Result<Option<Obj>, Error> {
        let Some(t) = t else {
            return Ok(None);
        };
        let st = self.st(t);
        if st.s
            && !(st.ch
                || st.a
                || self.store.write_scopes.is_some()
                || self.store.write_override
                || st.fam.is_some_and(|f| self.store.families[f].opt))
        {
            if self.st(t).fam.is_some() {
                self.pull_family(t)?;
            }
            return self.read_source(t, None, false).map(Some);
        }
        Ok(None)
    }

    // Solid: store.ts:2264-2293 (the `has` trap)
    pub(in crate::slice1) fn trap_has(
        &mut self,
        target: TargetId,
        key: &Key,
    ) -> Result<bool, Error> {
        if self.st(target).fam.is_some() {
            self.pull_family(target)?;
        }
        let src = self.read_source(target, Some(key), false)?;
        if !self.in_draft(target) && !self.store.write_override {
            if self.get_observer().is_some() {
                let node = self.get_has_node(target, key);
                let nv = self.read_node(node)?;
                if !self.st(target).ch {
                    return Ok(nv.truthy());
                }
                panic!("a chained target's presence (§7b) is not ported");
            } else if self.opt_read(target) {
                if let Some(guessed) = self.optimistic_has(target, key)? {
                    return Ok(guessed);
                }
            }
        }
        let is_pb = self
            .st(target)
            .pb
            .as_ref()
            .is_some_and(|pb| Rc::ptr_eq(pb, &src));
        Ok(src.has(key)
            && !(is_pb
                && self
                    .st(target)
                    .del
                    .as_ref()
                    .is_some_and(|d| d.contains(key))))
    }

    // Solid: store.ts:2342-2386 (the `set` trap)
    pub(in crate::slice1) fn trap_set(
        &mut self,
        target: TargetId,
        key: &Key,
        value: Value,
    ) -> Result<(), Error> {
        let draft = self.in_draft(target);
        if !draft && !self.store.write_override {
            return Ok(());
        }
        if key.is("__proto__") {
            return Ok(());
        }
        let uv = if self.st(target).s {
            value
        } else {
            self.unwrap_value(&value)
        };
        let pb = self.ensure_pb(target);
        if self.store.user_write
            && self
                .st(target)
                .k
                .is_some_and(|k| self.nodes[k].config & CONFIG_HELD != 0)
        {
            let n = self.get_node(target, key, -1);
            self.store.deferred_releases.add(n);
        }
        if pb.array {
            self.touch(target, key);
            if key.is("length") {
                self.stm(target).wk = Some(Wk::All);
            } else {
                self.touch(target, &Key::name("length"));
            }
        } else {
            self.touch(target, key);
            if !pb.has(key) {
                self.stm(target).kc += 1;
            }
        }
        let unsafe_key = key.is("__proto__") || key.is("prototype") || key.is("constructor");
        if self.st(target).ovl {
            panic!("prototype-overlay drafts (#3044) are not ported");
        }
        let uv_obj = uv.is_object().then(|| uv.clone());
        pb.set(key, uv);
        if let Some(del) = self.stm(target).del.as_mut() {
            del.retain(|k| k != key);
        }
        if unsafe_key {
            return Ok(());
        }
        if let Some(uv) = uv_obj.filter(|_| self.st(target).s) {
            self.mark_raw_one(&uv);
        }
        if !draft {
            self.notify_writes(target);
        }
        Ok(())
    }

    // Solid: store.ts:2407-2433 (the `deleteProperty` trap)
    pub(in crate::slice1) fn trap_delete(
        &mut self,
        target: TargetId,
        key: &Key,
    ) -> Result<(), Error> {
        let draft = self.in_draft(target);
        if !draft && !self.store.write_override {
            return Ok(());
        }
        let pb = self.ensure_pb(target);
        self.touch(target, key);
        let committed = self.st(target).ovl && self.st(target).v.has_own(key);
        if pb.has_own(key) {
            pb.delete(key);
            if !committed {
                self.stm(target).kc -= 1;
            }
        }
        if committed {
            panic!("prototype-overlay drafts (#3044) are not ported");
        }
        if !draft {
            self.notify_writes(target);
        }
        Ok(())
    }

    // Solid: store.ts:2509-2574 (`writeHook` is null; the dev guards are
    // folded away)
    pub(in crate::slice1) fn store_setter(
        &mut self,
        proxy: &Value,
        f: &mut dyn FnMut(&mut Runtime, Value) -> Result<Value, Error>,
        guard: bool,
    ) -> Result<(), Error> {
        let target = self.target_of(proxy).expect("a store proxy");
        let prev_scopes = self.store.write_scopes.take();
        self.store.write_scopes = Some(vec![self.scope_key(target)]);
        let prev_user = self.store.user_write;
        self.store.user_write = guard;
        if self.store.writing == 0 && self.store.pending_notify.size() != 0 {
            self.store.pending_notify.clear();
        }
        self.store.writing += 1;
        let result = f(self, proxy.clone());
        self.store.writing -= 1;
        self.store.write_scopes = prev_scopes;
        if self.store.writing == 0 && self.store.pending_notify.size() != 0 {
            let touched = self.store.pending_notify.values();
            self.store.pending_notify.clear();
            for t in &touched {
                self.notify_writes(*t);
            }
            if self.store.direct_commit {
                for t in &touched {
                    if self.st(*t).pb.is_some() {
                        let v = self.st(*t).v.clone();
                        self.fold_target(*t, &v);
                    }
                }
            }
        }
        self.store.user_write = prev_user;
        let result = result?;
        if !result.is_undef() && result != *proxy && self.is_wrappable(&result) {
            let incoming = self.unwrap_value(&result);
            if guard
                && self
                    .st(target)
                    .fam
                    .is_some_and(|f| self.store.families[f].opt)
                && !self.store.write_override
            {
                self.notify_optimistic_writes(target, &raw(&incoming));
            } else {
                self.adopt_pb(target, &raw(&incoming), true);
            }
        }
        if guard && self.store.held_derivation_hit {
            self.store.held_derivation_hit = false;
            let fam = self.st(target).fam.expect("a family");
            let fw = self.store.families[fam].node.expect("a derive");
            if self.nodes[fw].flags & REACTIVE_DIRTY == 0 {
                self.nodes[fw].flags = (self.nodes[fw].flags & !REACTIVE_CHECK) | REACTIVE_DIRTY;
                self.insert_into_heap(fw);
                self.schedule();
            }
        }
        Ok(())
    }

    // Solid: store.ts:2576-2615 (`signalHook` and the observe tier are null)
    pub(in crate::slice1) fn create_plain_store(&mut self, initial: Value, shallow: bool) -> Value {
        let proxy = self.wrap(&initial, None, None, None);
        if shallow {
            let t = self.target_of(&proxy).expect("a store proxy");
            self.stm(t).s = true;
            self.mark_raw_ingest(&raw(&initial));
        }
        proxy
    }

    // Solid: store.ts:1492-1496
    fn serve_shallow(&mut self, target: TargetId, key: &Key, v: Value) -> Value {
        if v.is_object() && self.target_of(&v).is_some() {
            let fam = self.st(target).fam;
            let p = self.wrap(&v, Some(target), Some(key.clone()), fam);
            return self.draft_serve(target, p);
        }
        v
    }

    // Solid: projection.ts:75-142 (`wrapDraft`'s `get` trap: every read
    // carries the write override)
    pub(in crate::slice1) fn draft_get(
        &mut self,
        d: &Rc<value::DraftProxy>,
        key: &Key,
    ) -> Result<Value, Error> {
        self.set_write_override(true);
        let r = self.js_get(&d.inner, key);
        self.set_write_override(false);
        let v = r?;
        if !d.shallow && v.is_object() {
            return Ok(self.wrap_draft(v));
        }
        Ok(v)
    }
}

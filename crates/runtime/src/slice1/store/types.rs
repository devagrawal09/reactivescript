//! Solid: store/types.ts — wrappability and the write override.
use super::super::*;
use super::target;

impl Runtime {
    // Solid: types.ts:156-169. Plain records and arrays wrap; nothing here
    // is frozen. A store proxy is not frozen (its shell is extensible) and
    // its prototype is its backing's (the `getPrototypeOf` trap); a draft
    // wrapper's is its store's (projection.ts:131). A `LaneView` is a class
    // instance whose `toString` tag is `[object Object]`; NOT_PENDING is a
    // plain `{}`.
    pub(in crate::slice1) fn is_wrappable(&self, v: &Value) -> bool {
        match v {
            Value::Obj(_) | Value::View(_) | Value::NotPending => true,
            Value::Proxy(t) => self.plain_proto(&self.trap_get_prototype_of(*t)),
            Value::Draft(d) => self.is_wrappable(&d.inner),
            _ => false,
        }
    }

    // Solid: types.ts:113-115
    pub(in crate::slice1) fn is_raw_value(&self, v: &Value) -> bool {
        self.store.raw_values_used
            && target::ident(v).is_some_and(|id| self.store.raw_values.contains(&id))
    }

    // Solid: types.ts:127-137 (prod: no dev check)
    pub(in crate::slice1) fn mark_raw_one(&mut self, v: &Value) {
        if self.is_wrappable(v) {
            if self.target_of(v).is_some() {
                return;
            }
            self.store.raw_values_used = true;
            if let Some(id) = target::ident(v) {
                self.store.raw_values.insert(id);
            }
        }
    }

    // Solid: types.ts:139-145
    pub(in crate::slice1) fn mark_raw_ingest(&mut self, container: &Obj) {
        if container.array {
            for i in 0..container.len() {
                let v = container.get(&Key::Idx(i));
                self.mark_raw_one(&v);
            }
        } else {
            // `for (const k in container)`: enumerable own string keys of a
            // plain record.
            for k in container.keys() {
                let v = container.get(&k);
                self.mark_raw_one(&v);
            }
        }
    }

    // Solid: types.ts:182-184
    pub(in crate::slice1) fn set_write_override(&mut self, value: bool) {
        self.store.write_override = value;
    }
}

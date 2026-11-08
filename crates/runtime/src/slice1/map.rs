//! Solid: map.ts — `mapArray` and its keyed diff (`updateKeyedMap`), with
//! the staged pass of #2903 (`stageRemoval`, the window stage,
//! `commitWindow`), the small-move fast path (`trySmallMove`,
//! `commitSmallMove`), `writeRow` and `compare`.
//!
//! Not ported: `repeat`/`updateRepeat` (no op creates one), the dev name
//! wrapper (`setStrictRead`) and the observe tier's list census
//! (`attrHooks.listChurn`).
//!
//! JS arrays the pass keeps (`_items`, `_mappings`) are `JsObj` arrays:
//! `_mappings`' identity is the change signal downstream relies on, and
//! `_items` is `newItems.slice(0)` (holes kept). The bookkeeping arrays
//! (`_nodes`, `_rows`, `_indexes` and the pass's stages) are `Vec`s of
//! `Option` (a hole is `None`).
use super::*;

pub type MapId = usize;

/// An argument the mapper receives: a raw value (an item, a number,
/// `undefined`), or an accessor (`accessor(node)`, signals.ts:140-144).
#[derive(Clone, Debug)]
pub enum MapArg {
    Value(Value),
    Accessor(NodeId),
}

/// `map(item, index)`; its arity is passed apart (`map.length`).
pub type MapFn = Rc<dyn Fn(&mut Runtime, MapArg, MapArg) -> Result<Value, Error>>;
/// `keyed: item => key`.
pub type KeyFn = Rc<dyn Fn(&mut Runtime, Value) -> Result<Value, Error>>;
/// The list accessor (`mapArray(list, …)`).
pub type ListFn = Rc<dyn Fn(&mut Runtime) -> Result<Value, Error>>;
/// `options.fallback`.
pub type FallbackFn = Rc<dyn Fn(&mut Runtime) -> Result<Value, Error>>;

/// `options.keyed`: `true` (or absent: identity), `false` (index rows) or a
/// key function.
#[derive(Clone)]
pub enum Keyed {
    Identity,
    Index,
    Fn(KeyFn),
}

/// Solid: map.ts:843-858 `MapData`.
pub(super) struct MapData {
    owner: NodeId,
    len: usize,
    list: ListFn,
    items: Obj,
    map: MapFn,
    mappings: Obj,
    nodes: Vec<Option<NodeId>>,
    key: Option<KeyFn>,
    rows: Option<Vec<Option<NodeId>>>,
    indexes: Option<Vec<Option<NodeId>>>,
    by_index: bool,
    fallback: Option<FallbackFn>,
}

/// A stage array (`new Array(n)`: holes).
type Stage = Option<Vec<Option<NodeId>>>;

// Solid: map.ts:92, 94 (`[]`)
fn new_array() -> Obj {
    JsObj::new_array(vec![])
}

// Solid: map.ts:468, 493 (`this._nodes[0]`)
fn stage_get(v: &[Option<NodeId>], i: usize) -> Option<NodeId> {
    v.get(i).copied().flatten()
}

/// `a[i] = x` on a JS array (it grows to hold `i`).
// Solid: map.ts:432-447, 470 (stage writes)
fn stage_set(v: &mut Vec<Option<NodeId>>, i: usize, x: Option<NodeId>) {
    if v.len() <= i {
        v.resize(i + 1, None);
    }
    v[i] = x;
}

/// `a.length = n`.
// Solid: map.ts:370-372, 384-386
fn set_length(v: &mut Vec<Option<NodeId>>, n: usize) {
    v.resize(n, None);
}

impl Runtime {
    /// `mapArray(list, map, options)`: the map computed (the accessor is a
    /// read of it). `arity` is `map.length`.
    // Solid: map.ts:67-108 (prod: no dev name wrapper)
    pub fn map_array(
        &mut self,
        list: ListFn,
        map: MapFn,
        arity: usize,
        keyed: Keyed,
        fallback: Option<FallbackFn>,
    ) -> NodeId {
        let key_fn = match &keyed {
            Keyed::Fn(f) => Some(f.clone()),
            _ => None,
        };
        let indexes = arity > 1;
        let by_index = matches!(keyed, Keyed::Index);
        let owner = self.create_owner();
        let d = self.maps.len();
        self.maps.push(MapData {
            owner,
            len: 0,
            list,
            items: new_array(),
            map,
            mappings: new_array(),
            nodes: vec![],
            rows: (key_fn.is_some() || by_index).then(Vec::new),
            key: key_fn,
            indexes: (indexes && !by_index).then(Vec::new),
            by_index,
            fallback,
        });
        let node = self.computed_node(Body::Map(d), None, 0);
        self.nodes[node].config &= !CONFIG_AUTO_DISPOSE;
        node
    }

    /// `signal(v, pureOptions)` (map.ts:110: `{ ownedWrite: true }`).
    // Solid: map.ts:110, 432, 436-437, 446
    fn row_signal(&mut self, v: Value) -> NodeId {
        let n = self.signal_node(v);
        self.nodes[n].config |= CONFIG_OWNED_WRITE;
        n
    }

    /// `x.length` of an array-like (`LengthOfArrayLike`).
    // Solid: map.ts:416
    fn length_of(&mut self, x: &Value) -> Result<usize, Error> {
        match self.js_get(x, &Key::name("length"))? {
            Value::Int(n) if n >= 0 => Ok(n as usize),
            other => panic!("a list whose length is {other:?} is outside the op language"),
        }
    }

    /// `newItems.slice(0)` (ECMA-262 `Array.prototype.slice`): the method
    /// read, `length`, `ArraySpeciesCreate` (`constructor`), then
    /// `HasProperty`/`Get` per index — through the traps on a store proxy.
    /// A hole stays a hole.
    // Solid: map.ts:498, 563, 683; commitSmallMove map.ts:296
    fn slice0(&mut self, a: &Value) -> Result<Obj, Error> {
        match self.js_get(a, &Key::name("slice"))? {
            Value::Func(Builtin::ArrayMethod("slice")) => {}
            other => panic!("newItems.slice is {other:?}: a TypeError is outside the op language"),
        }
        let len = self.length_of(a)?;
        if self.is_array(a) {
            match self.js_get(a, &Key::name("constructor"))? {
                Value::Func(Builtin::ArrayCtor) => {}
                other => panic!("an array's constructor is {other:?}"),
            }
        }
        let out = new_array();
        for k in 0..len as u32 {
            if self.js_has(a, &Key::Idx(k))? {
                let v = self.js_get(a, &Key::Idx(k))?;
                out.set(&Key::Idx(k), v);
            }
        }
        out.set(&Key::name("length"), Value::Int(len as i64));
        Ok(out)
    }

    /// `newItems[j]`.
    // Solid: map.ts:432-450, 541-555 (`newItems[j]`)
    fn item_at(&mut self, new_items: &Value, j: usize) -> Result<Value, Error> {
        self.js_get(new_items, &Key::Idx(j as u32))
    }

    /// `this._items[i]` (a raw array; a hole reads `undefined`).
    // Solid: map.ts:541-555, 642 (`this._items[i]`)
    fn old_item(&self, d: MapId, i: usize) -> Value {
        self.maps[d].items.get(&Key::Idx(i as u32))
    }

    /// `this._key(item)`.
    // Solid: map.ts:329-330, 632, 643
    fn key_of(&mut self, d: MapId, item: Value) -> Result<Value, Error> {
        match self.maps[d].key.clone() {
            Some(k) => k(self, item),
            None => Ok(item),
        }
    }

    // Solid: map.ts:400-401
    fn write_row(&mut self, row: NodeId, v: Value) {
        if !(self.nodes[row].value == v && self.nodes[row].pending.is_none()) {
            self.set_signal(row, v);
        }
    }

    // Solid: map.ts:827-829
    fn compare(&mut self, d: MapId, a: Value, b: Value) -> Result<bool, Error> {
        match self.maps[d].key.clone() {
            Some(key) => {
                let ka = key(self, a)?;
                let kb = key(self, b)?;
                Ok(ka == kb)
            }
            None => Ok(true),
        }
    }

    /// The pass's `mapper` closure (map.ts:429-452) over its stage arrays:
    /// `newItems`, `j` and `slot` are the closure's variables.
    // Solid: map.ts:429-452
    fn mapper(
        &mut self,
        d: MapId,
        new_items: &Value,
        j: usize,
        slot: usize,
        rows: &mut Stage,
        indexes: &mut Stage,
    ) -> Result<Value, Error> {
        let map = self.maps[d].map.clone();
        if self.maps[d].rows.is_some() {
            if self.maps[d].by_index {
                let v = self.item_at(new_items, j)?;
                let r = self.row_signal(v);
                stage_set(rows.as_mut().unwrap(), slot, Some(r));
                map(
                    self,
                    MapArg::Accessor(r),
                    MapArg::Value(Value::Int(j as i64)),
                )
            } else {
                let v = self.item_at(new_items, j)?;
                let r = self.row_signal(v);
                stage_set(rows.as_mut().unwrap(), slot, Some(r));
                if indexes.is_some() {
                    let ix = self.row_signal(Value::Int(j as i64));
                    stage_set(indexes.as_mut().unwrap(), slot, Some(ix));
                }
                let index = match indexes {
                    Some(ix) => MapArg::Accessor(ix[slot].unwrap()),
                    None => MapArg::Value(Value::Undef),
                };
                map(self, MapArg::Accessor(r), index)
            }
        } else if self.maps[d].indexes.is_some() {
            let item = self.item_at(new_items, j)?;
            let ix = self.row_signal(Value::Int(j as i64));
            stage_set(indexes.as_mut().unwrap(), slot, Some(ix));
            map(self, MapArg::Value(item), MapArg::Accessor(ix))
        } else {
            let item = self.item_at(new_items, j)?;
            map(self, MapArg::Value(item), MapArg::Value(Value::Undef))
        }
    }

    // Solid: map.ts:403-702
    pub(super) fn update_keyed_map(&mut self, d: MapId) -> Result<Value, Error> {
        let owner = self.maps[d].owner;
        self.nodes[owner].parent_computed = self.context;
        let list = self.maps[d].list.clone();
        let got = list(self)?;
        let mut new_items = if got.truthy() {
            got
        } else {
            Value::Obj(new_array())
        };
        // Top-level tracking (a store array's container node).
        self.js_get(&new_items, &Key::Sym("$TRACK"))?;
        // `shallowView?.(newItems[$TARGET]) ?? newItems` (the brand is
        // answered by the trap with no reactive read).
        let t = self.target_of(&new_items);
        if let Some(view) = self.shallow_view(t)? {
            new_items = Value::Obj(view);
        }
        let new_len = self.length_of(&new_items)?;
        self.with_owner(Some(owner), |rt| rt.keyed_map_pass(d, &new_items, new_len))?;
        Ok(Value::Obj(self.maps[d].mappings.clone()))
    }

    /// The body `updateKeyedMap` runs under `runWithOwner(this._owner, …)`.
    // Solid: map.ts:418-699
    fn keyed_map_pass(&mut self, d: MapId, new_items: &Value, new_len: usize) -> Result<(), Error> {
        // fast path for empty arrays
        if new_len == 0 {
            if self.maps[d].len != 0 {
                let owner = self.maps[d].owner;
                self.dispose_root_self(owner, false);
                let m = &mut self.maps[d];
                m.nodes = vec![];
                m.items = new_array();
                m.mappings = new_array();
                m.len = 0;
                if m.rows.is_some() {
                    m.rows = Some(vec![]);
                }
                if m.indexes.is_some() {
                    m.indexes = Some(vec![]);
                }
            }
            if let Some(fallback) = self.maps[d].fallback.clone() {
                if self.maps[d].mappings.is_empty() {
                    // an aborted fallback attempt leaves an owner without a
                    // mapping; dispose it before re-creating
                    if let Some(n0) = stage_get(&self.maps[d].nodes, 0) {
                        self.dispose_root(n0);
                    }
                    let mappings = self.maps[d].mappings.clone();
                    let n0 = self.create_owner();
                    stage_set(&mut self.maps[d].nodes, 0, Some(n0));
                    let v = self.with_owner(Some(n0), |rt| fallback(rt))?;
                    mappings.set(&Key::Idx(0), v);
                }
            }
        }
        // fast path for new create
        else if self.maps[d].len == 0 {
            let mut mappings: Vec<Value> = vec![Value::Undef; new_len];
            let mut nodes: Vec<Option<NodeId>> = vec![None; new_len];
            let mut rows: Stage = self.maps[d].rows.as_ref().map(|_| vec![None; new_len]);
            let mut indexes: Stage = self.maps[d].indexes.as_ref().map(|_| vec![None; new_len]);
            let mut j = 0;
            while j < new_len {
                let slot = j;
                let o = self.create_owner();
                nodes[j] = Some(o);
                match self.with_owner(Some(o), |rt| {
                    rt.mapper(d, new_items, j, slot, &mut rows, &mut indexes)
                }) {
                    Ok(v) => mappings[j] = v,
                    Err(err) => {
                        for n in nodes.iter().take(j + 1).flatten() {
                            self.dispose_root(*n);
                        }
                        return Err(err);
                    }
                }
                j += 1;
            }
            // commit
            if let Some(n0) = stage_get(&self.maps[d].nodes, 0) {
                self.dispose_root(n0); // previous fallback
            }
            let m = &mut self.maps[d];
            m.mappings = JsObj::new_array(mappings);
            m.nodes = nodes;
            if rows.is_some() {
                m.rows = rows;
            }
            if indexes.is_some() {
                m.indexes = indexes;
            }
            let items = self.slice0(new_items)?;
            self.maps[d].items = items;
            self.maps[d].len = new_len;
        } else {
            self.keyed_map_general(d, new_items, new_len)?;
        }
        Ok(())
    }

    /// The general path of the pass (map.ts:500-698).
    // Solid: map.ts:500-698
    fn keyed_map_general(
        &mut self,
        d: MapId,
        new_items: &Value,
        new_len: usize,
    ) -> Result<(), Error> {
        let len = self.maps[d].len;
        let has_rows = self.maps[d].rows.is_some();
        // CARVE 2: the lane-slot arm (`_landOnOverride`, F1) went with the
        // engine; every slot write is `writeRow`/`setSignal`.

        // skip common prefix
        let mut start: i64 = 0;
        let end0 = len.min(new_len) as i64;
        while start < end0 {
            let old = self.old_item(d, start as usize);
            let same = old == self.item_at(new_items, start as usize)? || {
                has_rows && {
                    let b = self.item_at(new_items, start as usize)?;
                    self.compare(d, old, b)?
                }
            };
            if !same {
                break;
            }
            if has_rows {
                let row = self.maps[d].rows.as_ref().unwrap()[start as usize].unwrap();
                let v = self.item_at(new_items, start as usize)?;
                self.write_row(row, v);
            }
            start += 1;
        }

        // skip common suffix — counted only
        let mut end = len as i64 - 1;
        let mut new_end = new_len as i64 - 1;
        while end >= start && new_end >= start {
            let old = self.old_item(d, end as usize);
            let same = old == self.item_at(new_items, new_end as usize)? || {
                has_rows && {
                    let b = self.item_at(new_items, new_end as usize)?;
                    self.compare(d, old, b)?
                }
            };
            if !same {
                break;
            }
            end -= 1;
            new_end -= 1;
        }

        // no structural change: keep the same mapped array identity
        if start == new_len as i64 && len == new_len {
            let items = self.slice0(new_items)?;
            self.maps[d].items = items;
            return Ok(());
        }

        // SMALL-MOVE FAST PATH (large trimmed windows, plain identity mode)
        if new_len <= len
            && end - start > 64
            && self.maps[d].rows.is_none()
            && self.maps[d].indexes.is_none()
        {
            let m = start + ((new_end - start) >> 1);
            let probe = self.item_at(new_items, m as usize)?;
            let hi = end.min(m + 32);
            let mut k = start.max(m - 32);
            while k <= hi && self.old_item(d, k as usize) != probe {
                k += 1;
            }
            if k <= hi && self.try_small_move(d, new_items, new_len, start as usize)? {
                return Ok(());
            }
        }

        let dif = new_len as i64 - len as i64;
        // WINDOW-SIZED STAGING, IN-PLACE COMMIT
        let w_len = (new_end - start + 1) as usize;
        let mut temp: Vec<Value> = vec![Value::Undef; new_len];
        let mut temp_nodes: Vec<Option<NodeId>> = vec![None; w_len];
        let mut rows: Stage = has_rows.then(|| vec![None; w_len]);
        let mut indexes: Stage = self.maps[d].indexes.is_some().then(|| vec![None; w_len]);
        let mut removed: Option<Vec<NodeId>> = None;

        // A shrinking pass is tried as a pure removal first.
        let pure = if dif < 0 {
            self.stage_removal(
                d,
                new_items,
                start,
                end,
                new_end,
                &mut temp,
                &mut temp_nodes,
                &mut rows,
                &mut indexes,
            )?
        } else {
            None
        };
        if let Some(pure) = pure {
            if !pure.is_empty() {
                removed = Some(pure);
            }
        } else {
            // 0) a map of all indices in the changed window of newItems,
            // scanned backwards so they chain in natural order
            let mut new_indices: Vec<(Value, i64)> = vec![];
            let mut new_indices_next: Vec<i64> = vec![0; w_len];
            let mut j = new_end;
            while j >= start {
                let item = self.item_at(new_items, j as usize)?;
                let key = self.key_of(d, item)?;
                let i = map_get(&new_indices, &key);
                new_indices_next[(j - start) as usize] = i.unwrap_or(-1);
                map_set(&mut new_indices, key, j);
                j -= 1;
            }

            // 1) stage the old window's survivors at their new positions;
            // queue the others for disposal at commit
            let mut i = start;
            while i <= end {
                let item = self.old_item(d, i as usize);
                let key = self.key_of(d, item)?;
                let j = map_get(&new_indices, &key);
                match j {
                    Some(j) if j != -1 => {
                        let w = (j - start) as usize;
                        temp[j as usize] = self.maps[d].mappings.get(&Key::Idx(i as u32));
                        temp_nodes[w] = self.maps[d].nodes[i as usize];
                        if let Some(r) = rows.as_mut() {
                            r[w] = self.maps[d].rows.as_ref().unwrap()[i as usize];
                        }
                        if let Some(x) = indexes.as_mut() {
                            x[w] = self.maps[d].indexes.as_ref().unwrap()[i as usize];
                        }
                        let next = new_indices_next[w];
                        map_set(&mut new_indices, key, next);
                    }
                    _ => {
                        removed
                            .get_or_insert_with(Vec::new)
                            .push(self.maps[d].nodes[i as usize].unwrap());
                    }
                }
                i += 1;
            }

            // 2) create new rows into the window stage; an abort disposes
            // only these
            let mut created: Option<Vec<NodeId>> = None;
            let mut j = start;
            while j <= new_end {
                let w = (j - start) as usize;
                if temp_nodes[w].is_some() {
                    j += 1;
                    continue;
                }
                let o = self.create_owner();
                temp_nodes[w] = Some(o);
                created.get_or_insert_with(Vec::new).push(o);
                let slot = w;
                match self.with_owner(Some(o), |rt| {
                    rt.mapper(d, new_items, j as usize, slot, &mut rows, &mut indexes)
                }) {
                    Ok(v) => temp[j as usize] = v,
                    Err(err) => {
                        if let Some(created) = created {
                            for c in created {
                                self.dispose_root(c);
                            }
                        }
                        return Err(err);
                    }
                }
                j += 1;
            }
        }

        // 3) commit
        for i in 0..start {
            temp[i as usize] = self.maps[d].mappings.get(&Key::Idx(i as u32));
        }
        let mut j = new_end + 1;
        while j < new_len as i64 {
            temp[j as usize] = self.maps[d].mappings.get(&Key::Idx((j - dif) as u32));
            j += 1;
        }
        self.commit_window(
            d,
            new_items,
            new_len,
            start,
            end,
            new_end,
            &temp_nodes,
            &rows,
            &indexes,
        )?;
        self.maps[d].mappings = JsObj::new_array(temp);
        self.maps[d].len = new_len;
        // save a copy of the mapped items for the next update
        let items = self.slice0(new_items)?;
        self.maps[d].items = items;
        if let Some(removed) = removed {
            for r in removed {
                self.dispose_root(r);
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    // Solid: map.ts:312-342
    fn stage_removal(
        &mut self,
        d: MapId,
        new_items: &Value,
        start: i64,
        end: i64,
        new_end: i64,
        temp: &mut [Value],
        temp_nodes: &mut [Option<NodeId>],
        rows: &mut Stage,
        indexes: &mut Stage,
    ) -> Result<Option<Vec<NodeId>>, Error> {
        let has_key = self.maps[d].key.is_some();
        let mut removed: Vec<NodeId> = vec![];
        let mut i = start;
        let mut j = start;
        while j <= new_end {
            let ni = self.item_at(new_items, j as usize)?;
            let nk = if has_key { self.key_of(d, ni)? } else { ni };
            while i <= end && {
                let oi = self.old_item(d, i as usize);
                let ok = if has_key { self.key_of(d, oi)? } else { oi };
                ok != nk
            } {
                removed.push(self.maps[d].nodes[i as usize].unwrap());
                i += 1;
            }
            if i > end {
                temp_nodes.fill(None);
                return Ok(None);
            }
            let w = (j - start) as usize;
            temp[j as usize] = self.maps[d].mappings.get(&Key::Idx(i as u32));
            temp_nodes[w] = self.maps[d].nodes[i as usize];
            if let Some(r) = rows.as_mut() {
                r[w] = self.maps[d].rows.as_ref().unwrap()[i as usize];
            }
            if let Some(x) = indexes.as_mut() {
                x[w] = self.maps[d].indexes.as_ref().unwrap()[i as usize];
            }
            i += 1;
            j += 1;
        }
        while i <= end {
            removed.push(self.maps[d].nodes[i as usize].unwrap());
            i += 1;
        }
        Ok(Some(removed))
    }

    #[allow(clippy::too_many_arguments)]
    // Solid: map.ts:350-397
    fn commit_window(
        &mut self,
        d: MapId,
        new_items: &Value,
        new_len: usize,
        start: i64,
        end: i64,
        new_end: i64,
        temp_nodes: &[Option<NodeId>],
        rows: &Stage,
        indexes: &Stage,
    ) -> Result<(), Error> {
        let old_len = self.maps[d].len as i64;
        let dif = new_len as i64 - old_len;
        {
            let m = &mut self.maps[d];
            if dif > 0 {
                // Grow first.
                set_length(&mut m.nodes, new_len);
                if let Some(r) = m.rows.as_mut() {
                    set_length(r, new_len);
                }
                if let Some(x) = m.indexes.as_mut() {
                    set_length(x, new_len);
                }
                let (mut i, mut j) = (old_len - 1, new_len as i64 - 1);
                while i > end {
                    m.nodes[j as usize] = m.nodes[i as usize];
                    if let Some(r) = m.rows.as_mut() {
                        r[j as usize] = r[i as usize];
                    }
                    if let Some(x) = m.indexes.as_mut() {
                        x[j as usize] = x[i as usize];
                    }
                    i -= 1;
                    j -= 1;
                }
            } else if dif < 0 {
                let (mut i, mut j) = (end + 1, new_end + 1);
                while i < old_len {
                    m.nodes[j as usize] = m.nodes[i as usize];
                    if let Some(r) = m.rows.as_mut() {
                        r[j as usize] = r[i as usize];
                    }
                    if let Some(x) = m.indexes.as_mut() {
                        x[j as usize] = x[i as usize];
                    }
                    i += 1;
                    j += 1;
                }
                set_length(&mut m.nodes, new_len);
                if let Some(r) = m.rows.as_mut() {
                    set_length(r, new_len);
                }
                if let Some(x) = m.indexes.as_mut() {
                    set_length(x, new_len);
                }
            }
        }
        let live_rows = self.maps[d].rows.is_some();
        let live_indexes = self.maps[d].indexes.is_some();
        let mut j = start;
        while j <= new_end {
            let w = (j - start) as usize;
            self.maps[d].nodes[j as usize] = temp_nodes[w];
            if live_rows {
                let row = rows.as_ref().unwrap()[w];
                self.maps[d].rows.as_mut().unwrap()[j as usize] = row;
                let v = self.item_at(new_items, j as usize)?;
                self.write_row(row.unwrap(), v);
            }
            if live_indexes {
                let ix = indexes.as_ref().unwrap()[w];
                self.maps[d].indexes.as_mut().unwrap()[j as usize] = ix;
                self.set_signal(ix.unwrap(), Value::Int(j));
            }
            j += 1;
        }
        let mut j = new_end + 1;
        while j < new_len as i64 {
            if live_rows {
                let row = self.maps[d].rows.as_ref().unwrap()[j as usize].unwrap();
                let v = self.item_at(new_items, j as usize)?;
                self.write_row(row, v);
            }
            if live_indexes && dif != 0 {
                let ix = self.maps[d].indexes.as_ref().unwrap()[j as usize].unwrap();
                self.set_signal(ix, Value::Int(j));
            }
            j += 1;
        }
        Ok(())
    }

    // Solid: map.ts:150-219
    fn try_small_move(
        &mut self,
        d: MapId,
        new_items: &Value,
        new_len: usize,
        start: usize,
    ) -> Result<bool, Error> {
        let old_end = self.maps[d].len as i64 - 1;
        let new_len = new_len as i64;
        let mut src_pos: Vec<i64> = vec![];
        let mut dst_pos: Vec<i64> = vec![];
        let mut runs: Vec<i64> = vec![]; // flat triples: oldStart, newStart, length
        let mut budget: i64 = 256;
        let mut i = start as i64;
        let mut j = start as i64;
        let mut in_run = false;
        while i <= old_end && j < new_len {
            let old_item = self.old_item(d, i as usize);
            let new_item = self.item_at(new_items, j as usize)?;
            if old_item == new_item {
                if !in_run {
                    runs.extend([i, j, 0]);
                    in_run = true;
                }
                *runs.last_mut().unwrap() += 1;
                i += 1;
                j += 1;
                continue;
            }
            in_run = false;
            // Bounded realignment lookahead, shorter distance wins.
            let mut del: i64 = -1;
            let mut lim = (32 - src_pos.len() as i64).min(old_end - i).min(budget);
            let mut a = 1;
            while a <= lim {
                if self.old_item(d, (i + a) as usize) == new_item {
                    del = a;
                    break;
                }
                a += 1;
            }
            budget -= if del == -1 { lim } else { del };
            let mut ins: i64 = -1;
            lim = (32 - dst_pos.len() as i64).min(new_len - 1 - j).min(budget);
            let mut a = 1;
            while a <= lim {
                if self.item_at(new_items, (j + a) as usize)? == old_item {
                    ins = a;
                    break;
                }
                a += 1;
            }
            budget -= if ins == -1 { lim } else { ins };
            if del != -1 && (ins == -1 || del <= ins) {
                while del > 0 {
                    del -= 1;
                    src_pos.push(i);
                    i += 1;
                }
                continue;
            }
            if ins != -1 {
                while ins > 0 {
                    ins -= 1;
                    dst_pos.push(j);
                    j += 1;
                }
                continue;
            }
            if budget <= 0 || src_pos.len() == 32 || dst_pos.len() == 32 {
                return Ok(false);
            }
            src_pos.push(i);
            i += 1;
            dst_pos.push(j);
            j += 1;
        }
        while i <= old_end {
            if src_pos.len() == 32 {
                return Ok(false);
            }
            src_pos.push(i);
            i += 1;
        }
        while j < new_len {
            if dst_pos.len() == 32 {
                return Ok(false);
            }
            dst_pos.push(j);
            j += 1;
        }
        self.commit_small_move(d, new_items, new_len as usize, src_pos, dst_pos, runs)
    }

    // Solid: map.ts:228-302
    fn commit_small_move(
        &mut self,
        d: MapId,
        new_items: &Value,
        new_len: usize,
        src_pos: Vec<i64>,
        mut dst_pos: Vec<i64>,
        runs: Vec<i64>,
    ) -> Result<bool, Error> {
        let mut consumed: Option<Vec<bool>> = None;
        if !dst_pos.is_empty() {
            let mut c = vec![false; src_pos.len()];
            for dst in dst_pos.iter_mut() {
                let mut found: i64 = -1;
                for (i, s) in src_pos.iter().enumerate() {
                    if !c[i]
                        && self.old_item(d, *s as usize)
                            == self.item_at(new_items, *dst as usize)?
                    {
                        found = i as i64;
                        break;
                    }
                }
                if found == -1 {
                    return Ok(false);
                }
                c[found as usize] = true;
                *dst = (*dst << 6) | found; // pack pairing (found < 32)
            }
            consumed = Some(c);
        }
        // DUPLICATES: decline a displaced identity that also occurs inside
        // an aligned run.
        if !src_pos.is_empty() || !dst_pos.is_empty() {
            let mut displaced: Vec<Value> = vec![];
            let mut add = |v: Value| {
                if !displaced.contains(&v) {
                    displaced.push(v);
                }
            };
            for s in &src_pos {
                add(self.old_item(d, *s as usize));
            }
            for p in &dst_pos {
                let v = self.item_at(new_items, (p >> 6) as usize)?;
                add(v);
            }
            for r in runs.chunks(3) {
                let ro = r[0];
                for a in 0..r[2] {
                    if displaced.contains(&self.old_item(d, (ro + a) as usize)) {
                        return Ok(false);
                    }
                }
            }
        }
        // PHASE 2: commit.
        let old_mappings = self.maps[d].mappings.clone();
        let old_nodes = self.maps[d].nodes.clone();
        let mut mappings: Vec<Value> = (0..new_len)
            .map(|i| old_mappings.get(&Key::Idx(i as u32)))
            .collect();
        let mut nodes: Vec<Option<NodeId>> = old_nodes.iter().take(new_len).copied().collect();
        for r in runs.chunks(3) {
            let (ro, rn) = (r[0], r[1]);
            if ro != rn {
                for a in 0..r[2] {
                    mappings[(rn + a) as usize] = old_mappings.get(&Key::Idx((ro + a) as u32));
                    nodes[(rn + a) as usize] = old_nodes[(ro + a) as usize];
                }
            }
        }
        for p in &dst_pos {
            let pp = (p >> 6) as usize;
            let q = src_pos[(p & 63) as usize] as usize;
            mappings[pp] = old_mappings.get(&Key::Idx(q as u32));
            nodes[pp] = old_nodes[q];
        }
        self.maps[d].mappings = JsObj::new_array(mappings);
        self.maps[d].nodes = nodes;
        self.maps[d].len = new_len;
        let items = self.slice0(new_items)?;
        self.maps[d].items = items;
        // Dispose unmatched sources LAST (general-path ordering).
        for (i, s) in src_pos.iter().enumerate() {
            if consumed.as_ref().is_none_or(|c| !c[i]) {
                self.dispose_root(old_nodes[*s as usize].unwrap());
            }
        }
        Ok(true)
    }
}

/// `Map.prototype.get` (SameValueZero; the keys here are integers and
/// objects, compared as `===`).
// Solid: map.ts:633, 644 (`newIndices.get`)
fn map_get(m: &[(Value, i64)], k: &Value) -> Option<i64> {
    m.iter().find(|(x, _)| x == k).map(|(_, v)| *v)
}

/// `Map.prototype.set` (an existing key keeps its position).
// Solid: map.ts:635, 651 (`newIndices.set`)
fn map_set(m: &mut Vec<(Value, i64)>, k: Value, v: i64) {
    match m.iter_mut().find(|(x, _)| *x == k) {
        Some(e) => e.1 = v,
        None => m.push((k, v)),
    }
}

//! Solid: universal/src/universal.ts — `createRenderer` of
//! `@solidjs/universal` 2.0.0-rc.21 (solid-next 2105ffb8), the production
//! build (`"_SOLID_OBSERVE_"` is false: `named` returns its options).
//!
//! Ported: `insert`, `insertExpression`, `normalize` (over `flatten`,
//! flatten.rs), `reconcileArrays`, `cleanChildren`, `appendNodes`,
//! `replaceNode`, `collectNodes`/`collectMounted`, `defaultCleanupNodes`,
//! `render`, and the exported `effect`, `memo`, `setProp`,
//! `createComponent` (flow.rs). The host is a `renderer::Renderer`
//! (universal.ts:28-41 `RendererOptions`): `createSentinel` defaults to
//! `createTextNode("")` as in Solid; `cleanupNodes` is not offered (the
//! default is used); `isTextNode` is part of the host but universal.ts
//! never calls it.
//!
//! Not ported: `spread` and its source/view machinery (`collectSources`,
//! `collectProps`, `pushEntry`, `resolveSource`, `entryHas`/`entryGet`),
//! `mergeProps`, `ref`/`applyRef`, `onUpdate` callers other than `render`.
//! The `options.name` fallbacks are dev-only.
//!
//! JS values in flight here are `Value`s: a string or number is
//! `Value::Str`/`Value::Int`, a host node `Value::Node`, a JS array a
//! `Value::Obj` array (compared by identity; `normalize` writes text nodes
//! into it in place, as JS does), an accessor a function value
//! (function.rs). A host call on something that is not a node (JS: a
//! host-dependent `TypeError`) panics.
use super::flatten::FlattenOptions;
use super::*;
use crate::renderer::{Node, Renderer};
use std::cell::RefCell;

/// `insert`'s `marker`: `undefined` (a single child: the parent's content
/// is the expression's), `null` (a region appended at the end) or a node
/// (a region before that sibling).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Marker {
    Undefined,
    Null,
    Node(Node),
}

impl Marker {
    /// `marker !== undefined`.
    fn multi(self) -> bool {
        self != Marker::Undefined
    }
    /// The anchor `insertNode` receives.
    fn anchor(self) -> Option<Node> {
        match self {
            Marker::Node(n) => Some(n),
            _ => None,
        }
    }
}

/// `onUpdate(value)` of `insert`'s options (universal.ts:135).
pub type OnUpdate = Rc<dyn Fn(&mut Runtime, &Value)>;

/// `insert`'s `options` (`RendererEffectOptions` plus `schedule` and
/// `onUpdate`, universal.ts:134-183).
#[derive(Clone, Default)]
pub struct InsertOptions {
    pub schedule: bool,
    pub on_update: Option<OnUpdate>,
}

/// The renderer `createRenderer(options)` returns, over a shared host.
pub struct Universal<R: Renderer + 'static> {
    host: Rc<RefCell<R>>,
    /// `INNER_OWNED` (universal.ts:117): a unique object.
    inner_owned: Value,
}

impl<R: Renderer + 'static> Clone for Universal<R> {
    fn clone(&self) -> Self {
        Universal {
            host: self.host.clone(),
            inner_owned: self.inner_owned.clone(),
        }
    }
}

/// A node operand of a host call.
fn node_of(v: &Value) -> Node {
    match v {
        Value::Node(n) => *n,
        other => {
            panic!("a host call on {other:?} (a TypeError in the host) is outside the value domain")
        }
    }
}

/// `Option<Node>` as the JS value a host getter returns.
fn opt_node(n: Option<Node>) -> Value {
    n.map(Value::Node).unwrap_or(Value::Undef)
}

/// `a[i]` of a JS array snapshot (`undefined` out of range, negative too).
fn at(a: &[Value], i: isize) -> Value {
    if i < 0 {
        return Value::Undef;
    }
    a.get(i as usize).cloned().unwrap_or(Value::Undef)
}

/// `value == null`.
fn is_nullish(v: &Value) -> bool {
    v.is_undef()
}

/// `typeof v === "string" || typeof v === "number"`.
fn is_text_value(v: &Value) -> bool {
    matches!(v, Value::Str(_) | Value::Int(_))
}

/// A JS array's elements (`Value::Obj` arrays only: no store array reaches
/// `insertExpression`, `normalize` returns fresh arrays).
fn elements(v: &Value) -> Vec<Value> {
    match v {
        Value::Obj(o) if o.array => o.elements(),
        other => panic!("{other:?} is not an array"),
    }
}

fn is_array(v: &Value) -> bool {
    matches!(v, Value::Obj(o) if o.array)
}

fn array(items: Vec<Value>) -> Value {
    Value::Obj(JsObj::new_array(items))
}

impl<R: Renderer + 'static> Universal<R> {
    /// `createRenderer(options)`.
    // Solid: universal.ts:118-133
    pub fn new(host: Rc<RefCell<R>>) -> Self {
        Universal {
            host,
            inner_owned: Value::Obj(JsObj::new_object(vec![])),
        }
    }

    pub fn host(&self) -> &Rc<RefCell<R>> {
        &self.host
    }

    // ---- host calls (`RendererOptions`) ----
    fn create_text_node(&self, v: &Value) -> Value {
        Value::Node(self.host.borrow_mut().create_text_value(v))
    }
    fn create_sentinel(&self) -> Value {
        Value::Node(self.host.borrow_mut().create_sentinel())
    }
    fn insert_node(&self, parent: Node, node: &Value, anchor: &Value) {
        let anchor = match anchor {
            Value::Undef => None,
            a => Some(node_of(a)),
        };
        self.host.borrow_mut().insert(parent, node_of(node), anchor);
    }
    fn remove_node(&self, parent: Node, node: &Value) {
        self.host.borrow_mut().remove(parent, node_of(node));
    }
    fn get_parent_node(&self, node: &Value) -> Value {
        opt_node(self.host.borrow().parent(node_of(node)))
    }
    fn get_first_child(&self, node: Node) -> Value {
        opt_node(self.host.borrow().first_child(node))
    }
    fn get_next_sibling(&self, node: &Value) -> Value {
        opt_node(self.host.borrow().next_sibling(node_of(node)))
    }
    fn replace_text(&self, node: &Value, value: &Value) {
        self.host
            .borrow_mut()
            .replace_text_value(node_of(node), value);
    }

    /// The exported `effect` (universal.ts:99-104): `createRenderEffect`
    /// with `sync: true` (and `transparent`, which only shares a hydration
    /// id).
    // Solid: universal.ts:93-104
    pub fn effect(
        &self,
        rt: &mut Runtime,
        compute: BodyFn,
        effect: ValueEffectFn,
        schedule: bool,
    ) -> NodeId {
        rt.render_effect_opts(
            compute,
            effect,
            EffectOptions {
                sync: true,
                schedule,
                defer: false,
            },
        )
    }

    /// The exported `memo` (universal.ts:105): `createMemo(() => fn(),
    /// { sync: true })`, its accessor. `equal` is ignored, as in Solid.
    // Solid: universal.ts:105
    pub fn memo(&self, rt: &mut Runtime, f: flow::Getter) -> Value {
        let n = rt.memo_with(
            Rc::new(move |rt: &mut Runtime, _| f(rt).map(Out::Value)),
            None,
            true,
        );
        rt.accessor(n)
    }

    /// The exported `setProp` (universal.ts:619-622).
    // Solid: universal.ts:619-622
    pub fn set_prop(&self, node: Node, name: &str, value: &Value, prev: &Value) -> Value {
        self.host.borrow_mut().set_property(node, name, value, prev);
        value.clone()
    }

    /// The exported `createElement` / `createTextNode` / `insertNode`.
    pub fn create_element(&self, tag: &str) -> Node {
        self.host.borrow_mut().create_element(tag)
    }
    pub fn create_text(&self, value: &Value) -> Node {
        self.host.borrow_mut().create_text_value(value)
    }
    pub fn append(&self, parent: Node, node: Node, anchor: Option<Node>) {
        self.host.borrow_mut().insert(parent, node, anchor);
    }

    /// `insert(parent, accessor, marker, initial, options)`.
    // Solid: universal.ts:134-183
    pub fn insert(
        &self,
        rt: &mut Runtime,
        parent: Node,
        accessor: Value,
        marker: Marker,
        initial: Option<Value>,
        options: InsertOptions,
    ) -> Result<(), Error> {
        let on_update = options.on_update.clone();
        // `effectOptions`: the options without `onUpdate`; `named` is the
        // identity in production.
        let schedule = options.schedule;
        let multi = marker.multi();
        let mut initial = initial.unwrap_or(Value::Undef);
        if multi && !initial.truthy() {
            initial = array(vec![]);
        }
        let mut accessor = accessor;
        if !matches!(accessor, Value::Func(_)) {
            accessor = self.normalize(rt, accessor, multi, true)?;
            if !matches!(accessor, Value::Func(_)) {
                self.insert_expression(parent, &accessor, &initial, marker);
                if let Some(f) = &on_update {
                    f(rt, &accessor);
                }
                return Ok(());
            }
        }
        if multi && elements(&initial).is_empty() {
            let sentinel = self.create_sentinel();
            self.insert_node(parent, &sentinel, &opt_node(marker.anchor()));
            initial = array(vec![sentinel]);
        }
        let current = Rc::new(RefCell::new(initial));
        let compute: BodyFn = {
            let (this, current, on_update) = (self.clone(), current.clone(), on_update.clone());
            Rc::new(move |rt: &mut Runtime, prev: Value| {
                let a = rt.call(&accessor, &[])?;
                let value = this.normalize(rt, a, multi, true)?;
                if !matches!(value, Value::Func(_)) {
                    return Ok(Out::Value(value));
                }
                let inner_compute: BodyFn = {
                    let this = this.clone();
                    Rc::new(move |rt: &mut Runtime, _| {
                        this.normalize(rt, value.clone(), multi, false)
                            .map(Out::Value)
                    })
                };
                let inner_effect: ValueEffectFn = {
                    let (this, current, on_update) =
                        (this.clone(), current.clone(), on_update.clone());
                    Rc::new(move |rt: &mut Runtime, inner: Value, _prev: Value| {
                        let cur = current.borrow().clone();
                        this.insert_expression(parent, &inner, &cur, marker);
                        *current.borrow_mut() = inner;
                        if let Some(f) = &on_update {
                            let cur = current.borrow().clone();
                            f(rt, &cur);
                        }
                        None
                    })
                };
                // `prev !== undefined && !(options && options.schedule)
                //   ? { ...effectOptions, schedule: true } : effectOptions`
                let inner_schedule = if !prev.is_undef() && !schedule {
                    true
                } else {
                    schedule
                };
                this.effect(rt, inner_compute, inner_effect, inner_schedule);
                Ok(Out::Value(this.inner_owned.clone()))
            })
        };
        let apply: ValueEffectFn = {
            let (this, current) = (self.clone(), current.clone());
            Rc::new(move |rt: &mut Runtime, value: Value, _prev: Value| {
                if value == this.inner_owned {
                    return None;
                }
                let cur = current.borrow().clone();
                this.insert_expression(parent, &value, &cur, marker);
                *current.borrow_mut() = value;
                if let Some(f) = &on_update {
                    let cur = current.borrow().clone();
                    f(rt, &cur);
                }
                None
            })
        };
        self.effect(rt, compute, apply, schedule);
        Ok(())
    }

    /// `insertExpression(parent, value, current, marker)`.
    // Solid: universal.ts:185-220
    fn insert_expression(&self, parent: Node, value: &Value, current: &Value, marker: Marker) {
        if value == current {
            return;
        }
        let multi = marker.multi();
        let m = opt_node(marker.anchor());
        if is_text_value(value) {
            if is_text_value(current) {
                let first = self.get_first_child(parent);
                self.replace_text(&first, value);
            } else {
                let t = self.create_text_node(value);
                self.clean_children(parent, current, marker, Some(&t));
            }
        } else if is_nullish(value) {
            self.clean_children(parent, current, marker, None);
        } else if is_array(value) {
            if elements(value).is_empty() {
                self.clean_children(parent, current, marker, None);
            } else if is_array(current) {
                if elements(current).is_empty() {
                    self.append_nodes(parent, value, &m);
                } else {
                    self.reconcile_arrays(parent, &elements(current), &elements(value));
                }
            } else if is_nullish(current) {
                self.append_nodes(parent, value, &Value::Undef);
            } else {
                // `(multi && current) || [getFirstChild(parent)]`
                let a = if multi && current.truthy() {
                    elements(current)
                } else {
                    vec![self.get_first_child(parent)]
                };
                self.reconcile_arrays(parent, &a, &elements(value));
            }
        } else if is_array(current) {
            let marker = if multi { marker } else { Marker::Null };
            self.clean_children(parent, current, marker, Some(value));
        } else if is_nullish(current) || !self.get_first_child(parent).truthy() {
            self.insert_node(parent, value, &Value::Undef);
        } else {
            let first = self.get_first_child(parent);
            self.replace_node(parent, value, &first);
        }
    }

    /// `normalize(value, multi, doNotUnwrap)`.
    // Solid: universal.ts:222-237
    pub fn normalize(
        &self,
        rt: &mut Runtime,
        value: Value,
        multi: bool,
        do_not_unwrap: bool,
    ) -> Result<Value, Error> {
        let mut value = rt.flatten(
            value,
            FlattenOptions {
                skip_non_rendered: true,
                do_not_unwrap,
            },
        )?;
        if do_not_unwrap && matches!(value, Value::Func(_)) {
            return Ok(value);
        }
        if multi && !rt.is_array(&value) {
            value = array(vec![if !is_nullish(&value) {
                value
            } else {
                Value::str("")
            }]);
        }
        // An empty region keeps a sentinel (#4274).
        else if multi && elements(&value).is_empty() {
            value = array(vec![self.create_sentinel()]);
        }
        if rt.is_array(&value) {
            let Value::Obj(o) = &value else {
                panic!("a store array as a rendered value is outside the value domain")
            };
            let mut i = 0;
            while i < o.len() {
                let item = o.get(&Key::Idx(i));
                if is_text_value(&item) {
                    let t = self.create_text_node(&item);
                    o.set(&Key::Idx(i), t);
                }
                i += 1;
            }
        }
        Ok(value)
    }

    /// `reconcileArrays(parentNode, a, b)`: the arrays are read-only here,
    /// so they are snapshots.
    // Solid: universal.ts:239-316
    fn reconcile_arrays(&self, parent_node: Node, a: &[Value], b: &[Value]) {
        let b_length = b.len() as isize;
        let mut a_end = a.len() as isize;
        let mut b_end = b_length;
        let mut a_start: isize = 0;
        let mut b_start: isize = 0;
        let after = self.get_next_sibling(&at(a, a_end - 1));
        let mut map: Option<Vec<(Value, isize)>> = None;

        // `const isLive = n => n && getParentNode(n) === parentNode;`
        let is_live = |n: &Value| n.truthy() && self.get_parent_node(n) == Value::Node(parent_node);
        let map_get = |map: &Option<Vec<(Value, isize)>>, k: &Value| -> Option<isize> {
            map.as_ref()
                .and_then(|m| m.iter().find(|(x, _)| x == k).map(|(_, i)| *i))
        };

        while a_start < a_end || b_start < b_end {
            // common prefix
            if at(a, a_start) == at(b, b_start) && is_live(&at(a, a_start)) {
                a_start += 1;
                b_start += 1;
                continue;
            }
            // common suffix
            while at(a, a_end - 1) == at(b, b_end - 1) && is_live(&at(a, a_end - 1)) {
                a_end -= 1;
                b_end -= 1;
            }
            // append
            if a_end == a_start {
                let node = if b_end < b_length {
                    if b_start != 0 {
                        self.get_next_sibling(&at(b, b_start - 1))
                    } else {
                        at(b, b_end - b_start)
                    }
                } else {
                    after.clone()
                };
                while b_start < b_end {
                    self.insert_node(parent_node, &at(b, b_start), &node);
                    b_start += 1;
                }
                // remove
            } else if b_end == b_start {
                while a_start < a_end {
                    if map.is_none() || map_get(&map, &at(a, a_start)).is_none() {
                        self.remove_node(parent_node, &at(a, a_start));
                    }
                    a_start += 1;
                }
                // swap backward
            } else if at(a, a_start) == at(b, b_end - 1) && at(b, b_start) == at(a, a_end - 1) {
                let anchor = at(a, a_start);
                loop {
                    a_end -= 1;
                    self.insert_node(parent_node, &at(a, a_end), &anchor);
                    b_start += 1;
                    if a_start >= a_end - 1 || b_start >= b_end {
                        break;
                    }
                    if !(at(a, a_start) == at(b, b_end - 1) && at(b, b_start) == at(a, a_end - 1)) {
                        break;
                    }
                }
                // fallback to map
            } else {
                if map.is_none() {
                    // `map.set(b[i], i++)`: a later duplicate overwrites.
                    let mut m: Vec<(Value, isize)> = vec![];
                    let mut i = b_start;
                    while i < b_end {
                        let k = at(b, i);
                        match m.iter_mut().find(|(x, _)| *x == k) {
                            Some(slot) => slot.1 = i,
                            None => m.push((k, i)),
                        }
                        i += 1;
                    }
                    map = Some(m);
                }

                let index = map_get(&map, &at(a, a_start));
                if let Some(index) = index {
                    if b_start < index && index < b_end {
                        let mut i = a_start;
                        let mut sequence = 1;
                        loop {
                            i += 1;
                            if !(i < a_end && i < b_end) {
                                break;
                            }
                            match map_get(&map, &at(a, i)) {
                                Some(t) if t == index + sequence => {}
                                _ => break,
                            }
                            sequence += 1;
                        }

                        if sequence > index - b_start {
                            let node = at(a, a_start);
                            while b_start < index {
                                self.insert_node(parent_node, &at(b, b_start), &node);
                                b_start += 1;
                            }
                        } else {
                            self.replace_node(parent_node, &at(b, b_start), &at(a, a_start));
                            b_start += 1;
                            a_start += 1;
                        }
                    } else {
                        a_start += 1;
                    }
                } else {
                    self.remove_node(parent_node, &at(a, a_start));
                    a_start += 1;
                }
            }
        }
    }

    /// `cleanChildren(parent, current, marker, replacement)`.
    // Solid: universal.ts:318-339
    fn clean_children(
        &self,
        parent: Node,
        current: &Value,
        marker: Marker,
        replacement: Option<&Value>,
    ) {
        if marker == Marker::Undefined {
            loop {
                let removed = self.get_first_child(parent);
                if !removed.truthy() {
                    break;
                }
                self.remove_node(parent, &removed);
            }
            if let Some(r) = replacement {
                self.insert_node(parent, r, &Value::Undef);
            }
            return;
        }
        let m = opt_node(marker.anchor());
        let current = elements(current);
        if !current.is_empty() {
            let mut inserted = false;
            let mut i = current.len() as isize - 1;
            while i >= 0 {
                let el = &current[i as usize];
                if replacement != Some(el) {
                    let is_parent = self.get_parent_node(el) == Value::Node(parent);
                    match replacement {
                        Some(r) if !inserted && i == 0 => {
                            if is_parent {
                                self.replace_node(parent, r, el);
                            } else {
                                self.insert_node(parent, r, &m);
                            }
                        }
                        _ => {
                            if is_parent {
                                self.remove_node(parent, el);
                            }
                        }
                    }
                } else {
                    inserted = true;
                }
                i -= 1;
            }
        } else if let Some(r) = replacement {
            self.insert_node(parent, r, &m);
        }
    }

    /// `appendNodes(parent, array, marker)`.
    // Solid: universal.ts:341-343
    fn append_nodes(&self, parent: Node, array: &Value, marker: &Value) {
        for n in elements(array) {
            self.insert_node(parent, &n, marker);
        }
    }

    /// `replaceNode(parent, newNode, oldNode)`.
    // Solid: universal.ts:345-348
    fn replace_node(&self, parent: Node, new_node: &Value, old_node: &Value) {
        self.insert_node(parent, new_node, old_node);
        self.remove_node(parent, old_node);
    }

    /// `collectNodes(value, nodes)`.
    // Solid: universal.ts:350-357
    fn collect_nodes(value: &Value, nodes: &mut Vec<Value>) {
        if is_array(value) {
            for v in elements(value) {
                Self::collect_nodes(&v, nodes);
            }
        } else if !is_nullish(value) && !is_text_value(value) {
            nodes.push(value.clone());
        }
    }

    /// `collectMounted(parent, value)`.
    // Solid: universal.ts:359-366
    fn collect_mounted(&self, parent: Node, value: &Value) -> Vec<Value> {
        let mut nodes = vec![];
        Self::collect_nodes(value, &mut nodes);
        if nodes.is_empty() && is_text_value(value) {
            let node = self.get_first_child(parent);
            if node.truthy() {
                nodes.push(node);
            }
        }
        nodes
    }

    /// `defaultCleanupNodes(parent, nodes)`.
    // Solid: universal.ts:368-373
    fn default_cleanup_nodes(&self, parent: Node, nodes: &[Value]) {
        for node in nodes {
            if self.get_parent_node(node) == Value::Node(parent) {
                self.remove_node(parent, node);
            }
        }
    }

    /// `render(code, element)`: mounts `code()` into `element` under a new
    /// root, drains the queued mount with `flush()`, and returns the
    /// disposer. A throw from `code` disposes the root, removes what was
    /// mounted and is returned.
    // Solid: universal.ts:576-613
    pub fn render(
        &self,
        rt: &mut Runtime,
        code: flow::Getter,
        element: Node,
    ) -> Result<Disposer<R>, Error> {
        let mounted: Rc<RefCell<Vec<Value>>> = Rc::new(RefCell::new(vec![]));
        // `root(dispose => { … })`
        let root = rt.create_root();
        let r = rt.with_owner(Some(root), |rt| -> Result<(), Error> {
            let tree = code(rt)?;
            let on_update: OnUpdate = {
                let (this, mounted) = (self.clone(), mounted.clone());
                Rc::new(move |_rt: &mut Runtime, value: &Value| {
                    *mounted.borrow_mut() = this.collect_mounted(element, value);
                })
            };
            let accessor = rt.function(0, Rc::new(move |_, _| Ok(tree.clone())));
            self.insert(
                rt,
                element,
                accessor,
                Marker::Undefined,
                None,
                InsertOptions {
                    schedule: true,
                    on_update: Some(on_update),
                },
            )
        });
        if let Err(err) = r {
            rt.dispose_root(root);
            self.default_cleanup_nodes(element, &mounted.borrow());
            return Err(err);
        }
        // Drain the queued mount (universal.ts:596-600).
        rt.flush();
        Ok(Disposer {
            universal: self.clone(),
            root,
            element,
            mounted,
            disposed: false,
        })
    }
}

/// The function `render` returns.
pub struct Disposer<R: Renderer + 'static> {
    universal: Universal<R>,
    root: NodeId,
    element: Node,
    mounted: Rc<RefCell<Vec<Value>>>,
    disposed: bool,
}

impl<R: Renderer + 'static> Disposer<R> {
    // Solid: universal.ts:606-612
    pub fn dispose(&mut self, rt: &mut Runtime) {
        if self.disposed {
            return;
        }
        self.disposed = true;
        rt.dispose_root(self.root);
        let nodes = self.mounted.borrow().clone();
        self.universal.default_cleanup_nodes(self.element, &nodes);
        *self.mounted.borrow_mut() = vec![];
    }
}

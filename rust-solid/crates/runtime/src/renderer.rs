//! Host operations: the plan evaluator's (`TextRenderer`) and the ported
//! `@solidjs/universal` renderer's (`slice1::Universal`, whose
//! `RendererOptions` this trait is, universal.ts:28-41). No runtime state
//! lives here. `TreeRenderer` records every host call for the renderer
//! differential test (fuzz/universal.mjs, `node fuzz/run.mjs --render`).
use crate::slice1::events::{self, Assigned, Delegation, EventHost, Listener};
use crate::slice1::{Error, JsObj, Key, Runtime, Value};
use serde_json::{json, Value as J};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    rc::Rc,
};
pub type Node = usize;
pub trait Renderer {
    fn create_element(&mut self, tag: &str) -> Node;
    fn create_text(&mut self, text: &str) -> Node;
    fn replace_text(&mut self, node: Node, text: &str);
    fn set_prop(&mut self, node: Node, name: &str, value: &str);
    fn insert(&mut self, parent: Node, node: Node, anchor: Option<Node>);
    fn remove(&mut self, parent: Node, node: Node);
    fn parent(&self, node: Node) -> Option<Node>;
    fn next_sibling(&self, node: Node) -> Option<Node>;
    fn event(&mut self, node: Node, name: &str, handler: &str);
    /// `getFirstChild(node)`.
    fn first_child(&self, node: Node) -> Option<Node>;
    /// `isTextNode(node)` (part of `RendererOptions`; universal.ts never
    /// calls it).
    fn is_text(&self, node: Node) -> bool;
    /// `createTextNode(value)` with the JS value universal passes: a string
    /// or a number (`normalize`, `insertExpression`). A host that keeps
    /// only text converts it with `ToString`.
    fn create_text_value(&mut self, value: &Value) -> Node {
        let text = value
            .to_js_string()
            .unwrap_or_else(|| panic!("createTextNode({value:?}) is outside the value domain"));
        self.create_text(&text)
    }
    /// `replaceText(node, value)` with a string or a number.
    fn replace_text_value(&mut self, node: Node, value: &Value) {
        let text = value
            .to_js_string()
            .unwrap_or_else(|| panic!("replaceText({value:?}) is outside the value domain"));
        self.replace_text(node, &text)
    }
    /// `createSentinel()`; Solid's default is `createTextNode("")`
    /// (universal.ts:123).
    fn create_sentinel(&mut self) -> Node {
        self.create_text_value(&Value::str(""))
    }
    /// `setProperty(node, name, value, prev)` with JS values. The default
    /// keeps a string or number as a text prop and refuses anything else.
    fn set_property(&mut self, node: Node, name: &str, value: &Value, _prev: &Value) {
        let text = value.to_js_string().unwrap_or_else(|| {
            panic!("setProperty({name}, {value:?}) is outside the value domain")
        });
        self.set_prop(node, name, &text)
    }
}
#[derive(Default)]
struct Item {
    tag: Option<String>,
    text: String,
    props: BTreeMap<String, String>,
    events: BTreeMap<String, String>,
    children: Vec<Node>,
    parent: Option<Node>,
}
#[derive(Default)]
pub struct TextRenderer {
    items: Vec<Item>,
}
impl TextRenderer {
    pub fn handler(&self, node: Node, name: &str) -> Option<String> {
        self.items[node].events.get(name).cloned()
    }
    pub fn clickable(&self, root: Node) -> Vec<Node> {
        let mut out = Vec::new();
        if self.items[root].events.contains_key("onClick") {
            out.push(root)
        }
        for n in &self.items[root].children {
            out.extend(self.clickable(*n))
        }
        out
    }
    pub fn find(&self, root: Node, tag: &str) -> Option<Node> {
        if self.items[root].tag.as_deref() == Some(tag) {
            return Some(root);
        }
        self.items[root]
            .children
            .iter()
            .find_map(|n| self.find(*n, tag))
    }
    pub fn frame(&self, root: Node) -> String {
        let n = &self.items[root];
        if n.tag.is_none() {
            return n.text.clone();
        }
        n.children.iter().map(|n| self.frame(*n)).collect()
    }
}
impl Renderer for TextRenderer {
    fn create_element(&mut self, tag: &str) -> Node {
        let id = self.items.len();
        self.items.push(Item {
            tag: Some(tag.into()),
            ..Item::default()
        });
        id
    }
    fn create_text(&mut self, text: &str) -> Node {
        let id = self.items.len();
        self.items.push(Item {
            text: text.into(),
            ..Item::default()
        });
        id
    }
    fn replace_text(&mut self, node: Node, text: &str) {
        assert!(self.items[node].tag.is_none());
        self.items[node].text = text.into();
    }
    fn set_prop(&mut self, node: Node, name: &str, value: &str) {
        self.items[node].props.insert(name.into(), value.into());
    }
    fn insert(&mut self, parent: Node, node: Node, anchor: Option<Node>) {
        if anchor == Some(node) {
            return;
        }
        if let Some(old) = self.parent(node) {
            self.remove(old, node);
        }
        let at = anchor
            .map(|a| {
                self.items[parent]
                    .children
                    .iter()
                    .position(|n| *n == a)
                    .expect("anchor is not a child")
            })
            .unwrap_or(self.items[parent].children.len());
        self.items[parent].children.insert(at, node);
        self.items[node].parent = Some(parent);
    }
    fn remove(&mut self, parent: Node, node: Node) {
        let at = self.items[parent]
            .children
            .iter()
            .position(|n| *n == node)
            .expect("not a child");
        self.items[parent].children.remove(at);
        self.items[node].parent = None;
    }
    fn parent(&self, node: Node) -> Option<Node> {
        self.items[node].parent
    }
    fn next_sibling(&self, node: Node) -> Option<Node> {
        let p = self.parent(node)?;
        let ns = &self.items[p].children;
        ns.get(ns.iter().position(|n| *n == node)? + 1).copied()
    }
    fn event(&mut self, node: Node, name: &str, handler: &str) {
        self.items[node].events.insert(name.into(), handler.into());
    }
    fn first_child(&self, node: Node) -> Option<Node> {
        self.items[node].children.first().copied()
    }
    fn is_text(&self, node: Node) -> bool {
        self.items[node].tag.is_none()
    }
}

/// A node of `TreeRenderer`.
struct TNode {
    /// `None` for a text node.
    tag: Option<String>,
    /// A text node's value as the host received it (a string or a number).
    text: Value,
    children: Vec<Node>,
    parent: Option<Node>,
    /// Properties set on the node: `setProperty` of a non-event name, and
    /// the delegation's expandos (`_$$click`, `_$$clickData`).
    props: Vec<(String, Value)>,
    /// Native listeners by event name, in attachment order.
    listeners: Vec<(String, Listener)>,
    /// `prevProps` of the event props (what `assignProp` returned).
    assigned: Vec<(String, Assigned)>,
}

impl Default for TNode {
    fn default() -> Self {
        TNode {
            tag: None,
            text: Value::Undef,
            children: vec![],
            parent: None,
            props: vec![],
            listeners: vec![],
            assigned: vec![],
        }
    }
}

/// A recording host for the universal renderer: a node tree with the DOM's
/// `insertBefore`/`removeChild` semantics, an op log of every host call
/// (queries included) and, for event props, Solid 2's delegation
/// (`slice1::events`, a port of `@solidjs/web`). Node ids are creation
/// order; node 0 is the root container. fuzz/universal.mjs is the same
/// host in JS; their logs are compared exactly.
pub struct TreeRenderer {
    nodes: Vec<TNode>,
    log: RefCell<Vec<J>>,
    /// Function identities, numbered in first-logged order.
    fn_ids: RefCell<HashMap<(u8, u64), usize>>,
    delegation: Delegation,
}

impl Default for TreeRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl TreeRenderer {
    /// A host with its root container (node 0, not logged).
    pub fn new() -> Self {
        TreeRenderer {
            nodes: vec![TNode {
                tag: Some("#root".into()),
                ..TNode::default()
            }],
            log: RefCell::new(vec![]),
            fn_ids: RefCell::new(HashMap::new()),
            delegation: Delegation::default(),
        }
    }
    pub fn root(&self) -> Node {
        0
    }
    pub fn len(&self) -> usize {
        self.nodes.len()
    }
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
    /// Appends a host-side entry (the driver's own events) to the log.
    pub fn push_log(&self, entry: J) {
        self.log.borrow_mut().push(entry);
    }
    pub fn take_log(&mut self) -> Vec<J> {
        std::mem::take(&mut *self.log.borrow_mut())
    }
    fn fn_id(&self, key: (u8, u64)) -> usize {
        let mut ids = self.fn_ids.borrow_mut();
        let n = ids.len();
        *ids.entry(key).or_insert(n)
    }
    /// A logged JS value: a primitive as itself (`undefined` is null), a
    /// function as `{fn: n}` (first-logged order), an array element-wise,
    /// a node as `{node: id}`.
    pub fn enc(&self, v: &Value) -> J {
        match v {
            Value::Undef => J::Null,
            Value::Bool(b) => json!(b),
            Value::Int(i) => json!(i),
            Value::Str(s) => json!(&**s),
            Value::Node(n) => json!({ "node": n }),
            Value::Func(crate::slice1::Builtin::Host(id)) => json!({ "fn": self.fn_id((0, *id)) }),
            Value::Obj(o) if o.array => {
                J::Array(o.elements().iter().map(|x| self.enc(x)).collect())
            }
            other => panic!("logging {other:?} is outside the value domain"),
        }
    }
    fn enc_listener(&self, l: &Listener) -> J {
        json!({ "fn": self.fn_id(l.identity()) })
    }
    fn opt(n: Option<Node>) -> J {
        n.map(|n| json!(n)).unwrap_or(J::Null)
    }
    fn new_node(&mut self, node: TNode) -> Node {
        self.nodes.push(node);
        self.nodes.len() - 1
    }
    /// The tree under `node`: `[id, tag, [children…]]` for an element,
    /// `[id, value]` for a text node.
    pub fn tree(&self, node: Node) -> J {
        let n = &self.nodes[node];
        match &n.tag {
            Some(tag) => json!([
                node,
                tag,
                n.children.iter().map(|c| self.tree(*c)).collect::<Vec<_>>()
            ]),
            None => json!([node, self.enc(&n.text)]),
        }
    }
    /// The concatenated text under `node`.
    pub fn frame(&self, node: Node) -> String {
        let n = &self.nodes[node];
        match &n.tag {
            Some(_) => n.children.iter().map(|c| self.frame(*c)).collect(),
            None => n.text.to_js_string().unwrap_or_default(),
        }
    }
    pub fn children(&self, node: Node) -> &[Node] {
        &self.nodes[node].children
    }
    pub fn tag(&self, node: Node) -> Option<&str> {
        self.nodes[node].tag.as_deref()
    }
    /// A property the host holds (`setProperty` of a non-event name).
    pub fn prop(&self, node: Node, name: &str) -> Value {
        self.expando(node, name)
    }
    /// The node's parent, read without logging (scenario click targets;
    /// the host's own `getParentNode` logs).
    pub fn parent_of(&self, node: Node) -> Option<Node> {
        self.nodes[node].parent
    }
    /// Whether `node` has a handler for events of type `ty`: a delegated
    /// handler stored on it (`node["_$$" + ty]`) or a native listener of
    /// that type other than a container's delegation listener.
    pub fn handles(&self, node: Node, ty: &str) -> bool {
        self.expando(node, &format!("{}{ty}", events::EVENT_KEY))
            .truthy()
            || self.nodes[node]
                .listeners
                .iter()
                .any(|(n, l)| n == ty && !matches!(l, Listener::Delegated { .. }))
    }
    /// The nodes under `root` (itself included) that handle `ty`, in
    /// document order: what a scenario's click target resolves against.
    pub fn handlers_of(&self, root: Node, ty: &str) -> Vec<Node> {
        let mut out = vec![];
        if self.handles(root, ty) {
            out.push(root);
        }
        for c in &self.nodes[root].children {
            out.extend(self.handlers_of(*c, ty));
        }
        out
    }
    /// `registerDelegatedRoot(node)` (web/src/client.ts:500-503), as
    /// `@solidjs/web`'s `render` registers its container.
    pub fn register_delegated_root(&mut self, node: Node) {
        events::register_delegated_root(self, node)
    }

    /// The DOM dispatch of an event of type `ty` at `target`: the
    /// propagation path (target, then its ancestors) is fixed first; on each
    /// node its native listeners of that type run in order with
    /// `currentTarget` set to the node; after a node, `cancelBubble` stops
    /// the propagation. A delegated container's listener is Solid's
    /// `eventHandler` (`slice1::events::event_handler`). The event object
    /// has `type`, `target`, `currentTarget` and `cancelBubble`.
    pub fn dispatch(
        rt: &mut Runtime,
        host: &Rc<RefCell<TreeRenderer>>,
        target: Node,
        ty: &str,
    ) -> Result<(), Error> {
        let e = JsObj::new_object(vec![
            ("type".into(), Value::str(ty)),
            ("target".into(), Value::Node(target)),
            ("currentTarget".into(), Value::Undef),
            ("cancelBubble".into(), Value::Bool(false)),
        ]);
        let mut path = vec![target];
        while let Some(p) = host.borrow().nodes[*path.last().unwrap()].parent {
            path.push(p);
        }
        for n in path {
            let listeners: Vec<Listener> = host.borrow().nodes[n]
                .listeners
                .iter()
                .filter(|(name, _)| name == ty)
                .map(|(_, l)| l.clone())
                .collect();
            for l in listeners {
                e.set(&Key::name("currentTarget"), Value::Node(n));
                match &l {
                    Listener::Delegated { container, .. } => {
                        events::event_handler(rt, host, &e, *container)?;
                    }
                    Listener::Handler(f) => {
                        rt.call(f, &[Value::Obj(e.clone())])?;
                    }
                    Listener::Tuple { tuple, .. } => {
                        let Value::Obj(t) = tuple else { unreachable!() };
                        let (f, data) = (t.get(&Key::Idx(0)), t.get(&Key::Idx(1)));
                        rt.call(&f, &[data, Value::Obj(e.clone())])?;
                    }
                }
            }
            if e.get(&Key::name("cancelBubble")).truthy() {
                break;
            }
        }
        Ok(())
    }
}

impl Renderer for TreeRenderer {
    fn create_element(&mut self, tag: &str) -> Node {
        let id = self.new_node(TNode {
            tag: Some(tag.into()),
            ..TNode::default()
        });
        self.push_log(json!(["createElement", tag, id]));
        id
    }
    fn create_text(&mut self, text: &str) -> Node {
        self.create_text_value(&Value::str(text))
    }
    fn create_text_value(&mut self, value: &Value) -> Node {
        assert!(
            matches!(value, Value::Str(_) | Value::Int(_)),
            "createTextNode({value:?}) is outside the value domain"
        );
        let id = self.new_node(TNode {
            text: value.clone(),
            ..TNode::default()
        });
        self.push_log(json!(["createTextNode", self.enc(value), id]));
        id
    }
    fn replace_text(&mut self, node: Node, text: &str) {
        self.replace_text_value(node, &Value::str(text))
    }
    fn replace_text_value(&mut self, node: Node, value: &Value) {
        self.push_log(json!(["replaceText", node, self.enc(value)]));
        assert!(self.nodes[node].tag.is_none(), "replaceText of an element");
        self.nodes[node].text = value.clone();
    }
    fn set_prop(&mut self, node: Node, name: &str, value: &str) {
        self.set_property(node, name, &Value::str(value), &Value::Undef)
    }
    /// `setProperty`: an event prop (`on` + an uppercase letter) goes
    /// through Solid's `assignProp` event arm (`events::assign_event_prop`,
    /// with the host's `prevProps` of that prop); any other is stored.
    fn set_property(&mut self, node: Node, name: &str, value: &Value, prev: &Value) {
        self.push_log(json!([
            "setProperty",
            node,
            name,
            self.enc(value),
            self.enc(prev)
        ]));
        if events::is_event_prop(name) {
            let held = self.nodes[node]
                .assigned
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, a)| a.clone())
                .unwrap_or_default();
            let next = events::assign_event_prop(self, node, name, value, &held);
            let a = &mut self.nodes[node].assigned;
            match a.iter_mut().find(|(n, _)| n == name) {
                Some(slot) => slot.1 = next,
                None => a.push((name.into(), next)),
            }
        } else {
            self.set_expando(node, name, value.clone());
        }
    }
    /// `insertNode(parent, node, anchor)`: DOM `insertBefore`.
    fn insert(&mut self, parent: Node, node: Node, anchor: Option<Node>) {
        self.push_log(json!(["insertNode", parent, node, Self::opt(anchor)]));
        if let Some(a) = anchor {
            assert_eq!(
                self.nodes[a].parent,
                Some(parent),
                "insertBefore: the anchor is not a child (NotFoundError)"
            );
        }
        // "If referenceChild is node, set it to node's next sibling."
        let mut reference = anchor;
        if reference == Some(node) {
            let ns = &self.nodes[parent].children;
            reference = ns
                .get(ns.iter().position(|n| *n == node).unwrap() + 1)
                .copied();
        }
        if let Some(old) = self.nodes[node].parent {
            let ns = &mut self.nodes[old].children;
            let at = ns.iter().position(|n| *n == node).unwrap();
            ns.remove(at);
        }
        let ns = &mut self.nodes[parent].children;
        let at = match reference {
            Some(r) => ns.iter().position(|n| *n == r).unwrap(),
            None => ns.len(),
        };
        ns.insert(at, node);
        self.nodes[node].parent = Some(parent);
    }
    /// `removeNode(parent, node)`: DOM `removeChild`.
    fn remove(&mut self, parent: Node, node: Node) {
        self.push_log(json!(["removeNode", parent, node]));
        assert_eq!(
            self.nodes[node].parent,
            Some(parent),
            "removeChild: not a child (NotFoundError)"
        );
        let ns = &mut self.nodes[parent].children;
        let at = ns.iter().position(|n| *n == node).unwrap();
        ns.remove(at);
        self.nodes[node].parent = None;
    }
    fn parent(&self, node: Node) -> Option<Node> {
        let r = self.nodes[node].parent;
        self.push_log(json!(["getParentNode", node, Self::opt(r)]));
        r
    }
    fn next_sibling(&self, node: Node) -> Option<Node> {
        let r = self.nodes[node].parent.and_then(|p| {
            let ns = &self.nodes[p].children;
            ns.get(ns.iter().position(|n| *n == node)? + 1).copied()
        });
        self.push_log(json!(["getNextSibling", node, Self::opt(r)]));
        r
    }
    fn first_child(&self, node: Node) -> Option<Node> {
        let r = self.nodes[node].children.first().copied();
        self.push_log(json!(["getFirstChild", node, Self::opt(r)]));
        r
    }
    fn is_text(&self, node: Node) -> bool {
        let r = self.nodes[node].tag.is_none();
        self.push_log(json!(["isTextNode", node, r]));
        r
    }
    fn event(&mut self, _node: Node, _name: &str, _handler: &str) {
        panic!("TreeRenderer attaches handlers through setProperty")
    }
}

impl EventHost for TreeRenderer {
    fn delegation(&mut self) -> &mut Delegation {
        &mut self.delegation
    }
    fn delegation_ref(&self) -> &Delegation {
        &self.delegation
    }
    fn expando(&self, node: Node, key: &str) -> Value {
        self.nodes[node]
            .props
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or(Value::Undef)
    }
    fn set_expando(&mut self, node: Node, key: &str, value: Value) {
        let props = &mut self.nodes[node].props;
        match props.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => props.push((key.into(), value)),
        }
    }
    fn parent_node(&self, node: Node) -> Option<Node> {
        self.nodes[node].parent
    }
    /// DOM `addEventListener`: a listener already attached for the name is
    /// not added again.
    fn add_event_listener(&mut self, node: Node, name: &str, listener: Listener) {
        self.push_log(json!([
            "addEventListener",
            node,
            name,
            self.enc_listener(&listener)
        ]));
        let ls = &mut self.nodes[node].listeners;
        if !ls.iter().any(|(n, l)| n == name && *l == listener) {
            ls.push((name.into(), listener));
        }
    }
    fn remove_event_listener(&mut self, node: Node, name: &str, listener: &Listener) {
        self.push_log(json!([
            "removeEventListener",
            node,
            name,
            self.enc_listener(listener)
        ]));
        let ls = &mut self.nodes[node].listeners;
        if let Some(at) = ls.iter().position(|(n, l)| n == name && l == listener) {
            ls.remove(at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_are_exact_text_not_html() {
        let mut r = TextRenderer::default();
        let root = r.create_element("#root");
        let b = r.create_element("button");
        let text = r.create_text(" <&>\n");
        r.set_prop(b, "title", "not rendered");
        r.event(b, "onClick", "h");
        r.insert(root, b, None);
        r.insert(b, text, None);
        assert_eq!(r.frame(root), " <&>\n");
        assert_eq!(r.clickable(root), vec![b]);
    }
    #[test]
    fn moves_and_anchors() {
        let mut r = TextRenderer::default();
        let root = r.create_element("#root");
        let a = r.create_text("a");
        let b = r.create_text("b");
        r.insert(root, a, None);
        r.insert(root, b, Some(a));
        assert_eq!(r.frame(root), "ba");
        assert_eq!(r.next_sibling(b), Some(a));
        r.insert(root, b, None);
        assert_eq!(r.frame(root), "ab");
        r.remove(root, a);
        assert_eq!(r.parent(a), None);
        assert_eq!(r.frame(root), "b");
    }
}

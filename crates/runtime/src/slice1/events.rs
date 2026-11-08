//! Event handlers with arguments, as Solid 2 attaches them.
//!
//! `@solidjs/universal` has no event code: a JSX `onClick={…}` reaches the
//! host's `setProperty(node, "onClick", value, prev)` (or the static props
//! of `createElement`), and the host decides. Solid 2's own host,
//! `@solidjs/web`, delegates. This module ports that delegation from
//! solid-next 2105ffb8 `packages/web/src/client.ts` (production build), so
//! a universal host can attach handlers the way Solid's DOM renderer does:
//!
//! - `assignProp`'s event arm (client.ts:2900-2935): `on` + an uppercase
//!   letter is an event named by the rest, lowercased. A name in
//!   `DelegatedEvents` (constants.ts:50-73) is delegated, any other gets a
//!   native listener, and the previous listener is removed.
//! - `addEvent` (client.ts:985-1017): a handler is a function or a tuple
//!   `[handler, data]`. Delegated, it is stored on the node as
//!   `node["_$$" + name]` (and `node["_$$" + name + "Data"]`); native, a
//!   tuple becomes the listener `e => handler.call(node, data, e)`.
//! - `delegateEvents`, `registerDelegatedRoot`/`Container` and
//!   `attachDelegatedEvent` (client.ts:486-555): one listener per
//!   delegated name on each registered container.
//! - `eventHandler` (client.ts:2961-3053): from the event's target up the
//!   parents to the container, each node's stored handler is called as
//!   `handler.call(node, data, e)` when data is defined, else
//!   `handler.call(node, e)`; a `disabled` node is skipped; a handler that
//!   sets `cancelBubble` stops the walk; `e.currentTarget` reads the node
//!   being handled.
//!
//! Not ported: hydration replay (`hydrationRt`), portals and shadow roots
//! (`_$host`, `host`, `composedPath`, retargeting): the host here has
//! none, so `parentOf` is `parentNode` and the walk is `walkUpTree`;
//! `handleEvent` objects (a handler is a function value); the observe
//! tier's interaction provenance.
//!
//! The DOM dispatch around the container's listener (the propagation path,
//! native listeners, `stopPropagation`) is the host's: see
//! `renderer::TreeRenderer::dispatch`.
use super::*;
use crate::renderer::Node;

/// Solid: web/src/constants.ts:50-73 `DelegatedEvents`.
pub const DELEGATED_EVENTS: [&str; 22] = [
    "beforeinput",
    "click",
    "dblclick",
    "contextmenu",
    "focusin",
    "focusout",
    "input",
    "keydown",
    "keyup",
    "mousedown",
    "mousemove",
    "mouseout",
    "mouseover",
    "mouseup",
    "pointerdown",
    "pointermove",
    "pointerout",
    "pointerover",
    "pointerup",
    "touchend",
    "touchmove",
    "touchstart",
];

/// Solid: client.ts:240 `EVENT_KEY`.
pub const EVENT_KEY: &str = "_$$";
/// Solid: client.ts:241 `$$EVENT_OWNER`.
pub const EVENT_OWNER: &str = "_$SOLID_EVENT_OWNER";

thread_local! {
    static NEXT_LISTENER: std::cell::Cell<u64> = const { std::cell::Cell::new(1) };
}
fn next_listener() -> u64 {
    NEXT_LISTENER.with(|c| {
        let id = c.get();
        c.set(id + 1);
        id
    })
}

/// A native listener (`node.addEventListener(name, listener)`), compared
/// by identity as `removeEventListener` compares.
#[derive(Clone, Debug, PartialEq)]
pub enum Listener {
    /// `attachDelegatedEvent`'s `e => eventHandler(e, container, state)`.
    Delegated { id: u64, container: Node },
    /// A handler function attached as itself (addEvent, client.ts:1016).
    Handler(Value),
    /// addEvent's tuple wrapper `e => handlerFn.call(node, handler[1], e)`
    /// (client.ts:997-1004); `[$$EVENT_TUPLE]` is the tuple.
    Tuple { id: u64, node: Node, tuple: Value },
}

impl Listener {
    /// A stable identity for logs: the function a JS listener is.
    pub fn identity(&self) -> (u8, u64) {
        match self {
            Listener::Delegated { id, .. } => (1, *id),
            Listener::Handler(Value::Func(Builtin::Host(f))) => (0, *f),
            Listener::Handler(other) => panic!("a listener {other:?} is outside the value domain"),
            Listener::Tuple { id, .. } => (1, *id),
        }
    }
}

/// A container's state (client.ts:518-527: `{ owners, handlers }`, and
/// `roots`).
#[derive(Default)]
pub struct ContainerState {
    owners: Vec<(Node, usize)>,
    handlers: Vec<(String, Listener)>,
    roots: usize,
}

/// The module state of client.ts's delegation: `delegatedEvents` (a Set of
/// names) and `delegatedContainers` (a Map container → state), in
/// insertion order.
#[derive(Default)]
pub struct Delegation {
    delegated_events: Vec<String>,
    containers: Vec<(Node, ContainerState)>,
}

impl Delegation {
    fn state(&mut self, c: Node) -> Option<&mut ContainerState> {
        self.containers
            .iter_mut()
            .find(|(n, _)| *n == c)
            .map(|(_, s)| s)
    }
}

/// What `assignProp` returned for a prop last time (the host keeps it as
/// `prevProps[prop]`, client.ts:941): the value, or the native listener it
/// attached.
#[derive(Clone, Debug, PartialEq)]
pub enum Assigned {
    Value(Value),
    Listener(Listener),
}

impl Default for Assigned {
    fn default() -> Self {
        Assigned::Value(Value::Undef)
    }
}

impl Assigned {
    fn truthy(&self) -> bool {
        match self {
            Assigned::Value(v) => v.truthy(),
            Assigned::Listener(_) => true,
        }
    }
    /// `value === prev`.
    fn is(&self, v: &Value) -> bool {
        match self {
            Assigned::Value(p) => p == v,
            Assigned::Listener(Listener::Handler(f)) => f == v,
            Assigned::Listener(_) => false,
        }
    }
}

/// The node operations the delegation reads and writes: expando
/// properties (`node[key]`), `parentNode`, native listeners.
pub trait EventHost {
    fn delegation(&mut self) -> &mut Delegation;
    fn delegation_ref(&self) -> &Delegation;
    /// `node[key]` (`undefined` when unset).
    fn expando(&self, node: Node, key: &str) -> Value;
    fn set_expando(&mut self, node: Node, key: &str, value: Value);
    fn parent_node(&self, node: Node) -> Option<Node>;
    fn add_event_listener(&mut self, node: Node, name: &str, listener: Listener);
    fn remove_event_listener(&mut self, node: Node, name: &str, listener: &Listener);
}

/// `on` + an uppercase ASCII letter, no namespace (client.ts:2914-2917).
pub fn is_event_prop(prop: &str) -> bool {
    !prop.contains(':')
        && prop.starts_with("on")
        && prop.as_bytes().get(2).is_some_and(|c| (65..91).contains(c))
}

/// `delegateEvents(eventNames)`.
// Solid: web/src/client.ts:488-496
pub fn delegate_events(host: &mut impl EventHost, event_names: &[&str]) {
    for name in event_names {
        if !host
            .delegation_ref()
            .delegated_events
            .iter()
            .any(|n| n == name)
        {
            host.delegation().delegated_events.push(name.to_string());
            let containers: Vec<Node> = host
                .delegation_ref()
                .containers
                .iter()
                .map(|(c, _)| *c)
                .collect();
            for container in containers {
                attach_delegated_event(host, name, container);
            }
        }
    }
}

/// `registerDelegatedRoot(root)`.
// Solid: web/src/client.ts:500-503
pub fn register_delegated_root(host: &mut impl EventHost, root: Node) {
    if register_delegated_container(host, root, root) {
        if let Some(state) = host.delegation().state(root) {
            state.roots += 1;
        }
    }
}

/// `registerDelegatedContainer(container, owner = container)`; whether a
/// state was returned.
// Solid: web/src/client.ts:516-530
pub fn register_delegated_container(
    host: &mut impl EventHost,
    container: Node,
    owner: Node,
) -> bool {
    if host.delegation().state(container).is_none() {
        host.delegation()
            .containers
            .push((container, ContainerState::default()));
    }
    let state = host.delegation().state(container).unwrap();
    match state.owners.iter_mut().find(|(o, _)| *o == owner) {
        Some(slot) => slot.1 += 1,
        None => state.owners.push((owner, 1)),
    }
    let names = host.delegation_ref().delegated_events.clone();
    for name in names {
        attach_delegated_event(host, &name, container);
    }
    true
}

/// `attachDelegatedEvent(name, container, state)`.
// Solid: web/src/client.ts:547-555 (production: no interaction wrapper)
fn attach_delegated_event(host: &mut impl EventHost, name: &str, container: Node) {
    let state = host
        .delegation()
        .state(container)
        .expect("a registered container");
    if state.handlers.iter().any(|(n, _)| n == name) {
        return;
    }
    let handler = Listener::Delegated {
        id: next_listener(),
        container,
    };
    state.handlers.push((name.to_string(), handler.clone()));
    host.add_event_listener(container, name, handler);
}

/// `addEvent(node, name, handler, delegate)`: the native listener it
/// attached (`None` when delegated, or for a non-function handler value
/// that is not attached here).
// Solid: web/src/client.ts:985-1017 (production)
pub fn add_event(
    host: &mut impl EventHost,
    node: Node,
    name: &str,
    handler: &Value,
    delegate: bool,
) -> Option<Listener> {
    let tuple = match handler {
        Value::Obj(o) if o.array => Some(o.clone()),
        _ => None,
    };
    if delegate {
        let key = format!("{EVENT_KEY}{name}");
        let mut data = Value::Undef;
        match &tuple {
            Some(t) => {
                data = t.get(&Key::Idx(1));
                host.set_expando(node, &key, t.get(&Key::Idx(0)));
            }
            None => host.set_expando(node, &key, handler.clone()),
        }
        host.set_expando(node, &format!("{key}Data"), data);
        return None;
    }
    if tuple.is_some() {
        let listener = Listener::Tuple {
            id: next_listener(),
            node,
            tuple: handler.clone(),
        };
        host.add_event_listener(node, name, listener.clone());
        return Some(listener);
    }
    // `node.addEventListener(name, handler, typeof handler !== "function" && handler)`
    assert!(
        matches!(handler, Value::Func(_)),
        "a handleEvent object ({handler:?}) is outside the value domain"
    );
    let listener = Listener::Handler(handler.clone());
    host.add_event_listener(node, name, listener.clone());
    Some(listener)
}

/// `assignProp(node, prop, value, prev)` for an event prop (`is_event_prop`):
/// the new `prevProps[prop]`.
// Solid: web/src/client.ts:2900-2935, 2958 (the event arm; `value === prev`
// returns early first, client.ts:2905; `nodeName` has no stateful props)
pub fn assign_event_prop(
    host: &mut impl EventHost,
    node: Node,
    prop: &str,
    value: &Value,
    prev: &Assigned,
) -> Assigned {
    if prev.is(value) {
        return prev.clone();
    }
    let name = prop[2..].to_lowercase();
    let delegate = DELEGATED_EVENTS.contains(&name.as_str());
    if !delegate && prev.truthy() {
        // `prev[$$EVENT_TUPLE] === value`: the same tuple keeps its wrapper.
        if let Assigned::Listener(Listener::Tuple { tuple, .. }) = prev {
            if matches!(value, Value::Obj(o) if o.array) && tuple == value {
                return prev.clone();
            }
        }
        match prev {
            Assigned::Listener(l) => host.remove_event_listener(node, &name, l),
            Assigned::Value(v) => {
                host.remove_event_listener(node, &name, &Listener::Handler(v.clone()))
            }
        }
    }
    if delegate || value.truthy() {
        let attached = add_event(host, node, &name, value, delegate);
        if delegate {
            delegate_events(host, &[&name]);
        }
        if !delegate {
            return Assigned::Listener(attached.expect("a native listener"));
        }
    }
    Assigned::Value(value.clone())
}

/// `parentOf(node)`: `_$host || parentNode || host`; no node here has a
/// portal host.
// Solid: web/src/client.ts:642
fn parent_of(host: &impl EventHost, node: Node) -> Option<Node> {
    host.parent_node(node)
}

/// `findOwner(target, state)?.owner`.
// Solid: web/src/client.ts:644-652
fn find_owner(
    host: &impl EventHost,
    target: Option<Node>,
    owners: &[(Node, usize)],
) -> Option<Node> {
    let mut node = target;
    while let Some(n) = node {
        if owners.iter().any(|(o, _)| *o == n) {
            return Some(n);
        }
        node = parent_of(host, n);
    }
    None
}

/// `container.contains(node)`.
fn contains(host: &impl EventHost, container: Node, node: Node) -> bool {
    let mut n = Some(node);
    while let Some(x) = n {
        if x == container {
            return true;
        }
        n = host.parent_node(x);
    }
    false
}

/// An event object's properties as the walk reads them.
fn ev_get(e: &Obj, k: &str) -> Value {
    e.get(&Key::name(k))
}
fn ev_set(e: &Obj, k: &str, v: Value) {
    e.set(&Key::name(k), v);
}
fn node_value(n: Option<Node>) -> Value {
    n.map(Value::Node).unwrap_or(Value::Undef)
}

/// `eventHandler(e, container, state)`: the delegated listener's body.
/// `e` is the host's event object: `type`, `target`, `cancelBubble`; the
/// walk sets `currentTarget` to `node || owner` before each handler call
/// (Solid defines it as a getter of that expression).
// Solid: web/src/client.ts:2961-3053 (production; no hydration runtime, no
// `composedPath`: the walk is `walkUpTree`)
pub fn event_handler<H: EventHost + 'static>(
    rt: &mut Runtime,
    host: &Rc<std::cell::RefCell<H>>,
    e: &Obj,
    container: Node,
) -> Result<(), Error> {
    let prev = ev_get(e, EVENT_OWNER);
    let mut resume_node: Option<Node> = None;
    if prev.truthy() {
        let h = host.borrow();
        let prev_node = match prev {
            Value::Node(n) => Some(n),
            _ => None,
        };
        if prev == Value::Bool(true)
            || prev_node == Some(container)
            || !prev_node.is_some_and(|p| contains(&*h, container, p))
        {
            return Ok(());
        }
        resume_node = prev_node;
    }
    let target = match ev_get(e, "target") {
        Value::Node(n) => Some(n),
        _ => None,
    };
    let owner = {
        let h = host.borrow();
        let state = h
            .delegation_ref()
            .containers
            .iter()
            .find(|(c, _)| *c == container)
            .map(|(_, s)| s)
            .expect("a registered container");
        if state.owners.len() == 1 && state.owners[0].0 == container {
            Some(container)
        } else {
            find_owner(&*h, target, &state.owners)
        }
    };
    let Some(owner) = owner else {
        return Ok(());
    };
    if Some(owner) == resume_node {
        return Ok(());
    }
    ev_set(e, EVENT_OWNER, Value::Node(owner));

    let mut node: Option<Node> = resume_node.or(target);
    let ty = ev_get(e, "type");
    let key = format!(
        "{EVENT_KEY}{}",
        ty.as_str().expect("an event type is a string")
    );
    let event = Value::Obj(e.clone());
    // `handleNode()`: false when a handler cancelled the bubble.
    let handle_node = |rt: &mut Runtime, node: Node| -> Result<bool, Error> {
        let (handler, disabled, data) = {
            let h = host.borrow();
            (
                h.expando(node, &key),
                h.expando(node, "disabled"),
                h.expando(node, &format!("{key}Data")),
            )
        };
        if handler.truthy() && !disabled.truthy() {
            // `currentTarget`: `node || owner`.
            ev_set(e, "currentTarget", Value::Node(node));
            if !data.is_undef() {
                rt.call(&handler, &[data, event.clone()])?;
            } else {
                assert!(
                    matches!(handler, Value::Func(_)),
                    "a handleEvent object ({handler:?}) is outside the value domain"
                );
                rt.call(&handler, std::slice::from_ref(&event))?;
            }
            if ev_get(e, "cancelBubble").truthy() {
                return Ok(false);
            }
        }
        // `node.host && …`: no node has a host.
        Ok(true)
    };
    // `atOwner()`
    let at_owner = |node: Node| node == owner || host.borrow().parent_node(node) == Some(owner);
    // `walkUpTree()`
    let walk_up_tree = |rt: &mut Runtime, mut node: Option<Node>| -> Result<(), Error> {
        while let Some(n) = node {
            if !handle_node(rt, n)? || at_owner(n) {
                break;
            }
            node = parent_of(&*host.borrow(), n);
        }
        Ok(())
    };

    if let Some(resume) = resume_node {
        if Some(resume) == target {
            node = parent_of(&*host.borrow(), resume);
        }
        if node.is_some() && node != Some(owner) {
            walk_up_tree(rt, node)?;
        }
    } else {
        walk_up_tree(rt, node)?;
    }
    // `delete e.target; delete e.currentTarget`: the host's own values
    // (the DOM's getters) show again; the host's dispatch resets them.
    ev_set(e, "currentTarget", node_value(None));
    Ok(())
}

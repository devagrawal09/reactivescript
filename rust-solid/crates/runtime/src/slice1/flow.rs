//! Solid: solid/src/client/flow.ts — `<For>` and `<Show>` — and
//! solid/src/client/component.ts — `createComponent` — in the production
//! build (`IS_DEV`/`IS_OBSERVE` false: no names, no dev wrappers), not
//! hydrating (`sharedConfig.hydrating` false).
//!
//! A props object is a struct of getters: compiled JSX passes `get when()`,
//! `get children()`, `get fallback()`, `get each()`; a getter runs where
//! the component reads the prop, so a read inside a memo is tracked by it.
//! `keyed` is read once, at the call, as both components do; the port takes
//! it as a value. An absent prop is `None` (`"fallback" in props` is false;
//! a read gives `undefined`).
//!
//! Not ported: `Repeat`, `Switch`/`Match`, `Loading`, `Errored`, `Reveal`
//! (no renderer program here creates one).
use super::*;

/// A prop getter (`get name() { … }`).
pub type Getter = Rc<dyn Fn(&mut Runtime) -> Result<Value, Error>>;

/// `<Show>`'s props.
#[derive(Clone)]
pub struct ShowProps {
    pub when: Getter,
    /// `props.keyed` (`undefined` when absent).
    pub keyed: Value,
    /// `props.children`: an element, or a function child (`length > 0`).
    pub children: Getter,
    pub fallback: Option<Getter>,
}

/// `<For>`'s props.
#[derive(Clone)]
pub struct ForProps {
    pub each: Getter,
    /// `props.keyed`: `undefined`/`true` (identity), `false` (index rows)
    /// or a key function.
    pub keyed: Value,
    /// `props.children`: the mapper (a function value; its `length` is the
    /// arity `mapArray` reads).
    pub children: Getter,
    pub fallback: Option<Getter>,
}

/// A component body (`Comp(props)`); the props are closed over.
pub type Component = Rc<dyn Fn(&mut Runtime) -> Result<Value, Error>>;

impl Runtime {
    /// `createComponent(Comp, props)` in production: `untrack(() =>
    /// Comp(props || {}))`.
    // Solid: solid/src/client/component.ts:92-104
    pub fn create_component(&mut self, comp: Component) -> Result<Value, Error> {
        self.untrack(|rt| comp(rt))
    }

    /// `<For each fallback keyed>{children}</For>`: a zero-length accessor
    /// that creates its `mapArray` on the first read, under the owner of
    /// the call.
    // Solid: solid/src/client/flow.ts:83-111
    pub fn for_component(&mut self, props: ForProps) -> Value {
        let keyed = props.keyed.clone();
        let fallback = props.fallback.clone();
        let owner = self.get_owner();
        let mapped: Rc<std::cell::Cell<Option<NodeId>>> = Rc::new(std::cell::Cell::new(None));
        let create = {
            let props = props.clone();
            move |rt: &mut Runtime| -> Result<NodeId, Error> {
                rt.with_owner(owner, |rt| {
                    let each = props.each.clone();
                    let list: ListFn = Rc::new(move |rt: &mut Runtime| each(rt));
                    // `props.children`, read when the map is created.
                    let children = (props.children)(rt)?;
                    let arity = rt
                        .function_length(&children)
                        .unwrap_or_else(|| panic!("<For> children {children:?} is not a function"));
                    let map: MapFn =
                        Rc::new(move |rt: &mut Runtime, item: MapArg, index: MapArg| {
                            let item = rt.map_arg(item);
                            let index = rt.map_arg(index);
                            rt.call(&children, &[item, index])
                        });
                    // `options.keyed`: a function is the key, `false` index
                    // rows, anything else identity (map.ts:74-99).
                    let keyed = match &keyed {
                        Value::Bool(false) => Keyed::Index,
                        f @ Value::Func(_) => {
                            let f = f.clone();
                            Keyed::Fn(Rc::new(move |rt: &mut Runtime, item: Value| {
                                rt.call(&f, &[item])
                            }))
                        }
                        _ => Keyed::Identity,
                    };
                    // `"fallback" in props ? { fallback: () => props.fallback } : {}`
                    let fallback: Option<FallbackFn> = fallback
                        .clone()
                        .map(|g| Rc::new(move |rt: &mut Runtime| g(rt)) as FallbackFn);
                    Ok(rt.map_array(list, map, arity, keyed, fallback))
                })
            }
        };
        // `const list = () => (mapped ?? (mapped = create()))();`
        self.function(
            0,
            Rc::new(move |rt: &mut Runtime, _| {
                let m = match mapped.get() {
                    Some(m) => m,
                    None => {
                        let m = create(rt)?;
                        mapped.set(Some(m));
                        m
                    }
                };
                rt.read_node(m)
            }),
        )
    }

    /// A mapper argument as the JS mapper receives it: a raw value, or
    /// `accessor(node)`.
    fn map_arg(&mut self, a: MapArg) -> Value {
        match a {
            MapArg::Value(v) => v,
            MapArg::Accessor(n) => self.accessor(n),
        }
    }

    /// `<Show when keyed fallback>{children}</Show>`: the accessor of the
    /// outer memo.
    // Solid: solid/src/client/flow.ts:192-263
    pub fn show_component(&mut self, props: ShowProps) -> Value {
        let keyed = props.keyed.truthy();
        // `createMemo(() => props.when)`: no options in production.
        let when = props.when.clone();
        let condition_value = self.computed(
            Rc::new(move |rt: &mut Runtime, _| when(rt).map(Out::Value)),
            None,
        );
        let condition = if keyed {
            condition_value
        } else {
            // `createMemo(conditionValue, { equals: (a, b) => !a === !b, sync: true })`
            self.memo_with(
                Rc::new(move |rt: &mut Runtime, _| rt.read_node(condition_value).map(Out::Value)),
                Some(Rc::new(|a: &Value, b: &Value| a.truthy() == b.truthy())),
                true,
            )
        };
        // `shown`: the latest run's token (#4648).
        let shown: Rc<std::cell::Cell<u64>> = Rc::new(std::cell::Cell::new(0));
        let outer = self.memo_with(
            Rc::new(move |rt: &mut Runtime, _| {
                let c = rt.read_node(condition)?;
                shown.set(shown.get() + 1);
                let run = shown.get();
                if c.truthy() {
                    let child = (props.children)(rt)?;
                    let is_fn = matches!(child, Value::Func(_))
                        && rt.function_length(&child).is_some_and(|l| l > 0);
                    return Ok(Out::Value(if is_fn {
                        if keyed {
                            rt.untrack(|rt| rt.call(&child, &[c]))?
                        } else {
                            let shown = shown.clone();
                            let narrowed = rt.function(
                                0,
                                Rc::new(move |rt: &mut Runtime, _| {
                                    // `(verdict && shown === run) || condition() || narrowedError("Show")`
                                    let guard = (rt.verdict_open() && shown.get() == run)
                                        || rt.read_node(condition)?.truthy();
                                    if !guard {
                                        return Err(thrown_string(
                                            "Stale read from <Show>.".into(),
                                        ));
                                    }
                                    rt.read_node(condition_value)
                                }),
                            );
                            rt.untrack(|rt| rt.call(&child, &[narrowed]))?
                        }
                    } else {
                        child
                    }));
                }
                Ok(Out::Value(match &props.fallback {
                    Some(f) => f(rt)?,
                    None => Value::Undef,
                }))
            }),
            None,
            true,
        );
        self.accessor(outer)
    }
}

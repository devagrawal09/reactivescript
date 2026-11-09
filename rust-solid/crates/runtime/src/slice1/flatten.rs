//! Solid: flatten.ts — `flatten`, the children resolver the renderers
//! (`@solidjs/universal`'s `normalize`, `@solidjs/web`, solid's
//! `children()`) walk through: nested zero-length functions are called,
//! arrays are flattened, and with `skipNonRendered` the values that render
//! nothing (`null`/`undefined`, booleans, `""`) are dropped.
//!
//! Arrays are read as JS reads them (`children.length` on every loop test,
//! `children[i]`), through `js_get`, so a store array is read through its
//! traps. Functions are the host-made ones (function.rs); `length` decides
//! which are unwrapped.
use super::*;

/// `options` of `flatten` (flatten.ts:14).
#[derive(Clone, Copy, Default, Debug)]
pub struct FlattenOptions {
    pub skip_non_rendered: bool,
    pub do_not_unwrap: bool,
}

impl Runtime {
    /// `typeof v === "function" && !v.length`.
    fn is_thunk(&self, v: &Value) -> bool {
        match v {
            Value::Func(_) => {
                self.function_length(v)
                    .unwrap_or_else(|| panic!("the length of {v:?} is outside the value domain"))
                    == 0
            }
            _ => false,
        }
    }

    /// `v == null || v === true || v === false || v === ""`.
    fn non_rendered(v: &Value) -> bool {
        match v {
            Value::Undef | Value::Bool(_) => true,
            Value::Str(s) => s.is_empty(),
            _ => false,
        }
    }

    /// `flatten(children, options)`.
    // Solid: flatten.ts:12-40
    pub fn flatten(&mut self, children: Value, options: FlattenOptions) -> Result<Value, Error> {
        let mut children = children;
        if self.is_thunk(&children) {
            if options.do_not_unwrap {
                return Ok(children);
            }
            loop {
                children = self.call(&children, &[])?;
                if !self.is_thunk(&children) {
                    break;
                }
            }
        }
        if options.skip_non_rendered && Self::non_rendered(&children) {
            return Ok(Value::Undef);
        }

        if self.is_array(&children) {
            let results = JsObj::new_array(vec![]);
            if self.flatten_array(&children, &results, options)? {
                let options = FlattenOptions {
                    do_not_unwrap: false,
                    ..options
                };
                return Ok(self.function(
                    0,
                    Rc::new(move |rt: &mut Runtime, _| {
                        let nested = JsObj::new_array(vec![]);
                        rt.flatten_array(&Value::Obj(results.clone()), &nested, options)?;
                        Ok(Value::Obj(nested))
                    }),
                ));
            }
            return Ok(Value::Obj(results));
        }
        Ok(children)
    }

    /// `flattenArray(children, results, options)`: whether an accessor was
    /// kept unread (`doNotUnwrap`), so the caller must resolve later.
    // Solid: flatten.ts:42-80
    fn flatten_array(
        &mut self,
        children: &Value,
        results: &Obj,
        options: FlattenOptions,
    ) -> Result<bool, Error> {
        let mut not_ready: Option<Error> = None;
        let mut needs_unwrap = false;
        let mut i = 0u32;
        while (i as i64) < self.array_length(children)? {
            let step = (|| -> Result<(), Error> {
                let mut child = self.js_get(children, &Key::Idx(i))?;
                if self.is_thunk(&child) {
                    if options.do_not_unwrap {
                        push(results, child);
                        needs_unwrap = true;
                        return Ok(());
                    }
                    loop {
                        child = self.call(&child, &[])?;
                        if !self.is_thunk(&child) {
                            break;
                        }
                    }
                }
                if self.is_array(&child) {
                    // OR, don't overwrite (#3133).
                    needs_unwrap = self.flatten_array(&child, results, options)? || needs_unwrap;
                } else if options.skip_non_rendered && Self::non_rendered(&child) {
                    // skip
                } else {
                    push(results, child);
                }
                Ok(())
            })();
            if let Err(e) = step {
                if !e.is_not_ready() {
                    return Err(e);
                }
                not_ready = Some(e);
            }
            i += 1;
        }
        if let Some(e) = not_ready {
            return Err(e);
        }
        Ok(needs_unwrap)
    }

    /// `children.length` of an array (or a store array's proxy).
    fn array_length(&mut self, a: &Value) -> Result<i64, Error> {
        match self.js_get(a, &Key::name("length"))? {
            Value::Int(n) => Ok(n),
            other => panic!("an array length {other:?} is outside the value domain"),
        }
    }
}

/// `results.push(x)`.
fn push(results: &Obj, x: Value) {
    let n = results.len();
    results.set(&Key::Idx(n), x);
}

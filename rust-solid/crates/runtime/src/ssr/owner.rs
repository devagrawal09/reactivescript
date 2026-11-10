//! The lean SSR owner runtime of Solid's server build
//! (solid/src/server/signals.ts:150-705): a forward-only owner tree whose
//! jobs are hydration-id allocation, `onCleanup`, disposal, and the context
//! records the boundaries read (`ErrorContext`, `NoHydrateContext`). It is
//! not the client owner of `slice1/owner.rs`: no queue, heap, zombies or
//! flags.
//!
//! Not ported, because a plan app never reaches them: the owner pool
//! (`ownerPool`, an allocation cache whose reuse resets every field, so it is
//! not observable), the observe/dev `_name`/`_loc` labels and transparent
//! component owners (`createComponentOwner`, observe tier only), contexts
//! other than the two above (`RevealGroupContext` is set to `null` and never
//! read here; a plan app sets no `NoHydrateContext`, whose default `false` is
//! read), the dev-only `devPeekNextChildId`, and the thrower stamps
//! (`stampThrower`, which only feed the server error hook).
use super::boundary::ErrorHandler;
use super::value::{throw, Res};
use super::Server;
use std::rc::Rc;

pub type OwnerId = usize;
pub type Cleanup = Rc<dyn Fn(&mut Server)>;

/// An owner's `_context` record (signals.ts:500-541): the contexts the
/// server reads. Copied on write (`setContext` replaces the record), and
/// shared with the children allocated after (`allocateOwner`).
#[derive(Clone, Default)]
pub struct OwnerCtx {
    /// `ErrorContext` (signals.ts:3800-3803): the nearest boundary's error
    /// handler; `null` by default.
    pub error: Option<ErrorHandler>,
    /// `NoHydrateContext` (shared.ts:187-190): `false` by default. No plan
    /// app sets it.
    pub no_hydrate: Option<bool>,
}

pub struct SsrOwner {
    /// The hydration id, or, while `scope_slot >= 0`, the prefix of a pending
    /// one (`ssrScope`).
    pub id: Option<String>,
    pub transparent: bool,
    pub disposal: Vec<Cleanup>,
    pub parent: Option<OwnerId>,
    pub child_count: u64,
    /// The live children, newest first (`_firstChild` → `_nextSibling`).
    pub children: Vec<OwnerId>,
    pub disposed: bool,
    pub scope_slot: i64,
    pub context: Rc<OwnerCtx>,
}

// Solid: signals.ts:235-239 (`formatChildId`)
pub fn format_child_id(prefix: &str, id: u64) -> String {
    let num = to_base36(id);
    let len = num.len() - 1;
    let mut out = String::from(prefix);
    if len > 0 {
        out.push(char::from_u32(64 + len as u32).expect("an id length below 2^32"));
    }
    out.push_str(&num);
    out
}

/// `Number.prototype.toString(36)` of a non-negative integer.
fn to_base36(mut n: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = vec![];
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("ascii digits")
}

impl Server {
    pub(crate) fn owner(&self, o: OwnerId) -> &SsrOwner {
        &self.owners[o]
    }

    pub(crate) fn owner_mut(&mut self, o: OwnerId) -> &mut SsrOwner {
        &mut self.owners[o]
    }

    // Solid: signals.ts:251-257 (`materializeId`)
    pub(crate) fn materialize_id(&mut self, o: OwnerId) -> Option<String> {
        let owner = &mut self.owners[o];
        if owner.scope_slot >= 0 {
            let prefix = owner.id.clone().expect("a scoped owner has a prefix");
            owner.id = Some(format_child_id(&prefix, owner.scope_slot as u64));
            owner.scope_slot = -1;
        }
        owner.id.clone()
    }

    // Solid: signals.ts:277-285 (`nextChildIdFor`)
    pub(crate) fn next_child_id_for(&mut self, o: OwnerId, consume: bool) -> Res<String> {
        let mut counter = o;
        while self.owners[counter].transparent {
            match self.owners[counter].parent {
                Some(p) => counter = p,
                None => break,
            }
        }
        if self.owners[counter].id.is_some() {
            let prefix = if self.owners[counter].scope_slot >= 0 {
                self.materialize_id(counter).expect("materialized")
            } else {
                self.owners[counter].id.clone().expect("checked")
            };
            let c = &mut self.owners[counter];
            let n = c.child_count;
            if consume {
                c.child_count += 1;
            }
            return Ok(format_child_id(&prefix, n));
        }
        throw("Cannot get child id from owner without an id")
    }

    // Solid: signals.ts:287-289 (`getNextChildId`)
    pub fn get_next_child_id(&mut self, o: OwnerId) -> Res<String> {
        self.next_child_id_for(o, true)
    }

    // Solid: signals.ts:330-334 (`createOwner`)
    pub fn create_owner(&mut self, id: Option<String>, transparent: bool) -> Res<OwnerId> {
        self.owner_creations += 1;
        self.allocate_owner(id, transparent)
    }

    // Solid: signals.ts:354-431 (`allocateOwner`, without the pool)
    fn allocate_owner(&mut self, explicit: Option<String>, transparent: bool) -> Res<OwnerId> {
        let parent = self.current;
        let id = match explicit {
            Some(id) => Some(id),
            None if transparent => match parent {
                Some(p) if self.owners[p].scope_slot >= 0 => self.materialize_id(p),
                Some(p) => self.owners[p].id.clone(),
                None => None,
            },
            None => match parent {
                Some(p) if self.owners[p].id.is_some() => Some(self.next_child_id_for(p, true)?),
                _ => None,
            },
        };
        let context = match parent {
            Some(p) => self.owners[p].context.clone(),
            None => Rc::new(OwnerCtx::default()),
        };
        let o = self.owners.len();
        self.owners.push(SsrOwner {
            id,
            transparent,
            disposal: vec![],
            parent,
            child_count: 0,
            children: vec![],
            disposed: false,
            scope_slot: -1,
            context,
        });
        if let Some(p) = parent {
            // Pushed at the head of the forward list.
            self.owners[p].children.insert(0, o);
        }
        Ok(o)
    }

    // Solid: signals.ts:433-451 (`runWithOwner`)
    pub fn run_with_owner<T>(
        &mut self,
        owner: Option<OwnerId>,
        f: impl FnOnce(&mut Server) -> Res<T>,
    ) -> Res<T> {
        let prev = self.current;
        self.current = owner;
        let result = f(self);
        self.current = prev;
        result
    }

    // Solid: signals.ts:507-522 (`getContext`), for `ErrorContext`: a
    // missing owner throws `NoOwnerError`, which no server path of a plan app
    // reaches (every read is under the render root).
    pub fn error_context(&self, owner: Option<OwnerId>) -> Res<Option<ErrorHandler>> {
        match owner {
            Some(o) => Ok(self.owners[o].context.error.clone()),
            None => throw("NoOwnerError: getContext(ErrorContext) outside an owner"),
        }
    }

    // Solid: signals.ts:524-541 (`setContext`, `ErrorContext`): a new record.
    pub fn set_error_context(&mut self, owner: OwnerId, handler: Option<ErrorHandler>) {
        let mut ctx = (*self.owners[owner].context).clone();
        ctx.error = handler;
        self.owners[owner].context = Rc::new(ctx);
    }

    // Solid: signals.ts:507-522 (`getContext(NoHydrateContext)`)
    pub fn no_hydrate(&self, owner: OwnerId) -> bool {
        self.owners[owner].context.no_hydrate.unwrap_or(false)
    }

    // Solid: signals.ts:478-480 (`getOwner`)
    pub fn get_owner(&self) -> Option<OwnerId> {
        self.current
    }

    // Solid: signals.ts:491-498 (`onCleanup`)
    pub fn on_cleanup(&mut self, f: Cleanup) {
        if let Some(o) = self.current {
            self.owners[o].disposal.push(f);
        }
    }

    // Solid: signals.ts:543-554 (`unlinkOwner`)
    fn unlink_owner(&mut self, node: OwnerId) {
        if let Some(p) = self.owners[node].parent.take() {
            self.owners[p].children.retain(|&c| c != node);
        }
    }

    // Solid: signals.ts:572-642 (`disposeOwner`, without the pool). Every
    // cleanup runs; the first error is rethrown after the walk.
    pub fn dispose_owner(&mut self, owner: OwnerId, self_: bool) -> Res<()> {
        if self.owners[owner].disposed {
            return Ok(());
        }
        if self.owners[owner].children.is_empty() && self.owners[owner].disposal.is_empty() {
            if self_ {
                self.owners[owner].disposed = true;
                self.unlink_owner(owner);
            } else {
                self.owners[owner].child_count = 0;
                self.owners[owner].scope_slot = -1;
            }
            return Ok(());
        }
        if self_ {
            self.owners[owner].disposed = true;
        }
        let mut error: Option<super::value::Thrown> = None;
        let children = std::mem::take(&mut self.owners[owner].children);
        for child in children {
            if let Err(e) = self.dispose_owner(child, true) {
                error.get_or_insert(e);
            }
        }
        let node = &mut self.owners[owner];
        node.children.clear();
        node.child_count = 0;
        node.scope_slot = -1;
        let d = std::mem::take(&mut node.disposal);
        // Unwind order: later registrations run first.
        for f in d.iter().rev() {
            f(self);
        }
        if self_ {
            self.unlink_owner(owner);
        }
        match error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    // Solid: signals.ts:655-660 (`resetOwnerForRerun`)
    pub fn reset_owner_for_rerun(&mut self, owner: OwnerId) -> Res<()> {
        if !self.owners[owner].children.is_empty() || !self.owners[owner].disposal.is_empty() {
            self.dispose_owner(owner, false)?;
        }
        let node = &mut self.owners[owner];
        node.child_count = 0;
        node.scope_slot = -1;
        Ok(())
    }

    // Solid: signals.ts:662-668 (`createRoot`)
    pub fn create_root<T>(
        &mut self,
        id: Option<String>,
        init: impl FnOnce(&mut Server, OwnerId) -> Res<T>,
    ) -> Res<T> {
        let owner = self.create_owner(id, false)?;
        self.run_with_owner(Some(owner), |s| init(s, owner))
    }
}

#[cfg(test)]
mod tests {
    use super::format_child_id;

    #[test]
    fn child_ids_are_solids() {
        // `formatChildId(prefix, n)`: base 36, with a length letter from 36 on.
        assert_eq!(format_child_id("", 0), "0");
        assert_eq!(format_child_id("", 35), "z");
        assert_eq!(format_child_id("", 36), "A10");
        assert_eq!(format_child_id("8", 2), "82");
        assert_eq!(format_child_id("f0", 1295), "f0Azz");
        assert_eq!(format_child_id("", 1296), "B100");
    }
}

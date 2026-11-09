//! Solid: signals.ts — `refresh()` and the promise-delivery reader it
//! creates on a microtask (`watch`).
//!
//! The refresh promise itself is not modelled: nothing awaits it (fuzz/
//! solid.mjs attaches only a no-op `.catch`), so its resolution and the
//! no-op reactions it queues change no observable order. Its waiter is: a
//! computed under its own root that pulls the target (CONFIG_FRESH_READ),
//! reads it as a truth reader (CONFIG_AUTHORITATIVE), is re-derived by its
//! status (CONFIG_REDERIVE), and disposes itself on delivery.
use super::*;

impl Runtime {
    /// `refresh(accessor)` (signals.ts:923-1004). Every accessor carries
    /// its node (`$REFRESH`, signals.ts:140-144); `markRefresh` ignores a
    /// signal, whose waiter is created all the same.
    pub fn refresh(&mut self, node: NodeId) {
        self.mark_refresh(node);
        let own = self.flush_transaction;
        self.microtasks.push_back(Microtask::Waiter(node, own));
    }

    // Solid: signals.ts:962-998 (the microtask): `createRoot(make)`.
    pub(super) fn refresh_waiter(&mut self, node: NodeId, own: Option<TxId>) {
        let root = self.create_root();
        self.with_owner(Some(root), |rt| rt.watch(node, own));
    }

    // Solid: signals.ts:800-851 with `config = CONFIG_FRESH_READ |
    // CONFIG_AUTHORITATIVE` (no `inPass`)
    fn watch(&mut self, target: NodeId, own: Option<TxId>) {
        // `GlobalQueue._truth = truthRead; GlobalQueue._confirmed = truthConfirmed`
        self.truth = true;
        let w = self.computed_node(
            Body::Waiter { target, own },
            None,
            CONFIG_FRESH_READ | CONFIG_AUTHORITATIVE,
        );
        self.nodes[w].config |= CONFIG_REDERIVE;
    }

    // Solid: signals.ts:817-848 (`watch`'s computed) around `fn` =
    // signals.ts:972-984 (`refresh`'s read of its target)
    pub(super) fn waiter_body(
        &mut self,
        el: NodeId,
        target: NodeId,
        own: Option<TxId>,
    ) -> Result<Out, Error> {
        let read = self.read_node(target).and_then(|v| {
            let n = &self.nodes[target];
            if n.config & CONFIG_GUESS != 0 && n.status & (STATUS_PENDING | STATUS_ERROR) != 0 {
                return Err(n
                    .error
                    .clone()
                    .expect("a pending or errored node carries its error"));
            }
            Ok(v)
        });
        // A thrown NotReadyError parks the waiter; any other error is its
        // answer (D-41), delivered as a rejection (`failed`).
        if let Err(e) = read {
            if e.is_not_ready() {
                return Err(e);
            }
        }
        // `c = getOwner()` is this waiter; `GlobalQueue._lagging` is
        // undefined (no `createDeferred`).
        let c = el;
        let joined = self.flush_transaction.or(self.pass_tx);
        if self.nodes[c].flags & REACTIVE_JOINED != 0 {
            if let Some(j) = joined {
                let j = self.resolve_tx(j);
                if own.is_none_or(|o| self.resolve_tx(o) != j) {
                    self.stale_reader(c, j);
                    return Ok(Out::Value(Value::Undef));
                }
            }
        }
        // `queueMicrotask(() => onError(v))` / `onValue(v)`: both settle the
        // refresh promise and `dispose(waiter)`.
        self.microtasks.push_back(Microtask::Deliver(el));
        Ok(Out::Value(Value::Undef))
    }
}

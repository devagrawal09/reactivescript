//! Solid: effect.ts — `effect()` and `runEffect`.
use super::*;

impl Runtime {
    /// `createRenderEffect(compute, effect)` (signals.ts:648-654).
    pub fn render_effect(&mut self, compute: ComputeFn, effect: EffectFn) -> NodeId {
        self.effect(compute, effect, EFFECT_RENDER, false)
    }

    /// `createEffect(compute, { effect })` (signals.ts:594-646), no error
    /// handler.
    pub fn user_effect(&mut self, compute: ComputeFn, effect: EffectFn) -> NodeId {
        self.effect(compute, effect, EFFECT_USER, false)
    }

    // Solid: effect.ts:70-121
    pub fn effect(&mut self, compute: ComputeFn, effect: EffectFn, ty: u32, defer: bool) -> NodeId {
        let node = self.create_effect_node(compute, effect, ty);
        self.recompute(node, true);
        if defer {
            self.apply_staged(node);
        } else if self.nodes[node].pending.is_none() {
            let tx = self.nodes[node].transaction;
            if tx.is_some_and(|t| self.txs[t].lane) || ty == EFFECT_USER {
                self.enqueue(ty, QueueCallback::RunEffect(node), tx);
            } else {
                // Type 0: the synchronous first render (D-19).
                self.run_effect(node, 0);
            }
        }
        node
    }

    // Solid: effect.ts:186-286 (no boundaries: `heldRunHook` is false;
    // `attachHook` only waits on an object value; no user-effect error arm)
    pub(super) fn run_effect(&mut self, node: NodeId, _ty: u32) {
        if !self.nodes[node].modified || self.nodes[node].flags & REACTIVE_DISPOSED != 0 {
            return;
        }
        let clean_pass = self.nodes[node].error.is_none();
        let prev_cleanup = self.nodes[node].cleanup.take();
        if let Some(c) = prev_cleanup {
            c(self);
        }
        let f = self.nodes[node].effect_fn.clone().expect("effect");
        let value = self.nodes[node].value.expect("an effect run has a value");
        let prev = self.nodes[node].prev_value;
        let next = f(self, value, prev);
        self.nodes[node].cleanup = next;
        self.nodes[node].prev_value = self.nodes[node].value;
        self.nodes[node].modified = false;
        if clean_pass {
            self.trim_stale_deps(node);
        }
    }
}

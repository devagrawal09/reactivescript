//! Solid: effect.ts — `effect()`, the effect status notifier and `runEffect`.
use super::error;
use super::*;

/// The `effect()` options the port reads (`NodeOptions & { defer,
/// schedule }`, effect.ts:74): `defer` skips the first run, `schedule`
/// queues it instead of running it at creation, `sync` is CONFIG_SYNC
/// (no async-shape probe of the compute's result, core.ts:620).
#[derive(Clone, Copy, Default, Debug)]
pub struct EffectOptions {
    pub defer: bool,
    pub schedule: bool,
    pub sync: bool,
}

impl Runtime {
    /// `createRenderEffect(compute, effect)` (signals.ts:648-654).
    pub fn render_effect(&mut self, compute: ComputeFn, effect: EffectFn) -> NodeId {
        self.effect(compute, effect, EFFECT_RENDER, false)
    }

    /// `createEffect(compute, { effect })` (signals.ts:594-617), no error
    /// handler.
    pub fn user_effect(&mut self, compute: ComputeFn, effect: EffectFn) -> NodeId {
        self.effect(compute, effect, EFFECT_USER, false)
    }

    /// `effect()` over a synchronous compute.
    pub fn effect(&mut self, compute: ComputeFn, effect: EffectFn, ty: u32, defer: bool) -> NodeId {
        self.effect_with(sync_body(compute), legacy_effect(effect), None, ty, defer)
    }

    /// `createRenderEffect` / `createEffect(compute, { effect, error })`
    /// (signals.ts:594-654) over a body that throws Solid's error objects.
    pub fn effect_with(
        &mut self,
        compute: BodyFn,
        effect: ValueEffectFn,
        error: Option<ErrorFn>,
        ty: u32,
        defer: bool,
    ) -> NodeId {
        self.effect_opts(
            compute,
            effect,
            error,
            ty,
            EffectOptions {
                defer,
                ..EffectOptions::default()
            },
        )
    }

    /// `createRenderEffect(compute, effect, options)` with the options
    /// `@solidjs/universal` passes (universal.ts:93-104: `sync`, and
    /// `schedule` for a deferred first run).
    pub fn render_effect_opts(
        &mut self,
        compute: BodyFn,
        effect: ValueEffectFn,
        options: EffectOptions,
    ) -> NodeId {
        self.effect_opts(compute, effect, None, EFFECT_RENDER, options)
    }

    /// `effect(compute, effect, error, options)` (effect.ts:70-121).
    // Solid: effect.ts:70-121; core.ts:1452-1530 (`options.sync` is
    // CONFIG_SYNC; `transparent` only shares the parent's hydration id,
    // owner.ts:260-275, which nothing here reads)
    pub fn effect_opts(
        &mut self,
        compute: BodyFn,
        effect: ValueEffectFn,
        error: Option<ErrorFn>,
        ty: u32,
        options: EffectOptions,
    ) -> NodeId {
        let node = self.create_effect_node(compute, effect, error, ty);
        if options.sync {
            self.nodes[node].config |= CONFIG_SYNC;
        }
        self.recompute(node, true);
        if options.defer {
            self.apply_staged(node);
        } else if self.nodes[node].pending.is_none() {
            let tx = self.nodes[node].transaction;
            if tx.is_some_and(|t| self.txs[t].lane) || ty == EFFECT_USER || options.schedule {
                // `enqueue(type, run, node._x?._transaction)`: with no
                // extension the argument is undefined and the lane defaults
                // to `passLane` (the creator's seat).
                let lane = if self.nodes[node].x {
                    tx
                } else {
                    self.pass_lane
                };
                self.enqueue(ty, QueueCallback::RunEffect(node), lane);
            } else {
                // Type 0: the synchronous first render (D-19).
                self.run_effect(node, 0);
            }
        }
        node
    }

    // Solid: effect.ts:123-174 (prod: no dev FYI)
    pub(super) fn notify_effect_status(&mut self, node: NodeId) {
        let actual_status = self.nodes[node].status;
        if actual_status & STATUS_ERROR != 0 {
            self.notify(node, STATUS_PENDING, 0, None);
            if self.nodes[node].effect_type == EFFECT_USER {
                if self.nodes[node].status & STATUS_ERROR != 0 {
                    self.queue_effect_run(node);
                }
                return;
            }
            let cause = error::unwrap_status_error(
                self.nodes[node]
                    .error
                    .as_ref()
                    .expect("an errored effect carries its error"),
            );
            self.escalate(node, cause);
        } else if self.nodes[node].effect_type == EFFECT_RENDER {
            let actual_error = self.nodes[node].error.clone();
            self.notify(
                node,
                STATUS_PENDING | STATUS_ERROR,
                actual_status,
                actual_error,
            );
        }
    }

    // Solid: effect.ts:179-184. A boundary takes the error (`notify` →
    // `catchStatus`); with none, `notify` returns false and Solid halts
    // reactivity and rethrows `cause`. The port records the error instead
    // (the plan evaluator fails the run on it); a fuzz program that reaches
    // it is invalid on the reference (`oracle-halted`).
    fn escalate(&mut self, node: NodeId, cause: Error) {
        if !self.notify(node, STATUS_ERROR, STATUS_ERROR, None) {
            self.errors.push(cause.message());
        }
    }

    // Solid: effect.ts:186-286
    pub(super) fn run_effect(&mut self, node: NodeId, ty: u32) {
        if !self.nodes[node].modified || self.nodes[node].flags & REACTIVE_DISPOSED != 0 {
            return;
        }
        // A queued run behind a fallback waits for the reveal (`heldRunHook`).
        if ty != 0 && self.held_run(node) {
            return;
        }
        if ty != 0 && self.attach_waits(node) {
            return;
        }
        if self.nodes[node].status & STATUS_ERROR != 0
            && self.nodes[node].effect_type == EFFECT_USER
        {
            let err = error::unwrap_status_error(
                self.nodes[node]
                    .error
                    .as_ref()
                    .expect("an errored effect carries its error"),
            );
            self.nodes[node].prev_value = self.nodes[node].value.clone();
            self.nodes[node].modified = false;
            match self.nodes[node].error_fn.clone() {
                Some(f) => f(self, &err),
                // `console.error(err)`: recorded for the plan evaluator.
                None => self.errors.push(err.message()),
            }
            return;
        }
        let clean_pass = self.nodes[node].error.is_none();
        let prev_cleanup = self.nodes[node].cleanup.take();
        if let Some(c) = prev_cleanup {
            c(self);
        }
        let f = self.nodes[node].effect_fn.clone().expect("effect");
        let value = self.nodes[node].value.clone();
        let prev = self.nodes[node].prev_value.clone();
        let next = f(self, value, prev);
        self.nodes[node].cleanup = next;
        self.nodes[node].prev_value = self.nodes[node].value.clone();
        self.nodes[node].modified = false;
        if clean_pass {
            self.trim_stale_deps(node);
        }
    }
}

//! Solid: action.ts — a generator body run as slices of one transaction.
//!
//! The JS generator is an `ActionBody` here; its yielded promise is a host
//! flight named by a string, and the promise reactions are `Microtask`s in
//! the runtime's FIFO queue, so their order against `queueMicrotask(flush)`
//! is JS's. Async generators (`isThenable(r)`) are not ported.
use super::*;
use std::collections::BTreeMap;

/// What resumes a body: the first `next()`, a flight's value, or its error
/// thrown in at the yield point.
#[derive(Clone, Debug)]
pub enum Resume {
    Start,
    Value(i64),
    Error(String),
}

/// One `it.next()` / `it.throw()` outcome.
#[derive(Clone, Debug)]
pub enum ActionStep {
    /// `yield promise`: wait for this host flight.
    Yield(String),
    Return,
    /// The body threw (an uncaught rejection included).
    Throw(String),
}

pub trait ActionBody {
    fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep;
}

pub(super) struct Action {
    tx: TxId,
    q: u64,
    body: Option<Box<dyn ActionBody>>,
    waiting: Option<String>,
    input: Option<Resume>,
    pub(super) outcome: Option<Result<(), String>>,
}

impl Runtime {
    /// `action(genFn)(...)` (action.ts:127-245): runs the body's first slice
    /// synchronously in a fresh, open, acted transaction.
    pub fn action(&mut self, body: Box<dyn ActionBody>) -> ActionId {
        // Solid: action.ts:152-159
        let t = self.new_transaction(false, None);
        self.txs[t].open = 1;
        self.txs[t].acted = true;
        let q = self.next_question();
        let id = self.actions.len();
        self.actions.push(Action {
            tx: t,
            q,
            body: Some(body),
            waiting: None,
            input: None,
            outcome: None,
        });
        // Solid: action.ts:238-242
        self.join_future(Some(t));
        let prev_q = self.question;
        self.set_question(q);
        self.step_action(id, Resume::Start);
        self.set_question(prev_q);
        id
    }

    // Solid: action.ts:165-204 (`step`) and 205-234 (`run`)
    fn step_action(&mut self, id: ActionId, input: Resume) {
        self.enter_action();
        let mut body = self.actions[id]
            .body
            .take()
            .expect("action body is not re-entered");
        let r = body.step(self, input);
        self.actions[id].body = Some(body);
        self.exit_action();
        match r {
            ActionStep::Throw(e) => self.action_done(id, Err(e)),
            ActionStep::Return => self.action_done(id, Ok(())),
            ActionStep::Yield(flight) => {
                // `r.value.then(...)`: a settled flight queues its reaction now.
                if let Some(result) = self.settled_flights().get(&flight).cloned() {
                    self.actions[id].input = Some(result);
                    self.microtasks.push_back(Microtask::Resume(id));
                } else {
                    self.actions[id].waiting = Some(flight);
                }
            }
        }
    }

    // Solid: action.ts:160-164 (`done`)
    fn action_done(&mut self, id: ActionId, r: Result<(), String>) {
        let t = self.resolve_tx(self.actions[id].tx);
        self.txs[t].open -= 1;
        self.schedule();
        self.actions[id].outcome = Some(r);
        self.microtasks.push_back(Microtask::Settled(id));
    }

    /// A host flight settles: each action yielded on it gets its reaction
    /// queued, in the order the reactions were registered.
    pub fn settle_flight(&mut self, flight: &str, result: Result<i64, String>) {
        let input = match result {
            Ok(v) => Resume::Value(v),
            Err(e) => Resume::Error(e),
        };
        self.flight_results.insert(flight.to_owned(), input.clone());
        for id in 0..self.actions.len() {
            if self.actions[id].waiting.as_deref() == Some(flight) {
                self.actions[id].waiting = None;
                self.actions[id].input = Some(input.clone());
                self.microtasks.push_back(Microtask::Resume(id));
            }
        }
    }

    fn settled_flights(&self) -> &BTreeMap<String, Resume> {
        &self.flight_results
    }

    // Solid: action.ts:38-48 (`inTransaction`) around `step(v)` / `step(e, true)`
    pub(super) fn resume_action(&mut self, id: ActionId) {
        let (t, q) = (self.actions[id].tx, self.actions[id].q);
        let input = self.actions[id]
            .input
            .take()
            .expect("resumed action has an input");
        let prev_q = self.question;
        self.set_question(q);
        self.join_future(Some(t));
        self.step_action(id, input);
        if self.action_depth == 0 {
            self.flush_all();
        }
        self.set_question(prev_q);
    }

    pub fn action_waiting(&self, id: ActionId) -> Option<&str> {
        self.actions[id].waiting.as_deref()
    }

    pub fn action_outcome(&self, id: ActionId) -> Option<&Result<(), String>> {
        self.actions[id].outcome.as_ref()
    }
}

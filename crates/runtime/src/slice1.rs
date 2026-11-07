//! Scalar action/optimistic lane path. Source mapping and exclusions: docs/SLICE1.md.
//! The M1 graph is retained for dependencies and effect scheduling, not transactions.
use crate::{Computation, Compute, MemoOptions, NodeId, ReadResult, Runtime as Graph};
use std::{cell::RefCell, rc::Rc};
pub type SourceId = usize;
pub type TxId = usize;
struct Source {
    truth: NodeId,
    shown: NodeId,
    override_flag: Option<NodeId>,
    lane_value: Option<NodeId>,
    pending_value: Option<i64>,
    lane: Option<i64>,
    transaction: Option<TxId>,
    guess: bool,
    question: u64,
}
struct Transaction {
    nodes: Vec<SourceId>,
    into: Option<TxId>,
    parent: Option<TxId>,
    lane: bool,
    open: usize,
    acted: bool,
    shown: bool,
}
#[derive(Default)]
struct State {
    nodes: Vec<Source>,
    transactions: Vec<Transaction>,
    flush_transaction: Option<TxId>,
    pending: Vec<SourceId>,
    pending_guesses: Vec<(SourceId, i64, u64)>,
    question: u64,
}
#[derive(Clone, Default)]
pub struct Runtime {
    pub graph: Graph<i64>,
    state: Rc<RefCell<State>>,
}
impl Runtime {
    pub fn signal(&self, value: i64) -> SourceId {
        let truth = self.graph.signal(value).id();
        self.add_source(truth, None)
    }
    pub fn optimistic(&self, seed: Compute<i64>) -> SourceId {
        let truth = self.graph.memo(seed, MemoOptions::default());
        self.add_source(truth, Some(()))
    }
    pub fn optimistic_value(&self, value: i64) -> SourceId {
        let truth = self.graph.signal(value).id();
        self.add_source(truth, Some(()))
    }
    fn add_source(&self, truth: NodeId, optimistic: Option<()>) -> SourceId {
        let (shown, flag, lane) = if optimistic.is_some() {
            let f = self.graph.signal(0).id();
            let l = self.graph.signal(0).id();
            let n = self.graph.memo(
                Rc::new(move |g, _| {
                    Ok(Computation::Ready(if g.read(f)? != 0 {
                        g.read(l)?
                    } else {
                        g.read(truth)?
                    }))
                }),
                MemoOptions::default(),
            );
            (n, Some(f), Some(l))
        } else {
            (truth, None, None)
        };
        let mut s = self.state.borrow_mut();
        let id = s.nodes.len();
        s.nodes.push(Source {
            truth,
            shown,
            override_flag: flag,
            lane_value: lane,
            pending_value: None,
            lane: None,
            transaction: None,
            guess: false,
            question: 0,
        });
        id
    }
    pub fn node(&self, id: SourceId) -> NodeId {
        self.state.borrow().nodes[id].shown
    }
    pub fn read(&self, id: SourceId) -> ReadResult<i64> {
        self.graph.read(self.node(id))
    }
    pub fn current(&self, id: SourceId) -> ReadResult<i64> {
        if self.state.borrow().nodes[id].override_flag.is_some() {
            return self.guessed_value(id);
        }
        if let Some(v) = self.state.borrow().nodes[id].pending_value {
            return Ok(v);
        }
        self.read(id)
    }
    pub fn guessed_value(&self, id: SourceId) -> ReadResult<i64> {
        let s = self.state.borrow();
        if let Some((_, v, _)) = s.pending_guesses.iter().rev().find(|(n, _, _)| *n == id) {
            return Ok(*v);
        }
        if let Some(v) = s.nodes[id].lane {
            return Ok(v);
        }
        drop(s);
        self.read(id)
    }
    pub fn write(&self, id: SourceId, value: i64) {
        let mut s = self.state.borrow_mut();
        s.nodes[id].pending_value = Some(value);
        if !s.pending.contains(&id) {
            s.pending.push(id)
        }
    }
    pub fn optimistic_write(&self, id: SourceId, value: i64) {
        assert!(
            self.state.borrow().nodes[id].override_flag.is_some(),
            "not optimistic"
        );
        let prev = self.guessed_value(id).expect("optimistic seed");
        let mut s = self.state.borrow_mut();
        if prev == value && !s.nodes[id].guess {
            return;
        }
        s.question += 1;
        let q = s.question;
        s.pending_guesses.push((id, value, q));
    }
    fn new_transaction(&self, lane: bool, parent: Option<TxId>) -> TxId {
        let mut s = self.state.borrow_mut();
        let t = s.transactions.len();
        s.transactions.push(Transaction {
            nodes: vec![],
            into: None,
            parent,
            lane,
            open: 0,
            acted: false,
            shown: false,
        });
        t
    }
    pub fn resolve_tx(&self, mut t: TxId) -> TxId {
        let s = self.state.borrow();
        while let Some(f) = s.transactions[t].into {
            t = f
        }
        t
    }
    fn merge(&self, t: TxId, f: TxId) {
        let t = self.resolve_tx(t);
        let f = self.resolve_tx(f);
        let mut s = self.state.borrow_mut();
        if t == f || s.transactions[t].lane || s.transactions[f].lane {
            return;
        }
        s.transactions[t].into = Some(f);
        s.transactions[f].open += s.transactions[t].open;
        s.transactions[f].acted |= s.transactions[t].acted;
        let nodes = s.transactions[t].nodes.clone();
        for n in nodes {
            if !s.transactions[f].nodes.contains(&n) {
                s.transactions[f].nodes.push(n)
            }
        }
    }
    pub fn join_future(&self, t: TxId) {
        let f = self.state.borrow().flush_transaction;
        if let Some(f) = f {
            self.merge(t, f)
        } else {
            self.state.borrow_mut().flush_transaction = Some(self.resolve_tx(t))
        }
    }
    pub fn begin_action(&self) -> TxId {
        let t = self.new_transaction(false, None);
        {
            let mut s = self.state.borrow_mut();
            s.transactions[t].open = 1;
            s.transactions[t].acted = true;
        }
        self.join_future(t);
        t
    }
    pub fn finish_action(&self, t: TxId) {
        let t = self.resolve_tx(t);
        self.state.borrow_mut().transactions[t].open -= 1;
    }
    fn list(&self, id: SourceId, t: TxId) {
        let mut s = self.state.borrow_mut();
        s.nodes[id].transaction = Some(t);
        if !s.transactions[t].nodes.contains(&id) {
            s.transactions[t].nodes.push(id)
        }
    }
    fn apply_guesses(&self, mut parent: Option<TxId>) {
        let guesses = std::mem::take(&mut self.state.borrow_mut().pending_guesses);
        let mut lane = None;
        for (id, value, q) in guesses {
            let holder = self.state.borrow().nodes[id].transaction;
            let t = if let Some(h) = holder {
                if self.state.borrow().transactions[h].lane {
                    let p = self.state.borrow().transactions[h].parent.unwrap();
                    if let Some(t) = parent {
                        self.merge(t, p);
                        parent = Some(self.resolve_tx(p));
                    }
                    h
                } else {
                    self.new_transaction(true, Some(self.resolve_tx(h)))
                }
            } else {
                let Some(p) = parent else { continue };
                if let Some(l) = lane {
                    l
                } else {
                    let l = self.new_transaction(true, Some(self.resolve_tx(p)));
                    lane = Some(l);
                    l
                }
            };
            self.list(id, t);
            let mut s = self.state.borrow_mut();
            let n = &mut s.nodes[id];
            n.lane = Some(value);
            n.guess = true;
            n.question = q;
            self.graph.write(n.override_flag.unwrap(), 1);
            self.graph.write(n.lane_value.unwrap(), value);
            s.transactions[t].shown = true;
        }
    }
    fn end_lanes(&self, parent: TxId) {
        let lanes = self
            .state
            .borrow()
            .transactions
            .iter()
            .enumerate()
            .filter_map(|(i, t)| {
                if t.lane {
                    t.parent.map(|p| (i, p))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        for (l, p) in lanes.into_iter().rev() {
            if self.resolve_tx(p) != parent {
                continue;
            }
            let ids = self.state.borrow().transactions[l].nodes.clone();
            for id in ids {
                let mut s = self.state.borrow_mut();
                let n = &mut s.nodes[id];
                if n.transaction != Some(l) {
                    continue;
                }
                // dissolveLane: discard the guess, return to truth; no old-value write.
                n.lane = None;
                n.guess = false;
                n.transaction = None;
                self.graph.write(n.override_flag.unwrap(), 0);
            }
            self.state.borrow_mut().transactions[l].shown = false;
        }
    }
    pub fn flush(&self) {
        let pending = std::mem::take(&mut self.state.borrow_mut().pending);
        for id in &pending {
            let held = self.state.borrow().nodes[*id].transaction;
            if let Some(t) = held {
                if !self.state.borrow().transactions[t].lane {
                    self.join_future(t)
                }
            }
        }
        let parent = self
            .state
            .borrow()
            .flush_transaction
            .map(|t| self.resolve_tx(t));
        for id in pending {
            if let Some(t) = parent {
                self.list(id, t)
            } else {
                let mut s = self.state.borrow_mut();
                let n = &mut s.nodes[id];
                if let Some(v) = n.pending_value.take() {
                    self.graph.write(n.truth, v)
                }
            }
        }
        self.apply_guesses(parent);
        let ready = self
            .state
            .borrow()
            .transactions
            .iter()
            .enumerate()
            .filter_map(|(i, t)| (!t.lane && t.into.is_none() && t.open == 0).then_some(i))
            .collect::<Vec<_>>();
        for t in ready {
            let ids = self.state.borrow().transactions[t].nodes.clone();
            for id in ids {
                let held = self.state.borrow().nodes[id].transaction;
                if held.is_none() || self.resolve_tx(held.unwrap()) != t {
                    continue;
                }
                let mut s = self.state.borrow_mut();
                let n = &mut s.nodes[id];
                if let Some(v) = n.pending_value.take() {
                    self.graph.write(n.truth, v)
                }
                n.transaction = None;
            }
            self.end_lanes(t);
        }
        self.state.borrow_mut().flush_transaction = None;
        self.graph.flush();
    }
}

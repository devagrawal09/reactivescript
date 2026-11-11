//! The server hosts of a frames plan (`server` JS, RX SF-5a), answered by a
//! script recorded from the native split's own server: each call is matched
//! to the next answer for its host (call numbers per host, one-based, over
//! the server's lifetime: the document render, then every request), its
//! arguments checked, and its value or plain `Error` returned. A call the
//! script does not answer, or answers for other arguments, fails the server
//! (fail closed). Every call is logged as the native server logs it
//! (frontend `frames/host-table.mjs`): host, args, value or error.
use serde::Deserialize;
use serde_json::{json, Value as J};
use std::{cell::RefCell, collections::HashMap};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Answer {
    pub host: String,
    pub call: usize,
    pub args: Vec<J>,
    #[serde(default)]
    pub value: Option<J>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Hosts {
    answers: Vec<Answer>,
    calls: RefCell<HashMap<String, usize>>,
    pub log: RefCell<Vec<J>>,
    pub failure: RefCell<Option<String>>,
}

/// A host call's outcome: its value, or the message of the plain `Error` it
/// threw. The outer `Err` of [`Hosts::call`] is a script failure, which
/// fails the server.
pub type HostResult = Result<J, String>;

impl Hosts {
    pub fn new(answers: Vec<Answer>) -> Result<Hosts, String> {
        for a in &answers {
            if a.value.is_some() == a.error.is_some() {
                return Err(format!(
                    "the answer to {}#{} needs exactly one of value and error",
                    a.host, a.call
                ));
            }
        }
        Ok(Hosts {
            answers,
            ..Default::default()
        })
    }

    pub fn call(&self, host: &str, args: &[J]) -> Result<HostResult, String> {
        let n = {
            let mut calls = self.calls.borrow_mut();
            let n = calls.entry(host.to_string()).or_insert(0);
            *n += 1;
            *n
        };
        let Some(a) = self.answers.iter().find(|a| a.host == host && a.call == n) else {
            let m = format!("no server answer for {host}#{n}");
            self.failure.borrow_mut().get_or_insert(m.clone());
            return Err(m);
        };
        if a.args != args {
            let m = format!(
                "{host}#{n} was called with {}, the script answers {}",
                J::Array(args.to_vec()),
                J::Array(a.args.clone())
            );
            self.failure.borrow_mut().get_or_insert(m.clone());
            return Err(m);
        }
        match (&a.value, &a.error) {
            (Some(v), _) => {
                self.log
                    .borrow_mut()
                    .push(json!({ "host": host, "args": args, "value": v }));
                Ok(Ok(v.clone()))
            }
            (_, Some(e)) => {
                self.log
                    .borrow_mut()
                    .push(json!({ "host": host, "args": args, "error": e }));
                Ok(Err(e.clone()))
            }
            _ => unreachable!("checked in new"),
        }
    }
}

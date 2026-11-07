use crate::plan::{App, HostRegistry, Plan};
use serde::Deserialize;
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Host {
    name: String,
    parameters: Vec<String>,
    returns: String,
    #[serde(rename = "async")]
    asynchronous: bool,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Step {
    Mount {
        frame: String,
    },
    Click {
        element: usize,
        frame: String,
    },
    Resolve {
        host: String,
        call: usize,
        value: Value,
        frame: String,
    },
    Reject {
        host: String,
        call: usize,
        error: String,
        frame: String,
    },
}
impl Step {
    fn expected(&self) -> &str {
        match self {
            Self::Mount { frame }
            | Self::Click { frame, .. }
            | Self::Resolve { frame, .. }
            | Self::Reject { frame, .. } => frame,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    pub version: u32,
    pub name: String,
    pub fixture: String,
    pub host: Vec<Host>,
    pub steps: Vec<Step>,
}
/// Returns every observed frame, or the first exact mismatch. Never changes expectations.
pub fn run(plan: Plan, scenario: Scenario) -> Result<Vec<String>, String> {
    if scenario.version != 1 || !matches!(scenario.steps.first(), Some(Step::Mount { .. })) {
        return Err("scenario must start with mount, version 1".into());
    }
    let calls = Rc::new(RefCell::new(BTreeMap::<String, usize>::new()));
    let mut registry = HostRegistry::default();
    for host in &scenario.host {
        // The format allows other scalar types. This integer-only slice rejects them explicitly.
        if !host.asynchronous
            || host.returns != "number"
            || host.parameters.iter().any(|p| p != "number")
        {
            return Err("slice 1 supports async number hosts only".into());
        }
        let name = host.name.clone();
        let count = host.parameters.len();
        let calls = calls.clone();
        registry.register(
            name.clone(),
            Box::new(move |args| {
                if args.len() != count {
                    return Err("host argument count mismatch".into());
                }
                let mut calls = calls.borrow_mut();
                let n = calls.entry(name.clone()).or_insert(0);
                *n += 1;
                Ok(format!("{name}:{n}"))
            }),
        )?;
    }
    let mut app = App::mount(plan, registry)?;
    let mut frames = Vec::new();
    for (index, step) in scenario.steps.iter().enumerate() {
        match step {
            Step::Mount { .. } => {
                if index != 0 {
                    return Err("duplicate mount".into());
                }
            }
            Step::Click { element, .. } => app.click(*element)?,
            Step::Resolve {
                host, call, value, ..
            } => {
                if *call == 0 {
                    return Err("call numbers start at one".into());
                }
                app.settle(
                    &format!("{host}:{call}"),
                    Ok(value.as_i64().ok_or("slice 1 requires integer result")?),
                )?
            }
            Step::Reject {
                host, call, error, ..
            } => {
                if *call == 0 {
                    return Err("call numbers start at one".into());
                }
                app.settle(&format!("{host}:{call}"), Err(error.clone()))?
            }
        }
        let actual = app.frame();
        if actual != step.expected() {
            return Err(format!(
                "step {index}: expected {:?}, actual {:?}",
                step.expected(),
                actual
            ));
        }
        frames.push(actual);
    }
    if app.pending() != 0 {
        return Err("scenario left host calls pending".into());
    }
    Ok(frames)
}

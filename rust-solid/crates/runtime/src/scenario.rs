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

// ---- scenario format version 2 (frontend/docs/SCENARIO-FORMAT.md) ----

/// A click target: the `index`-th live clickable whose rendered text is
/// `text` (and whose parent element's is `parent`, if given).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub text: String,
    #[serde(default)]
    pub parent: Option<String>,
    pub index: usize,
}

/// A step of a version 1 or 2 scenario, as the v2 plan consumer reads it.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum StepV2 {
    Mount {
        frame: String,
    },
    Click {
        #[serde(default)]
        element: Option<usize>,
        #[serde(default)]
        target: Option<Target>,
        frame: String,
    },
    Resolve {
        host: String,
        call: usize,
        #[serde(default)]
        args: Option<Vec<Value>>,
        value: Value,
        frame: String,
    },
    Reject {
        host: String,
        call: usize,
        #[serde(default)]
        args: Option<Vec<Value>>,
        error: String,
        frame: String,
    },
}
impl StepV2 {
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
pub struct ScenarioV2 {
    /// 1, 2, or 2.1 (a JSON number: structured host results, frames that
    /// show `Loading` and `Errored` fallbacks).
    pub version: crate::plan_v2::PlanVersion,
    pub name: String,
    pub fixture: String,
    pub host: Vec<Host>,
    pub steps: Vec<StepV2>,
}

fn json_type(v: &Value) -> &'static str {
    match v {
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Bool(_) => "boolean",
        _ => "other",
    }
}

/// A scenario value as a runtime value: an integer, a string or a boolean.
fn scalar(v: &Value) -> Result<crate::slice1::Value, String> {
    use crate::slice1::Value as V;
    match v {
        Value::String(s) => Ok(V::str(s)),
        Value::Bool(b) => Ok(V::Bool(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(V::Int)
            .ok_or_else(|| format!("scenario number {n} is not an integer")),
        other => Err(format!("scenario value {other} is not a scalar")),
    }
}

/// The JSON form of a request argument, for comparing with `args`.
fn to_json(v: &crate::slice1::Value) -> Value {
    use crate::slice1::Value as V;
    match v {
        V::Int(i) => Value::from(*i),
        V::Str(s) => Value::from(&**s),
        V::Bool(b) => Value::from(*b),
        other => Value::from(format!("{other:?}")),
    }
}

/// The checks `slices/run-js.ts` `loadScenario` makes, and the plan's hosts
/// against the scenario's.
fn validate_v2(plan: &crate::plan_v2::Plan, s: &ScenarioV2) -> Result<(), String> {
    let v21 = s.version.is_v21();
    if s.version != 1 && s.version != 2 && !v21 {
        return Err(format!("scenario version {} is not 1 or 2", s.version));
    }
    let mut f = s.fixture.chars();
    if !(f.next().is_some_and(|c| c.is_ascii_lowercase())
        && f.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
    {
        return Err(format!("fixture {:?}", s.fixture));
    }
    if !matches!(s.steps.first(), Some(StepV2::Mount { .. })) {
        return Err("a scenario starts with mount".into());
    }
    if s.steps
        .iter()
        .filter(|x| matches!(x, StepV2::Mount { .. }))
        .count()
        != 1
    {
        return Err("a scenario mounts exactly once".into());
    }
    const TYPES: [&str; 3] = ["number", "string", "boolean"];
    let mut names = std::collections::BTreeSet::new();
    for h in &s.host {
        let mut c = h.name.chars();
        let identifier = c
            .next()
            .is_some_and(|x| x.is_ascii_alphabetic() || x == '_')
            && c.all(|x| x.is_ascii_alphanumeric() || x == '_');
        if !identifier || !names.insert(h.name.clone()) {
            return Err(format!("host name {:?}", h.name));
        }
        // Version 2.1: a structured result in the eval interface grammar
        // (frontend docs/SCENARIO-FORMAT.md, "Version 2.1").
        let returns_ok = if v21 {
            crate::plan_v2::HostType::parse(&h.returns).is_ok()
        } else {
            TYPES.contains(&h.returns.as_str())
        };
        if !h.asynchronous
            || !returns_ok
            || h.parameters.iter().any(|p| !TYPES.contains(&p.as_str()))
        {
            return Err(format!(
                "host {} must be async with scalar parameters and {}",
                h.name,
                if v21 {
                    "a result type"
                } else {
                    "scalar types (host results are scalars before version 2.1)"
                }
            ));
        }
    }
    // The plan's hosts are the scenario's, in order; a v2.1 plan also says
    // which are pure, which a scenario's signature does not.
    let same = plan.hosts.len() == s.host.len()
        && plan.hosts.iter().zip(&s.host).all(|(p, h)| {
            p.name == h.name
                && p.params == h.parameters
                && p.returns == h.returns
                && (p.pure.is_none() || v21)
        });
    if !same {
        return Err("the plan's hosts are not the scenario's".into());
    }
    for (i, step) in s.steps.iter().enumerate() {
        match step {
            StepV2::Mount { .. } => {}
            StepV2::Click {
                element, target, ..
            } => match (element, target) {
                (Some(_), None) => {}
                (None, Some(_)) if s.version == 2 || v21 => {}
                (None, Some(_)) => return Err(format!("step {i}: click targets are version 2")),
                _ => return Err(format!("step {i}: a click has element or target, not both")),
            },
            StepV2::Resolve {
                host, call, args, ..
            }
            | StepV2::Reject {
                host, call, args, ..
            } => {
                let h = s
                    .host
                    .iter()
                    .find(|h| &h.name == host)
                    .ok_or_else(|| format!("step {i}: undeclared host {host}"))?;
                if *call == 0 {
                    return Err(format!("step {i}: call numbers start at one"));
                }
                match (s.version == 1, args) {
                    (true, None) => {}
                    (true, Some(_)) => return Err(format!("step {i}: args are version 2")),
                    (_, None) => return Err(format!("step {i}: version 2 settles with args")),
                    (_, Some(a)) => {
                        if a.len() != h.parameters.len()
                            || a.iter().zip(&h.parameters).any(|(v, p)| json_type(v) != p)
                        {
                            return Err(format!("step {i}: args do not match {host}"));
                        }
                    }
                }
                if let StepV2::Resolve { value, .. } = step {
                    let ok = if v21 {
                        crate::plan_v2::HostType::parse(&h.returns)
                            .is_ok_and(|t| t.conforms_json(value))
                    } else {
                        json_type(value) == h.returns
                    };
                    if !ok {
                        return Err(format!("step {i}: {host} returns a {}", h.returns));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Picks a click target against the live tree.
fn select(app: &crate::plan_v2::App, t: &Target) -> Result<usize, String> {
    let h = app.host.borrow();
    let matches: Vec<usize> = app
        .clickables()
        .into_iter()
        .filter(|(n, parent)| {
            h.frame(*n) == t.text
                && match &t.parent {
                    None => true,
                    Some(p) => parent.is_some_and(|q| h.frame(q) == *p),
                }
        })
        .map(|(n, _)| n)
        .collect();
    matches.get(t.index).copied().ok_or_else(|| {
        format!(
            "no clickable {:?} (parent {:?}) at index {} ({} match)",
            t.text,
            t.parent,
            t.index,
            matches.len()
        )
    })
}

/// Runs a v2 plan against a version 1 or 2 scenario: after each step, three
/// host turns (microtasks, then `flush()`), as `slices/run-js.ts` settles;
/// then exactly one frame, compared byte for byte. Returns every frame, or
/// the first failure. Never changes expectations.
pub fn run_v2(plan: crate::plan_v2::Plan, scenario: ScenarioV2) -> Result<Vec<String>, String> {
    trace_v2(plan, scenario).0
}

/// `run_v2` with the recording host's log: every host call (queries
/// included), each host request (`["request", host, number, args]`) and
/// settled action (`["action", name, null | message]`), and after each step
/// `["step", index, type]`, `["tree", …]` and `["frame", …]`; then the
/// unmount. `fuzz/plan-oracle.mjs` writes the same log from Solid's own
/// primitives and renderer.
pub fn trace_v2(
    plan: crate::plan_v2::Plan,
    scenario: ScenarioV2,
) -> (Result<Vec<String>, String>, Vec<Value>) {
    trace_v2_with(plan, scenario, crate::plan_v2::EvalTable::default())
}

/// `trace_v2` with the host's eval table (frontend `docs/EVAL.md`): the
/// compiled plan, or the refusal, of every code an eval site evaluates.
pub fn trace_v2_with(
    plan: crate::plan_v2::Plan,
    scenario: ScenarioV2,
    evals: crate::plan_v2::EvalTable,
) -> (Result<Vec<String>, String>, Vec<Value>) {
    let mut app = None;
    let r = steps_v2(plan, &scenario, &evals, &mut app);
    let log = app
        .map(|a| a.host.borrow_mut().take_log())
        .unwrap_or_default();
    (r, log)
}

fn steps_v2(
    plan: crate::plan_v2::Plan,
    scenario: &ScenarioV2,
    evals: &crate::plan_v2::EvalTable,
    app: &mut Option<crate::plan_v2::App>,
) -> Result<Vec<String>, String> {
    validate_v2(&plan, scenario)?;
    let mut frames = Vec::new();
    for (index, step) in scenario.steps.iter().enumerate() {
        let at = |e: String| format!("step {index}: {e}");
        match step {
            StepV2::Mount { .. } => {
                *app =
                    Some(crate::plan_v2::App::mount_with(plan.clone(), evals.clone()).map_err(at)?)
            }
            StepV2::Click {
                element, target, ..
            } => {
                let a = app.as_mut().expect("mounted");
                let node = match (element, target) {
                    (Some(i), None) => a
                        .clickables()
                        .get(*i)
                        .map(|(n, _)| *n)
                        .ok_or_else(|| at(format!("no clickable element {i}")))?,
                    (None, Some(t)) => select(a, t).map_err(at)?,
                    _ => unreachable!("validated"),
                };
                a.click(node).map_err(at)?;
            }
            StepV2::Resolve {
                host, call, args, ..
            }
            | StepV2::Reject {
                host, call, args, ..
            } => {
                let a = app.as_mut().expect("mounted");
                let request = a
                    .requests()
                    .into_iter()
                    .find(|r| &r.host == host && r.number == *call)
                    .ok_or_else(|| at(format!("{host} call #{call} was not issued")))?;
                if let Some(expected) = args {
                    let actual: Vec<Value> = request.args.iter().map(to_json).collect();
                    if &actual != expected {
                        return Err(at(format!(
                            "{host} call #{call} has arguments {actual:?}, not {expected:?}"
                        )));
                    }
                }
                let result = match step {
                    // Version 2.1: a structured result is a fresh plain value
                    // per resolution (the host's JSON, `structuredClone`d).
                    StepV2::Resolve { value, .. } if scenario.version.is_v21() => {
                        let h = scenario
                            .host
                            .iter()
                            .find(|h| &h.name == host)
                            .expect("validated");
                        let t = crate::plan_v2::HostType::parse(&h.returns).map_err(at)?;
                        Ok(t.value_of(value).map_err(at)?)
                    }
                    StepV2::Resolve { value, .. } => Ok(scalar(value).map_err(at)?),
                    StepV2::Reject { error, .. } => Err(error.clone()),
                    _ => unreachable!(),
                };
                a.settle(host, *call, result).map_err(at)?;
            }
        }
        let a = app.as_mut().expect("mounted");
        for _ in 0..3 {
            a.turn();
        }
        a.check().map_err(at)?;
        let actual = a.frame();
        {
            let h = a.host.borrow();
            let kind = match step {
                StepV2::Mount { .. } => "mount",
                StepV2::Click { .. } => "click",
                StepV2::Resolve { .. } => "resolve",
                StepV2::Reject { .. } => "reject",
            };
            h.push_log(serde_json::json!(["step", index, kind]));
            h.push_log(serde_json::json!(["tree", h.tree(h.root())]));
            h.push_log(serde_json::json!(["frame", actual]));
        }
        if actual != step.expected() {
            return Err(format!(
                "step {index}: expected {:?}, actual {:?}",
                step.expected(),
                actual
            ));
        }
        frames.push(actual);
    }
    let a = app.as_mut().expect("mounted");
    if a.pending() != 0 {
        return Err("scenario left host calls pending".into());
    }
    a.dispose();
    Ok(frames)
}

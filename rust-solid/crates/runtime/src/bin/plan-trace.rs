//! `plan-trace PLAN.json SCENARIO.json [EVALS.json]`: runs a v2 plan like
//! `scenario` and prints `{"result": {"frames": […]} | {"error": "…"}, "log":
//! […]}`, the recording host's log (`scenario::trace_v2`).
//! `fuzz/plan-oracle.mjs` prints the same from Solid's own primitives and
//! renderer. EVALS is the host's eval table (frontend `docs/EVAL.md`): the
//! compiled plan or refusal of each code the plan's eval sites evaluate.
use serde_json::json;
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 && args.len() != 3 {
        eprintln!("usage: plan-trace PLAN.json SCENARIO.json [EVALS.json]");
        std::process::exit(2);
    }
    let read = |p: &str| -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(p).expect("readable")).expect("JSON")
    };
    let plan = serde_json::from_value(read(&args[0])).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1)
    });
    let scenario = serde_json::from_value(read(&args[1])).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1)
    });
    let evals = match args.get(2) {
        None => rust_solid::plan_v2::EvalTable::default(),
        Some(p) => serde_json::from_value(read(p)).unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(1)
        }),
    };
    let (r, log) = rust_solid::scenario::trace_v2_with(plan, scenario, evals);
    let result = match &r {
        Ok(frames) => json!({ "frames": frames }),
        Err(e) => json!({ "error": e }),
    };
    println!("{}", json!({ "result": result, "log": log }));
    if r.is_err() {
        std::process::exit(1)
    }
}

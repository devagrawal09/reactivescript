//! `scenario PLAN.json SCENARIO.json`: runs a plan against a scenario and
//! prints the frames. The plan's `version` picks the consumer: 1 is the
//! like-slice evaluator (`plan.rs`, version-1 scenarios), 2 the plan v2
//! evaluator (`plan_v2.rs`, version-1 or -2 scenarios), and so is 2.1 (plan
//! v2.1, format-2.1 scenarios). Any other version is refused.
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let result = (|| -> Result<_, Box<dyn std::error::Error>> {
        if args.len() != 2 {
            return Err("usage: scenario PLAN.json SCENARIO.json".into());
        }
        let plan: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&args[0])?)?;
        let scenario: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&args[1])?)?;
        Ok(
            match plan.get("version").and_then(serde_json::Value::as_u64) {
                Some(1) => rust_solid::scenario::run(
                    serde_json::from_value(plan)?,
                    serde_json::from_value(scenario)?,
                )?,
                Some(2) => rust_solid::scenario::run_v2(
                    serde_json::from_value(plan)?,
                    serde_json::from_value(scenario)?,
                )?,
                // Plan v2.1 (async data) goes to the v2 consumer, which reads
                // both (frontend plan/docs/PLAN-V2.md, "v2.1: async data").
                None if plan.get("version").and_then(serde_json::Value::as_f64) == Some(2.1) => {
                    rust_solid::scenario::run_v2(
                        serde_json::from_value(plan)?,
                        serde_json::from_value(scenario)?,
                    )?
                }
                other => return Err(format!("unsupported plan version {other:?}").into()),
            },
        )
    })();
    match result {
        Ok(frames) => println!("{}", serde_json::to_string(&frames).unwrap()),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1)
        }
    }
}

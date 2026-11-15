//! `corpus DIR…`: replays every plan-fuzz program (`{plan, scenario}` JSON) in
//! the folders through the plan v2 consumer, with the host log on, and checks
//! the result against the recorded native one when present. For the bench
//! suite's function-level coverage report: run under callgrind collecting
//! only inside `corpus_run`.
use rust_solid::scenario::trace_v2;
use serde_json::Value as J;

#[inline(never)]
fn corpus_run(plan: rust_solid::plan_v2::Plan, scenario: rust_solid::scenario::ScenarioV2) -> Result<Vec<String>, String> {
    trace_v2(plan, scenario).0
}

fn main() {
    let (mut ran, mut bad) = (0, 0);
    for dir in std::env::args().skip(1) {
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
        files.sort();
        for p in files {
            let f: J = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
            let (Ok(plan), Ok(scenario)) = (serde_json::from_value(f["plan"].clone()), serde_json::from_value(f["scenario"].clone())) else { continue };
            let r = corpus_run(plan, scenario);
            ran += 1;
            let got = match &r { Ok(frames) => serde_json::json!({"frames": frames}), Err(e) => serde_json::json!({"error": e}) };
            if !f["native"]["result"].is_null() && got != f["native"]["result"] {
                bad += 1;
                eprintln!("{}: differs from native", p.display());
            }
        }
    }
    println!("{{\"ran\":{ran},\"differ\":{bad}}}");
}

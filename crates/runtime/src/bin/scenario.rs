fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let result = (|| -> Result<_, Box<dyn std::error::Error>> {
        if args.len() != 2 {
            return Err("usage: scenario PLAN.json SCENARIO.json".into());
        }
        let plan = serde_json::from_str(&std::fs::read_to_string(&args[0])?)?;
        let scenario = serde_json::from_str(&std::fs::read_to_string(&args[1])?)?;
        Ok(rust_solid::scenario::run(plan, scenario)?)
    })();
    match result {
        Ok(frames) => println!("{}", serde_json::to_string(&frames).unwrap()),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1)
        }
    }
}

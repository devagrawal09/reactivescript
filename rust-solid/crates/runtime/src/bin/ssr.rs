//! `ssr PLAN.json`: renders a v2 plan on the server as Solid's
//! `renderToString(() => App())` renders its canonical TSX twin
//! (crate::ssr, docs/SSR.md) and prints `{"html": "…"}`, or
//! `{"error": "…"}` with exit status 1 for a refusal or a thrown error.
//! `ssr --hydration-script` prints `generateHydrationScript()`'s output.
use serde_json::json;
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() == 1 && args[0] == "--hydration-script" {
        println!(
            "{}",
            json!({ "script": rust_solid::ssr::web::generate_hydration_script(&[]) })
        );
        return;
    }
    if args.len() != 1 {
        eprintln!("usage: ssr PLAN.json | ssr --hydration-script");
        std::process::exit(2);
    }
    let text = std::fs::read_to_string(&args[0]).unwrap_or_else(|e| {
        eprintln!("{}: {e}", args[0]);
        std::process::exit(2)
    });
    let result = serde_json::from_str::<rust_solid::plan_v2::Plan>(&text)
        .map_err(|e| format!("plan: {e}"))
        .and_then(|plan| rust_solid::ssr::plan::render(&plan));
    match result {
        Ok(html) => println!("{}", json!({ "html": html })),
        Err(e) => {
            println!("{}", json!({ "error": e }));
            std::process::exit(1)
        }
    }
}

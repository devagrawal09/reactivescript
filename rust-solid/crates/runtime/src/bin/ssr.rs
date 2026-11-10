//! `ssr PLAN.json`: renders a plan on the server as Solid's
//! `renderToString(() => App())` renders its canonical TSX twin
//! (crate::ssr, docs/SSR.md) and prints `{"html": "…"}` (with the host
//! `requests` it made, when there are any), or `{"error": "…"}` with exit
//! status 1 for a refusal or a thrown error.
//!
//! `ssr PLAN.json --stream ANSWERS.json`: `renderToStream(() =>
//! App()).pipe(sink)` under a server answer script (a JSON array of
//! `{host, call, args, mode: "now"|"idle", at?, value|error}`, frontend
//! `ssr/stream-core.ts`), and prints `{"chunks": […], "events": […],
//! "requests": […]}`: the chunks the sink received, interleaved with the
//! settlements (`{"chunk"}`, `{"settle": "host#n"}`, `{"end": true}`).
//!
//! `ssr --hydration-script` prints `generateHydrationScript()`'s output.
use rust_solid::ssr::plan::{render_stream, render_string, Rendered, ServerAnswer};
use rust_solid::ssr::stream::StreamEvent;
use serde_json::{json, Value as J};

fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("{path}: {e}");
        std::process::exit(2)
    })
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() == 1 && args[0] == "--hydration-script" {
        println!(
            "{}",
            json!({ "script": rust_solid::ssr::web::generate_hydration_script(&[]) })
        );
        return;
    }
    let stream = args.len() == 3 && args[1] == "--stream";
    if args.len() != 1 && !stream {
        eprintln!(
            "usage: ssr PLAN.json | ssr PLAN.json --stream ANSWERS.json | ssr --hydration-script"
        );
        std::process::exit(2);
    }
    let plan = serde_json::from_str::<rust_solid::plan_v2::Plan>(&read(&args[0]))
        .map_err(|e| format!("plan: {e}"));
    let result: Result<Rendered, String> = plan.and_then(|plan| {
        if stream {
            let answers = serde_json::from_str::<Vec<ServerAnswer>>(&read(&args[2]))
                .map_err(|e| format!("answers: {e}"))?;
            render_stream(&plan, &answers)
        } else {
            render_string(&plan)
        }
    });
    match result {
        Ok(r) => {
            let mut out = serde_json::Map::new();
            if stream {
                let chunks: Vec<J> = r
                    .events
                    .iter()
                    .filter_map(|e| match e {
                        StreamEvent::Chunk(c) => Some(J::String(c.clone())),
                        _ => None,
                    })
                    .collect();
                let events: Vec<J> = r
                    .events
                    .iter()
                    .map(|e| match e {
                        StreamEvent::Chunk(c) => json!({ "chunk": c }),
                        StreamEvent::Settle(s) => json!({ "settle": s }),
                        StreamEvent::End => json!({ "end": true }),
                    })
                    .collect();
                out.insert("chunks".into(), J::Array(chunks));
                out.insert("events".into(), J::Array(events));
                out.insert("requests".into(), json!(r.requests));
            } else {
                out.insert("html".into(), J::String(r.html));
                if !r.requests.is_empty() {
                    out.insert("requests".into(), json!(r.requests));
                }
            }
            if !r.render_errors.is_empty() {
                out.insert("renderErrors".into(), json!(r.render_errors));
            }
            println!("{}", J::Object(out));
        }
        Err(e) => {
            println!("{}", json!({ "error": e }));
            std::process::exit(1)
        }
    }
}

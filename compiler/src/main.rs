//! `rxc`: the crate's command line.
//!
//!   rxc check file.rx...   diagnostics, as `ref/check.ts` prints them
//!   rxc model file.rx...   the resolved model (CP-6) of each module, as JSON
//!   rxc conform            reads `[{id, entry, files: {path: source}}]` on stdin and prints, per program, every module's
//!                          AST, the diagnostics, the printed signatures and the models: what `ref/crate.ts` compares.

use reactivescript::check::check_modules;
use reactivescript::modules::load_modules;
use reactivescript::signature::print_signature;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

fn read_disk(p: &str) -> Option<String> {
    if Path::new(p).is_file() {
        std::fs::read_to_string(p).ok()
    } else {
        None
    }
}

fn abs(f: &str) -> String {
    std::path::absolute(f).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| f.to_string())
}

fn conform_one(entry: &str, files: &HashMap<String, String>) -> Value {
    let read = |p: &str| files.get(p).cloned();
    let set = match load_modules(entry, &read) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e.0 }),
    };
    let mut asts = Map::new();
    for p in &set.order {
        asts.insert(p.clone(), set.programs[p].to_json());
    }
    let checked = check_modules(&set);
    let mut sigs = Map::new();
    for p in &set.order {
        sigs.insert(p.clone(), json!(print_signature(&checked.sigs[p])));
    }
    let mut models = Map::new();
    for (p, m) in &checked.models {
        models.insert(p.clone(), m.clone());
    }
    json!({
        "order": set.order,
        "asts": asts,
        "diags": checked.diags.iter().map(|d| d.to_json()).collect::<Vec<_>>(),
        "sigs": sigs,
        "models": models,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else {
        eprintln!("usage: rxc check|model file.rx... | rxc conform < request.json");
        std::process::exit(2);
    };
    match cmd.as_str() {
        "conform" => {
            let mut input = String::new();
            std::io::stdin().read_to_string(&mut input).expect("stdin");
            let req: Vec<Value> = serde_json::from_str(&input).expect("request: [{id, entry, files}]");
            let out: Vec<Value> = req
                .iter()
                .map(|r| {
                    let files: HashMap<String, String> = r["files"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect();
                    let entry = r["entry"].as_str().unwrap();
                    let mut v = std::panic::catch_unwind(|| conform_one(entry, &files)).unwrap_or_else(|e| {
                        let msg = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                        json!({ "panic": msg })
                    });
                    v["id"] = r["id"].clone();
                    v
                })
                .collect();
            println!("{}", serde_json::to_string(&out).unwrap());
        }
        "check" | "model" => {
            let mut bad = 0;
            for f in &args[1..] {
                let set = match load_modules(&abs(f), &read_disk) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("{}: parse error: {}", f, e.0);
                        bad += 1;
                        continue;
                    }
                };
                let checked = check_modules(&set);
                for d in &checked.diags {
                    bad += 1;
                    eprintln!("{}:{}: error {} [{}] {}", d.file.as_deref().unwrap_or(f), d.line, d.code, d.rule, d.msg);
                }
                if cmd == "model" {
                    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned() + "/").unwrap_or_default();
                    let ms: Vec<Value> = set
                        .order
                        .iter()
                        .map(|p| {
                            let mut m = checked.models[p].clone();
                            m["file"] = json!(p.replacen(&cwd, "", 1));
                            m
                        })
                        .collect();
                    println!("{}", serde_json::to_string_pretty(&ms).unwrap());
                } else if checked.diags.is_empty() {
                    println!("{}: ok", f);
                }
            }
            std::process::exit(if bad > 0 { 1 } else { 0 });
        }
        _ => {
            eprintln!("unknown command {}", cmd);
            std::process::exit(2);
        }
    }
}

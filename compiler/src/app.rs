//! A program compiled for a bundler (spec/11 CP-4b): every module of the program `entry` starts, through Solid's
//! compiler for `target`, each importing its dependencies by `.rx` path, with the program's stylesheet. What `rxc app`
//! prints and the Node-API build (`src/node.rs`) returns to `@reactivescript/compiler/vite`.
use crate::check::{check_modules, check_modules_in};
use crate::emit::{compile_dev, lower_view, Target};
use crate::model::module_key;
use crate::modules::load_modules;
use serde_json::{json, Map, Value};
use std::path::Path;

pub fn read_disk(p: &str) -> Option<String> {
    if Path::new(p).is_file() {
        std::fs::read_to_string(p).ok()
    } else {
        None
    }
}

pub fn target(name: &str) -> Target {
    match name {
        "ssr" => Target::Ssr,
        "universal" => Target::Universal,
        _ => Target::Dom,
    }
}

/// `{entry, css, modules: {path: {code, map, css}}}` (the program's stylesheet, and each module's own), or `{diagnostics: [...]}` / `{error}`. `entry` is an absolute path.
/// `spa`: a client-only build, checked under 08 CN-3d.
pub fn app(entry: &str, target: Target, module_name: &str, spa: bool) -> Value {
    app_dev(entry, target, module_name, spa, None)
}

/// `app`, for a dev build when `dev` is set: each source's and equation's creating calls run under its key
/// (`emit::compile_dev`); `dev` is the project root the keys' modules are relative to.
pub fn app_dev(entry: &str, target: Target, module_name: &str, spa: bool, dev: Option<&str>) -> Value {
    // module keys are POSIX paths (`modules::join_path`); Windows takes `D:/a/b.rx` as it takes `D:\a\b.rx`
    let entry = &entry.replace('\\', "/");
    (|| {
        if read_disk(entry).is_none() {
            return Err(json!({ "error": format!("{entry}: no such file") }));
        }
        let set = load_modules(entry, &read_disk).map_err(|e| {
            // a parse error is a diagnostic like the checker's, with its code (PARSE, or the habit it names)
            let file = e.2.clone().unwrap_or_else(|| entry.to_string());
            let mut d = crate::serve::parse_error_in(&file, &e, read_disk(&file).as_deref());
            d["msg"] = json!(crate::serve::parse_message(&e));
            json!({ "diagnostics": [d] })
        })?;
        let checked = check_modules(&set, spa);
        if !checked.diags.is_empty() {
            return Err(json!({ "diagnostics": checked.diags.iter().map(|d| { let mut j = d.to_json(); if j["file"].is_null() { j["file"] = json!(set.entry); } j }).collect::<Vec<_>>() }));
        }
        let out = compile_dev(&set, &[], true, dev).map_err(|e| json!({ "error": format!("{entry}: not compiled: {}", e.0) }))?;
        let mut modules = Map::new();
        for (name, module) in &out.files {
            let path = &out.paths[name];
            let text = read_disk(path).unwrap_or_default();
            let l = lower_view(module, path, target, module_name, Some((path, &text))).map_err(|e| json!({ "error": e }))?;
            modules.insert(path.clone(), json!({ "code": l.code, "map": l.map, "css": out.module_css[name] }));
        }
        Ok(json!({ "entry": set.entry, "css": out.css, "modules": modules }))
    })()
    .unwrap_or_else(|e| e)
}

/// `rxc model`'s answer for the programs `entries` start (absolute paths): each module's resolved model (CP-6) once, in
/// load order, its `file` and its symbols' keys relative to `root`. `{error}` when an entry does not load.
pub fn model(entries: &[String], root: &str) -> Value {
    let mut out: Vec<Value> = vec![];
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let entry = entry.replace('\\', "/");
        let set = match load_modules(&entry, &read_disk) {
            Ok(s) => s,
            Err(e) => return json!({ "error": e.0 }),
        };
        let checked = check_modules_in(&set, false, Some(root));
        for p in &set.order {
            if !seen.insert(p.clone()) {
                continue;
            }
            let mut m = checked.models[p].clone();
            m["file"] = json!(module_key(p, Some(root)));
            out.push(m);
        }
    }
    Value::Array(out)
}

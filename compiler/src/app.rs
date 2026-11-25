//! A program compiled for a bundler (spec/11 CP-4b): every module of the program `entry` starts, through Solid's
//! compiler for `target`, each importing its dependencies by `.rx` path, with the program's stylesheet. What `rxc app`
//! prints and the Node-API build (`src/node.rs`) returns to `@reactivescript/compiler/vite`.
use crate::check::{check_modules, check_modules_in};
use crate::emit::{lower_view, Target};
use crate::model::module_key;
use crate::modules::load_modules;
use serde_json::{json, Map, Value};
use std::path::Path;

/// A file's text, or for `rx-dts:<stem>` (09 MO-11d) the generated declaration's record, from the generator (`read_dts`).
pub fn read_disk(p: &str) -> Option<String> {
    if let Some(stem) = p.strip_prefix(crate::modules::DTS_KEY) {
        return read_dts(stem);
    }
    if Path::new(p).is_file() {
        std::fs::read_to_string(p).ok()
    } else {
        None
    }
}

/// MO-11d: the record (JSON) `rx-dts --record <stem>` prints — `$RX_DTS` (a command line, split on spaces) if set, else the
/// nearest `node_modules/.bin/rx-dts` up from the stem's directory. `None` when there is nothing to run, it fails, or it
/// answers `null`. Once per stem per process (the command keeps its own cache, fresh while the files it read are unchanged).
pub fn read_dts(stem: &str) -> Option<String> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    static MEMO: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
    if let Some(hit) = MEMO.lock().ok().and_then(|m| m.get(stem).cloned()) {
        return hit;
    }
    let got = spawn_dts(stem);
    if let Ok(mut m) = MEMO.lock() {
        m.insert(stem.to_string(), got.clone());
    }
    got
}
#[cfg(not(target_arch = "wasm32"))]
fn spawn_dts(stem: &str) -> Option<String> {
    let mut cmd: Vec<String> = match std::env::var("RX_DTS") {
        Ok(v) if !v.trim().is_empty() => v.split_whitespace().map(String::from).collect(),
        _ => {
            let mut dir = Path::new(stem).parent();
            let mut found = None;
            while let Some(d) = dir {
                let bin = d.join("node_modules").join(".bin");
                let hit = [if cfg!(windows) { "rx-dts.cmd" } else { "rx-dts" }, "rx-dts"].iter().map(|n| bin.join(n)).find(|p| p.is_file());
                if let Some(p) = hit {
                    found = Some(p.to_string_lossy().into_owned());
                    break;
                }
                dir = d.parent();
            }
            vec![found?]
        }
    };
    cmd.push("--record".into());
    cmd.push(stem.to_string());
    let out = std::process::Command::new(&cmd[0]).args(&cmd[1..]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::inherit()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8(out.stdout).ok()?;
    let text = text.trim();
    if text.is_empty() || text == "null" {
        return None;
    }
    Some(text.to_string())
}
#[cfg(target_arch = "wasm32")]
fn spawn_dts(_stem: &str) -> Option<String> {
    None
}

pub fn target(name: &str) -> Target {
    match name {
        "ssr" => Target::Ssr,
        "universal" => Target::Universal,
        _ => Target::Dom,
    }
}

/// `{entry, css, modules: {path: {code, map, css}}}`, or `{diagnostics: [...]}` / `{error}`. `entry` is an absolute path.
/// `spa`: a client-only build, checked under 08 CN-3d.
pub fn app(entry: &str, target: Target, module_name: &str, spa: bool) -> Value {
    app_dev(entry, target, module_name, spa, None)
}

/// `app`, for a dev build when `dev` is set: each source's and equation's creating calls run under its key
/// (`emit::compile_dev`); `dev` is the project root the keys' modules are relative to.
pub fn app_dev(entry: &str, target: Target, module_name: &str, spa: bool, dev: Option<&str>) -> Value {
    app_hot(entry, target, module_name, spa, dev, false)
}

pub(crate) fn app_hot(entry: &str, target: Target, module_name: &str, spa: bool, dev: Option<&str>, hot: bool) -> Value {
    app_hot_with(entry, target, module_name, spa, dev, hot, &read_disk)
}

/// `app_hot` over `read` (a host's files, and its answers at `rx-dts:` keys, MO-11d).
pub fn app_hot_with(entry: &str, target: Target, module_name: &str, spa: bool, dev: Option<&str>, hot: bool, read: &dyn Fn(&str) -> Option<String>) -> Value {
    let hot = hot && dev.is_some();
    // module keys are POSIX paths (`modules::join_path`); Windows takes `D:/a/b.rx` as it takes `D:\a\b.rx`
    let entry = &entry.replace('\\', "/");
    (|| {
        if read(entry).is_none() {
            return Err(json!({ "error": format!("{entry}: no such file") }));
        }
        let set = load_modules(entry, read).map_err(|e| {
            // a parse error is a diagnostic like the checker's, with its code (PARSE, or the habit it names)
            let file = e.2.clone().unwrap_or_else(|| entry.to_string());
            let mut d = crate::serve::parse_error_in(&file, &e, read(&file).as_deref());
            d["msg"] = json!(crate::serve::parse_message(&e));
            json!({ "diagnostics": [d] })
        })?;
        let checked = check_modules(&set, spa);
        let with_file = |mut j: Value| {
            if j["file"].is_null() {
                j["file"] = json!(set.entry);
            }
            j
        };
        if !checked.diags.is_empty() {
            return Err(json!({ "diagnostics": checked.diags.iter().map(|d| with_file(d.to_json())).collect::<Vec<_>>() }));
        }
        let out = crate::emit::compile_with_hot(&set, &[], true, dev, None, hot).map_err(|e| json!({ "error": format!("{entry}: not compiled: {}", e.0) }))?;
        let mut modules = Map::new();
        for (name, module) in &out.files {
            let path = &out.paths[name];
            let text = read(path).unwrap_or_default();
            let mut l = lower_view(module, path, target, module_name, Some((path, &text))).map_err(|e| json!({ "error": e }))?;
            if hot && path == &set.entry {
                // The frontend supplies the serialized plan and optional observer, not the entry's implementation.
                l.code.push_str("\nimport { hotEntry as __rxHot } from \"@reactivescript/compiler/hot\";\n\
                    const __rxEntry = __rxHot(__rxPayload, main, import.meta.hot, __rxObserver);\n\
                    export default __rxEntry.main;\n\
                    export const __rxReplacement = __rxEntry.replacement;\n\
                    if (import.meta.hot) import.meta.hot.accept(next => __rxEntry.accept(next?.__rxReplacement));\n");
            }
            modules.insert(path.clone(), json!({ "code": l.code, "map": l.map, "css": out.module_css[name] }));
        }
        let mut result = json!({ "entry": set.entry, "css": out.css, "modules": modules });
        if dev.is_some() {
            result["declarations"] = json!(set.declarations.keys().collect::<Vec<_>>());
        }
        Ok(result)
    })()
    .unwrap_or_else(|e| e)
}

/// `rxc model`'s answer for the programs `entries` start (absolute paths): each module's resolved model (CP-6) once, in
/// load order, its `file` and its symbols' keys relative to `root`. `{error}` when an entry does not load.
pub fn model(entries: &[String], root: &str) -> Value {
    model_with(entries, root, &read_disk)
}
/// `model` over `read` (a host's files, and its answers at `rx-dts:` keys, MO-11d).
pub fn model_with(entries: &[String], root: &str, read: &dyn Fn(&str) -> Option<String>) -> Value {
    let mut out: Vec<Value> = vec![];
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let entry = entry.replace('\\', "/");
        let set = match load_modules(&entry, read) {
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

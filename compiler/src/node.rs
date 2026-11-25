//! The Node-API build (`--features node`): the crate in process for `@reactivescript/compiler` and its Vite front end
//! (`vite.mjs`), in place of spawning `rxc app`.
use napi::bindgen_prelude::Function;
use napi_derive::napi;

/// The files on disk, and at `rx-dts:<stem>` (09 MO-11d) `declare`'s answer when it gives one, else `read_disk`'s (which
/// runs `rx-dts`).
fn reader<'f>(declare: &'f Option<Function<'_, String, Option<String>>>) -> impl Fn(&str) -> Option<String> + 'f {
    move |p: &str| {
        if let (Some(stem), Some(f)) = (p.strip_prefix(crate::modules::DTS_KEY), declare.as_ref()) {
            if let Ok(Some(text)) = f.call(stem.to_string()) {
                if text != "null" {
                    return Some(text);
                }
            }
        }
        crate::app::read_disk(p)
    }
}

/// `rxc app`'s answer, as JSON text: the program `entry` (an absolute path) starts, for `target` (dom, ssr or
/// universal; dom by default) over `module_name` (`@solidjs/web` by default). `spa`: a client-only build (dom, not
/// hydratable), checked under 08 CN-3d. `dev`: a dev build — each source's and equation's creating calls run under its
/// key (`__rt.key`), its module relative to `root` (the process's cwd by default). `declare(stem)`: the generated
/// declaration's record for a TS module's stem, as JSON, or `null` (09 MO-11d); without it, `rx-dts` is run.
#[napi]
pub fn app(entry: String, target: Option<String>, module_name: Option<String>, spa: Option<bool>, dev: Option<bool>, root: Option<String>, hot: Option<bool>, declare: Option<Function<String, Option<String>>>) -> String {
    let target = crate::app::target(target.as_deref().unwrap_or("dom"));
    let root = dev.unwrap_or(false).then(|| root.unwrap_or_else(cwd));
    let read = reader(&declare);
    crate::app::app_hot_with(&entry, target, module_name.as_deref().unwrap_or("@solidjs/web"), spa.unwrap_or(false), root.as_deref(), hot.unwrap_or(false), &read).to_string()
}

/// `rxc model`'s answer, as JSON text: the resolved model (CP-6) of every module the programs `entries` (absolute paths)
/// start, each once, with module paths and keys relative to `root` (the process's cwd by default). `declare`: as `app`'s.
#[napi]
pub fn model(entries: Vec<String>, root: Option<String>, declare: Option<Function<String, Option<String>>>) -> String {
    let read = reader(&declare);
    crate::app::model_with(&entries, &root.unwrap_or_else(cwd), &read).to_string()
}

fn cwd() -> String {
    std::env::current_dir().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

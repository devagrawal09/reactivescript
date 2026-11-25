//! The Node-API build (`--features node`): the crate in process for `@reactivescript/compiler` and its Vite front end
//! (`vite.mjs`), in place of spawning `rxc app`.
use napi_derive::napi;

/// `rxc app`'s answer, as JSON text: the program `entry` (an absolute path) starts, for `target` (dom, ssr or
/// universal; dom by default) over `module_name` (`@solidjs/web` by default). `spa`: a client-only build (dom, not
/// hydratable), checked under 08 CN-3d. `dev`: a dev build — each source's and equation's creating calls run under its
/// key (`__rt.key`), its module relative to `root` (the process's cwd by default).
#[napi]
pub fn app(entry: String, target: Option<String>, module_name: Option<String>, spa: Option<bool>, dev: Option<bool>, root: Option<String>, hot: Option<bool>) -> String {
    let target = crate::app::target(target.as_deref().unwrap_or("dom"));
    let root = dev.unwrap_or(false).then(|| root.unwrap_or_else(cwd));
    crate::app::app_hot(&entry, target, module_name.as_deref().unwrap_or("@solidjs/web"), spa.unwrap_or(false), root.as_deref(), hot.unwrap_or(false)).to_string()
}

/// `rxc model`'s answer, as JSON text: the resolved model (CP-6) of every module the programs `entries` (absolute paths)
/// start, each once, with module paths and keys relative to `root` (the process's cwd by default).
#[napi]
pub fn model(entries: Vec<String>, root: Option<String>) -> String {
    crate::app::model(&entries, &root.unwrap_or_else(cwd)).to_string()
}

fn cwd() -> String {
    std::env::current_dir().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

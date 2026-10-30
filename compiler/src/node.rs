//! The Node-API build (`--features node`): the crate in process for `@reactivescript/compiler` and its Vite front end
//! (`vite.mjs`), in place of spawning `rxc app`.
use napi_derive::napi;

/// `rxc app`'s answer, as JSON text: the program `entry` (an absolute path) starts, for `target` (dom, ssr or
/// universal; dom by default) over `module_name` (`@solidjs/web` by default). `spa`: a client-only build (dom, not
/// hydratable), checked under 08 CN-3d.
#[napi]
pub fn app(entry: String, target: Option<String>, module_name: Option<String>, spa: Option<bool>) -> String {
    let target = crate::app::target(target.as_deref().unwrap_or("dom"));
    crate::app::app(&entry, target, module_name.as_deref().unwrap_or("@solidjs/web"), spa.unwrap_or(false)).to_string()
}

//! `@solidjs/web`'s server runtime (web/src/server.ts) as a synchronous
//! `renderToString` of a plan app runs it: `ssr()` template assembly,
//! `escape`, the hole and tree resolvers, hydration keys, and the render
//! itself.
//!
//! Not ported, because `renderToString` of a plan app never reaches them:
//! live holes (`sharedConfig.context.liveHoles` is only set by frame
//! renders, so every `live` branch of `ssr()` is dead), group holes (`$g`,
//! emitted only for attribute groups; plans have no attributes), async
//! escalation (`{ t, h, p }` results, `buildAsyncWrap`: nothing suspends),
//! attribute escaping, `ssrElement`/`ssrAttribute`/class and style
//! serializers, link claims (no anchor has an `href`), `<select>` value
//! resolution (never activated: plans have no `value` attributes), the
//! hydration serializer (no async data is serialized; it writes nothing),
//! head and asset tracking (nothing registers a head tag or an asset), and
//! the trace context (`traceFor`, whose meta tag only reaches a document
//! with a `</head>`, which a plan app never renders: `head` is refused).
use super::owner::OwnerId;
use super::value::{call, throw, JsFn, JsVal, Res};
use super::Server;
use std::rc::Rc;

// Solid: server.ts:5645-5681 (`escape`, content position: `attr` false).
pub fn escape(v: &JsVal) -> JsVal {
    match v {
        JsVal::Str(s) => {
            let e = escape_str(s);
            if e.as_str() == &**s {
                v.clone()
            } else {
                JsVal::str(&e)
            }
        }
        JsVal::Arr(a) => {
            if let Some(joined) = try_join_plain_ssr_array(&a.borrow()) {
                return JsVal::str(&joined);
            }
            // `s.slice()` and escape each item (no double escaping of the
            // original).
            let copy: Vec<JsVal> = a.borrow().iter().map(escape).collect();
            JsVal::array(copy)
        }
        JsVal::Fn(f) => escape_late(f),
        other => other.clone(),
    }
}

/// `escape`'s string paths (`ESCAPE_CONTENT = /[&<]/`, `escapeSlow`): `&` to
/// `&amp;` and `<` to `&lt;`, one left-to-right pass.
// Solid: server.ts:5664-5681, 5730-5769 (`escape`'s fast path and `escapeSlow`)
pub fn escape_str(s: &str) -> String {
    if !s.contains(['&', '<']) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '&' => out.push_str("&amp;"),
            c => out.push(c),
        }
    }
    out
}

// Solid: server.ts:5704-5718 (`escapeLate`): a function at a content hole is
// escaped when the resolver calls it.
fn escape_late(f: &Rc<JsFn>) -> JsVal {
    if f.esc {
        return JsVal::Fn(f.clone());
    }
    let inner = JsVal::Fn(f.clone());
    JsVal::Fn(Rc::new(JsFn {
        arity: 0,
        esc: true,
        body: Box::new(move |s, _| Ok(escape(&call(s, &inner, &[])?))),
    }))
}

// Solid: server.ts:5810-5821 (`tryJoinPlainSSRArray`)
fn try_join_plain_ssr_array(nodes: &[JsVal]) -> Option<String> {
    if nodes.is_empty() {
        return None;
    }
    let mut out = String::new();
    for node in nodes {
        match node {
            JsVal::Tmpl(t) => out.push_str(t),
            _ => return None,
        }
    }
    Some(out)
}

// Solid: server.ts:3805-3817 (`tryResolveFunctionHole`). A throw is not a
// `NotReadyError` on a plan app's path: `buildAsyncWrap` → `ssrHandleError`
// rethrows it (no `<Errored>` above).
fn try_resolve_function_hole(s: &mut Server, hole: &JsVal) -> Res<String> {
    let value = call(s, hole, &[])?;
    Ok(match value {
        JsVal::Str(v) => v.to_string(),
        JsVal::Num(n) => n.to_string(),
        JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => String::new(),
        other => try_resolve_string(s, &other, false)?,
    })
}

const TEXT_SEPARATOR: &str = "<!--!$-->";

// Solid: server.ts:6231-6280 (`tryResolveString`). Adjacent text values are
// separated by `<!--!$-->` (`ssrTextTail`), which the client's hydration
// walk counts as a text boundary.
fn try_resolve_string(s: &mut Server, node: &JsVal, nested: bool) -> Res<String> {
    if !nested {
        s.ssr_text_tail = false;
    }
    match node {
        JsVal::Str(_) | JsVal::Num(_) => {
            let text = match node {
                JsVal::Str(v) => v.to_string(),
                JsVal::Num(n) => n.to_string(),
                _ => unreachable!(),
            };
            let out = if s.ssr_text_tail {
                format!("{TEXT_SEPARATOR}{text}")
            } else {
                text
            };
            s.ssr_text_tail = true;
            Ok(out)
        }
        JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => Ok(String::new()),
        JsVal::Arr(a) => {
            let items = a.borrow().clone();
            if let Some(joined) = try_join_plain_ssr_array(&items) {
                s.ssr_text_tail = false;
                return Ok(joined);
            }
            let mut out = String::new();
            for item in &items {
                out.push_str(&try_resolve_string(s, item, true)?);
            }
            Ok(out)
        }
        JsVal::Tmpl(t) => {
            s.ssr_text_tail = false;
            Ok(t.to_string())
        }
        // Not a template object: the dev build warns and skips it.
        JsVal::Rec(_) => Ok(String::new()),
        JsVal::Fn(_) => {
            let v = call(s, node, &[])?;
            try_resolve_string(s, &v, true)
        }
    }
}

// Solid: server.ts:4742-5005 (`ssr`), the path with no live holes and no
// groups: strings and numbers are appended, nullish and booleans skipped,
// functions resolved through `tryResolveFunctionHole`, anything else through
// `tryResolveString`. A template with no holes is returned as is (`{ t }`).
pub fn ssr(s: &mut Server, template: &[String], holes: &[JsVal]) -> Res<JsVal> {
    if holes.is_empty() {
        // `if (len === 1) return { t }`: `t` is the template itself; the
        // resolvers read `t[0]` of an array template.
        return Ok(JsVal::Tmpl(Rc::from(template[0].as_str())));
    }
    if template.len() != holes.len() + 1 {
        return throw("ssr: a template has one more part than it has holes");
    }
    let mut out = template[0].clone();
    for (i, hole) in holes.iter().enumerate() {
        match hole {
            JsVal::Str(v) => out.push_str(v),
            JsVal::Num(n) => out.push_str(&n.to_string()),
            JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => {}
            JsVal::Fn(_) => out.push_str(&try_resolve_function_hole(s, hole)?),
            other => out.push_str(&try_resolve_string(s, other, false)?),
        }
        out.push_str(&template[i + 1]);
    }
    Ok(JsVal::Tmpl(Rc::from(out.as_str())))
}

// Solid: server.ts:6285-6362 (`resolveSSRNode`), synchronous: `result.t`
// stays one string.
fn resolve_ssr_node(
    s: &mut Server,
    node: &JsVal,
    result: &mut String,
    top: bool,
    nested: bool,
) -> Res<()> {
    if !nested {
        s.ssr_text_tail = false;
    }
    match node {
        JsVal::Str(_) | JsVal::Num(_) => {
            let text = match node {
                JsVal::Str(v) => v.to_string(),
                JsVal::Num(n) => n.to_string(),
                _ => unreachable!(),
            };
            if s.ssr_text_tail {
                result.push_str(TEXT_SEPARATOR);
            }
            result.push_str(&text);
            s.ssr_text_tail = true;
        }
        JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => {}
        JsVal::Arr(a) => {
            let items = a.borrow().clone();
            for item in &items {
                if top {
                    s.ssr_text_tail = false;
                }
                resolve_ssr_node(s, item, result, false, true)?;
            }
        }
        JsVal::Tmpl(t) => {
            result.push_str(t);
            s.ssr_text_tail = false;
        }
        // An object that is not a template: the dev build warns.
        JsVal::Rec(_) => {}
        JsVal::Fn(_) => {
            let v = call(s, node, &[])?;
            resolve_ssr_node(s, &v, result, false, true)?;
        }
    }
    Ok(())
}

// Solid: server.ts:6376-6380 (`resolveSSRSync`)
fn resolve_ssr_sync(s: &mut Server, node: &JsVal) -> Res<String> {
    let mut result = String::new();
    resolve_ssr_node(s, node, &mut result, false, false)?;
    Ok(result)
}

impl Server {
    // Solid: solid/src/server/shared.ts:207-213 (`getNextContextId`). No plan
    // app sets `NoHydrateContext`, so its default (`false`) is read.
    pub fn get_next_context_id(&mut self) -> Res<Option<String>> {
        let Some(o) = self.get_owner() else {
            return throw("getNextContextId cannot be used under non-hydrating context");
        };
        self.get_next_child_id(o).map(Some)
    }
}

// Solid: server.ts:5822-5827 (`getHydrationKey`)
pub fn get_hydration_key(s: &mut Server) -> Res<Option<String>> {
    if !s.context {
        return Ok(None);
    }
    s.get_next_context_id()
}

// Solid: server.ts:5394-5397 (`ssrHydrationKey`)
pub fn ssr_hydration_key(s: &mut Server) -> Res<JsVal> {
    Ok(JsVal::str(&match get_hydration_key(s)? {
        Some(hk) if !hk.is_empty() => format!(" _hk={hk}"),
        _ => String::new(),
    }))
}

// Solid: server.ts:1791-1957 (`renderToString`), for a render with no
// request event, no nonce, no manifest and no `onHead`: the root owner takes
// `renderId` as its id, the code's result is escaped and resolved
// synchronously, and the document is assembled. With nothing registered for
// the head, nothing serialized and no bootstrap, `assembleDocument` and
// `withShellEnd` return the HTML unchanged (server.ts:5900-5906, 5931-6007); a render
// whose HTML has a `</head>` or the `<!--xs-->` marker is refused, because
// those splices are not ported. The root is disposed before returning.
pub fn render_to_string(
    s: &mut Server,
    render_id: &str,
    code: impl FnOnce(&mut Server) -> Res<JsVal>,
) -> Res<String> {
    s.context = true;
    let mut root: Option<OwnerId> = None;
    let html = s.create_root(Some(render_id.to_string()), |s, owner| {
        root = Some(owner);
        // `claimRenderRoot`: files the root for `getRequestEvent`-style
        // lookups and drops it on dispose; nothing a plan app reads.
        s.on_cleanup(Rc::new(|_| {}));
        let v = code(s)?;
        let escaped = escape(&v);
        resolve_ssr_sync(s, &escaped)
    });
    let result = html.and_then(|html| {
        if html.contains("</head>") || html.contains("<!--xs-->") {
            return throw("a document shell (</head>, <!--xs-->) is not ported");
        }
        Ok(html)
    });
    if let Some(root) = root {
        let disposed = s.dispose_owner(root, true);
        if result.is_ok() {
            disposed?;
        }
    }
    result
}

// Solid: server.ts:5846-5848, 5855-5861 (`generateHydrationScript`, `hydrationBootstrap`
// with no nonce and no ledger)
pub fn generate_hydration_script(event_names: &[&str]) -> String {
    let names = if event_names.is_empty() {
        vec!["click", "input"]
    } else {
        event_names.to_vec()
    };
    format!(
        "<script>window._$HY||(e=>{{let t=e=>e&&e.hasAttribute&&(e.hasAttribute(\"_hk\")?e:t(e.host&&e.host.nodeType?e.host:e.parentNode));[\"{}\"].forEach((o=>document.addEventListener(o,(o=>{{if(!e.events)return;let s=t(o.composedPath&&o.composedPath()[0]||o.target);s&&!e.completed.has(s)&&e.events.push([s,o])}}))))}})(_$HY={{events:[],completed:new WeakSet,r:new Proxy({{}},{{set:(r,k,v)=>(v instanceof Promise&&v.catch(()=>{{}}),r[k]=v,!0)}}),fe(){{}}}});</script><!--xs-->",
        names.join("\",\"")
    )
}

#[cfg(test)]
mod tests {
    use super::escape_str;

    #[test]
    fn content_escaping_is_solids() {
        assert_eq!(escape_str("a"), "a");
        assert_eq!(escape_str("a<b&c>d\"e"), "a&lt;b&amp;c>d\"e");
        assert_eq!(escape_str("&&<<"), "&amp;&amp;&lt;&lt;");
    }
}

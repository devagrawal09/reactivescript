//! Slice 5, async data (crate::ssr, docs/SSR.md "Async data and streaming"):
//! the server renderer against Solid's own `renderToStream` and
//! `renderToString` of plan v2.1 apps. The fixtures in `fixtures/ssr-async/`
//! are written by the frontend's `scripts/ssr-corpus.ts --async`: the
//! tracker-async slice under four server answer scripts, and generated v2.1
//! programs under the SSR fuzz's server chooser. Each holds the plan, the
//! answers Solid's render realized, Solid's stream event log (every chunk, the
//! settlements, the end), and its renderToString HTML and requests.
//! Hydration is the frontend's oracle (`ssr/ssr-async.test.ts`, Chromium);
//! here only the bytes are checked, without Node.
use rust_solid::plan_v2::Plan;
use rust_solid::ssr::plan::{render_stream, render_string, ServerAnswer};
use rust_solid::ssr::stream::StreamEvent;
use serde_json::{json, Value as J};

fn fixtures() -> Vec<(String, J)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ssr-async");
    let mut out = std::fs::read_dir(dir)
        .expect("the async ssr fixtures")
        .map(|e| e.expect("an entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| {
            let text = std::fs::read_to_string(&p).expect("readable");
            (
                p.file_name().unwrap().to_string_lossy().into_owned(),
                serde_json::from_str::<J>(&text).expect("JSON"),
            )
        })
        .collect::<Vec<_>>();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn plan(v: &J) -> Plan {
    serde_json::from_value(v.clone()).expect("a plan")
}

fn answers(v: &J) -> Vec<ServerAnswer> {
    serde_json::from_value(v.clone()).expect("answers")
}

/// The event log as the frontend writes it: `{chunk}`, `{settle}`, `{end}`.
fn events_json(events: &[StreamEvent]) -> J {
    J::Array(
        events
            .iter()
            .map(|e| match e {
                StreamEvent::Chunk(c) => json!({ "chunk": c }),
                StreamEvent::Settle(s) => json!({ "settle": s }),
                StreamEvent::End => json!({ "end": true }),
            })
            .collect(),
    )
}

#[test]
fn the_async_corpus_streams_as_solid_streams_it() {
    let all = fixtures();
    assert!(all.len() >= 14, "{} fixtures", all.len());
    for (name, f) in &all {
        let r = render_stream(&plan(&f["plan"]), &answers(&f["answers"]))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(events_json(&r.events), f["events"], "{name}");
        let requests: Vec<J> = f["answers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| json!({ "host": a["host"], "call": a["call"], "args": a["args"] }))
            .collect();
        assert_eq!(json!(r.requests), J::Array(requests), "{name}");
        assert!(r.render_errors.is_empty(), "{name}: {:?}", r.render_errors);
    }
}

#[test]
fn render_to_string_of_the_async_corpus_is_solids() {
    for (name, f) in &fixtures() {
        let r = render_string(&plan(&f["plan"])).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(r.html, f["html"].as_str().expect("html"), "{name}");
        assert_eq!(json!(r.requests), f["requests"], "{name}");
    }
}

#[test]
fn the_async_corpus_covers_the_stream_forms() {
    let all = fixtures();
    let streams: String = all
        .iter()
        .flat_map(|(_, f)| f["events"].as_array().unwrap().clone())
        .filter_map(|e| e["chunk"].as_str().map(str::to_string))
        .collect();
    let htmls: String = all
        .iter()
        .map(|(_, f)| f["html"].as_str().unwrap().to_string())
        .collect();
    for form in [
        "<template id=\"pl-",
        "\" e>",
        "$df(\"",
        "_$HY.r[\"",
        "_fr\"]=",
        "new Error(\"Internal Server Error\")",
        "resolver.s(data)",
        "resolver.f(data)",
        "&#8230;",
    ] {
        assert!(streams.contains(form), "no fixture streams {form}");
    }
    assert!(htmls.contains("\"$$f\""), "no fixture renders a $$f marker");
    let plans =
        serde_json::to_string(&all.iter().map(|(_, f)| &f["plan"]).collect::<Vec<_>>()).unwrap();
    for kind in [
        "\"kind\":\"loading\"",
        "\"kind\":\"errored\"",
        "\"op\":\"pending\"",
        "\"op\":\"latest\"",
        "\"await\":{",
    ] {
        assert!(plans.contains(kind), "no fixture has {kind}");
    }
    let multi = all.iter().any(|(_, f)| {
        f["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e.get("chunk").is_some())
            .count()
            >= 3
    });
    assert!(multi, "no fixture streams three chunks or more");
    let unsettled = all.iter().any(|(_, f)| {
        f["answers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["mode"] == "idle" && a.get("at").is_none())
    });
    assert!(unsettled, "no fixture leaves an idle answer unsettled");
}

/// The tracker-async fixture under a script.
fn tracker(script: &str) -> J {
    fixtures()
        .into_iter()
        .find(|(n, _)| n == &format!("tracker-async-{script}.json"))
        .expect("the tracker-async fixture")
        .1
}

#[test]
fn tracker_async_streams_its_fallback_then_its_content_or_its_failure() {
    let idle = tracker("idle");
    let ev = idle["events"].as_array().unwrap();
    // The shell (the Loading fallback in its placeholder, the serialized
    // pending memo and fragment), the settlement, the content's template and
    // its swap, the end.
    assert_eq!(ev.len(), 4, "{ev:?}");
    let shell = ev[0]["chunk"].as_str().unwrap();
    assert!(shell.starts_with("<section _hk=1><!--$--><template id=\"pl-200\"></template><i _hk=2000>Loading issues&#8230;</i><!--pl-200--><!--/--><em></em></section><script>"));
    assert_eq!(ev[1], json!({ "settle": "loadIssues#1" }));
    assert!(ev[2]["chunk"]
        .as_str()
        .unwrap()
        .starts_with("<template id=\"200\"><b _hk=200000>ready</b>"));
    assert_eq!(ev[3], json!({ "end": true }));
    // Answered before the shell, the content is inlined: one chunk.
    let now = tracker("now");
    assert_eq!(now["events"].as_array().unwrap().len(), 2);
    // A rejected load streams the Errored fallback as the fragment's
    // outcome, marked `e`, with the sanitized error under the boundary's id.
    let rej = tracker("idle-reject");
    let failed = rej["events"][2]["chunk"].as_str().unwrap();
    assert!(failed.starts_with("<template id=\"200\" e><p _hk=30>Could not load issues<button>retry</button></p></template>"));
    assert!(failed.contains("_$HY.r[\"2\"]=$R[5]"));
    for f in [&idle, &now, &rej, &tracker("now-reject")] {
        let r = render_stream(&plan(&f["plan"]), &answers(&f["answers"])).unwrap();
        assert_eq!(events_json(&r.events), f["events"]);
    }
}

#[test]
fn an_answer_script_that_does_not_fit_the_render_is_refused() {
    let f = tracker("idle");
    let p = plan(&f["plan"]);
    let value = f["answers"][0]["value"].clone();
    let script = |a: J| -> Vec<ServerAnswer> { serde_json::from_value(a).unwrap() };
    let cases: Vec<(Vec<ServerAnswer>, &str)> = vec![
        (script(json!([])), "no server answer for loadIssues#1"),
        (
            script(
                json!([{ "host": "loadIssues", "call": 1, "args": [7], "mode": "now", "value": value }]),
            ),
            "was called with [], the script answers [7]",
        ),
        (
            script(
                json!([{ "host": "loadIssues", "call": 2, "args": [], "mode": "idle", "at": 0, "value": value }]),
            ),
            "no server answer for loadIssues#1",
        ),
        (
            script(json!([
                { "host": "loadIssues", "call": 1, "args": [], "mode": "now", "value": value },
                { "host": "loadIssues", "call": 2, "args": [], "mode": "now", "value": value }
            ])),
            "the script answers loadIssues#2, which the render never asked",
        ),
        (
            script(
                json!([{ "host": "loadIssues", "call": 1, "args": [], "mode": "now", "value": [{ "id": 1 }] }]),
            ),
            "does not conform",
        ),
        (
            script(
                json!([{ "host": "loadIssues", "call": 1, "args": [], "mode": "idle", "at": 0 }]),
            ),
            "needs exactly one of value and error",
        ),
    ];
    for (answers, want) in cases {
        let e = match render_stream(&p, &answers) {
            Ok(_) => panic!("{want}: rendered"),
            Err(e) => e,
        };
        assert!(e.contains(want), "{e} / {want}");
    }
}

#[test]
fn an_async_read_outside_every_loading_is_refused() {
    // `<em>{issues().length}</em>` at the top: a root hole, which
    // renderToStream would retry before its shell (not ported).
    let mut p = tracker("idle")["plan"].clone();
    p["markup"][0]["children"][1]["children"] = json!([{ "kind": "text", "value": { "op": "add",
        "left": { "op": "literal", "value": "" },
        "right": { "op": "length", "array": { "op": "read", "source": "issues" } } } }]);
    let e = match render_stream(&plan(&p), &answers(&tracker("idle")["answers"])) {
        Ok(_) => panic!("rendered"),
        Err(e) => e,
    };
    assert!(e.contains("root hole"), "{e}");
}

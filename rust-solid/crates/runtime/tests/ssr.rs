//! Slice 5: the server renderer (crate::ssr, docs/SSR.md) against Solid's own
//! `renderToString`. The fixtures in `fixtures/ssr/` are written by the
//! frontend's `scripts/ssr-corpus.ts`: each is a plan and the HTML Solid's
//! server build renders for its TSX twin (the tracker and like as their
//! canonical twins). Hydration is the frontend's oracle (`ssr/ssr.test.ts`,
//! Chromium); here only the bytes are checked, without Node.
use rust_solid::plan_v2::Plan;
use rust_solid::ssr::plan::render;
use serde_json::Value as J;

fn fixtures() -> Vec<(String, J)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ssr");
    let mut out = std::fs::read_dir(dir)
        .expect("the ssr fixtures")
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
    serde_json::from_value(v.clone()).expect("a v2 plan")
}

#[test]
fn the_corpus_renders_as_solid_renders_it() {
    let all = fixtures();
    assert!(all.len() >= 13, "{} fixtures", all.len());
    for (name, f) in &all {
        let html = render(&plan(&f["plan"])).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(html, f["html"].as_str().expect("html"), "{name}");
    }
}

#[test]
fn the_corpus_covers_the_server_forms() {
    let all = fixtures();
    let html: String = all
        .iter()
        .map(|(_, f)| f["html"].as_str().unwrap().to_string())
        .collect();
    let plans =
        serde_json::to_string(&all.iter().map(|(_, f)| &f["plan"]).collect::<Vec<_>>()).unwrap();
    for form in ["<!--$-->", "<!--/-->", "<!--!$-->", " _hk="] {
        assert!(html.contains(form), "no fixture renders {form}");
    }
    for kind in [
        "\"kind\": \"show\"",
        "\"kind\": \"for\"",
        "\"op\": \"and\"",
        "\"op\": \"cond\"",
        "\"op\": \"or\"",
    ] {
        assert!(
            plans.replace("\":\"", "\": \"").contains(kind),
            "no fixture plan has {kind}"
        );
    }
    // A Show with and without fallback views, and a For row of two views.
    let mut fallbacks = vec![];
    for (_, f) in &all {
        fn_walk(&f["plan"]["markup"], &mut |x| {
            if x["kind"] == "show" {
                fallbacks.push(x["fallback"].as_array().is_some_and(|a| a.is_empty()));
            }
        });
    }
    assert!(fallbacks.contains(&true) && fallbacks.contains(&false));
    let mut two = false;
    for (_, f) in &all {
        fn_walk(&f["plan"]["markup"], &mut |x| {
            if x["kind"] == "for" && x["children"].as_array().is_some_and(|c| c.len() == 2) {
                two = true;
            }
        });
    }
    assert!(two, "no For row of two views");
}

fn fn_walk(v: &J, f: &mut dyn FnMut(&J)) {
    match v {
        J::Array(a) => a.iter().for_each(|x| fn_walk(x, f)),
        J::Object(o) => {
            f(v);
            o.values().for_each(|x| fn_walk(x, f));
        }
        _ => {}
    }
}

fn section(text: J) -> Plan {
    plan(&serde_json::json!({
        "version": 2, "component": "A", "hosts": [],
        "sources": [
            {"name": "n", "kind": "signal", "seed": {"op": "literal", "value": 2}},
            {"name": "s", "kind": "signal", "seed": {"op": "literal", "value": "a<b&c"}},
            {"name": "f", "kind": "signal", "seed": {"op": "literal", "value": true}}
        ],
        "memos": [], "actions": [],
        "markup": [{"kind": "element", "tag": "section", "events": [], "children": [
            {"kind": "text", "value": text},
            {"kind": "show", "when": {"op": "read", "source": "f"}, "children": [
                {"kind": "element", "tag": "i", "events": [], "children": [{"kind": "text", "value": {"op": "literal", "value": "x"}}]}
            ], "fallback": []}
        ]}]
    }))
}

/// The canonical twin (docs/SSR.md): an integer hole is `{"" + n()}`, which is
/// provably a string and takes no id; a string hole is `{s()}`, scoped
/// (`_$scope`), and takes one, so the Show's ids after it shift by one. Both
/// HTMLs are Solid's for those twins (recorded with `solidServer`).
#[test]
fn an_integer_hole_takes_no_id_and_a_string_hole_takes_one() {
    let int = render(&section(serde_json::json!({"op": "read", "source": "n"}))).unwrap();
    assert_eq!(
        int,
        "<section _hk=0><!--$-->2<!--/--><!--$--><i _hk=30>x</i><!--/--></section>"
    );
    let string = render(&section(serde_json::json!({"op": "read", "source": "s"}))).unwrap();
    assert_eq!(
        string,
        "<section _hk=0><!--$-->a&lt;b&amp;c<!--/--><!--$--><i _hk=40>x</i><!--/--></section>"
    );
}

#[test]
fn refusals_are_diagnostics() {
    let cases = [
        (
            serde_json::json!({"op": "add", "left": {"op": "literal", "value": 1}, "right": {"op": "literal", "value": 2}}),
            "constant value",
        ),
        (
            serde_json::json!({"op": "or",
                "left": {"op": "and", "left": {"op": "read", "source": "s"}, "right": {"op": "read", "source": "s"}},
                "right": {"op": "literal", "value": "z"}}),
            "`&&` on its `||` spine",
        ),
    ];
    for (text, why) in cases {
        let e = render(&section(text)).unwrap_err();
        assert!(e.contains(why), "{e}");
    }
    let static_text =
        |t: &str| render(&section(serde_json::json!({"op": "literal", "value": t}))).unwrap_err();
    for t in ["a & b", "a<b", "a  b", "a\nb", "a\tb", ""] {
        assert!(
            static_text(t).contains("static text"),
            "{t:?}: {}",
            static_text(t)
        );
    }
    let tag = |tag: &str, children: J| {
        render(&plan(&serde_json::json!({
            "version": 2, "component": "A", "hosts": [], "sources": [], "memos": [], "actions": [],
            "markup": [{"kind": "element", "tag": tag, "events": [], "children": children}]
        })))
    };
    assert!(tag(
        "br",
        serde_json::json!([{"kind": "text", "value": {"op": "literal", "value": "x"}}])
    )
    .unwrap_err()
    .contains("void element"));
    assert_eq!(tag("br", serde_json::json!([])).unwrap(), "<br _hk=0>");
    for t in ["head", "script", "style", "html", "body"] {
        assert!(tag(t, serde_json::json!([]))
            .unwrap_err()
            .contains("not ported"));
    }
}

/// A server render evaluates nothing it does not need: actions and handlers
/// never run, and an error in a hole is thrown out of `renderToString`.
#[test]
fn errors_propagate_and_handlers_never_run() {
    let p = section(
        serde_json::json!({"op": "get", "object": {"op": "read", "source": "s"}, "key": "x"}),
    );
    // The type of `s.x` is unknown, so it is refused before rendering.
    assert!(render(&p).unwrap_err().contains("not known statically"));
    let mut v: J = serde_json::from_str(include_str!("fixtures/like.plan-v2.json")).unwrap();
    assert_eq!(render(&plan(&v)).unwrap(), "<button _hk=1>0</button>");
    // A string seed under an integer-typed text: `ToString` of a record is
    // thrown, not rendered.
    v["sources"][0]["seed"] = serde_json::json!({"op": "object", "fields": []});
    v["sources"][1]["seed"] = serde_json::json!({"op": "read", "source": "likes"});
    assert!(render(&plan(&v)).is_err());
}

/// Slices 3 and 5 together: an app with an eval site (the eval slice and the
/// eval fuzz fixtures, `fixtures/eval/`), and every evaluated code's own plan
/// in their tables, are refused before rendering with the eval diagnostic;
/// the live evaluator has no server twin (docs/SSR.md).
#[test]
fn eval_sites_are_refused() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/eval");
    let mut names = std::fs::read_dir(dir)
        .expect("the eval fixtures")
        .map(|e| e.expect("an entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect::<Vec<_>>();
    names.sort();
    assert!(names.len() >= 6, "{} eval fixtures", names.len());
    let (mut apps, mut inner) = (0, 0);
    for p in &names {
        let f: J =
            serde_json::from_str(&std::fs::read_to_string(p).expect("readable")).expect("JSON");
        let err = render(&plan(&f["plan"])).expect_err("an app with an eval site");
        assert!(err.contains("an eval site"), "{}: {err}", p.display());
        apps += 1;
        for e in f["evals"]["evals"].as_array().expect("an eval table") {
            if e["plan"].is_object() {
                let err = render(&plan(&e["plan"])).expect_err("an evaluated code's plan");
                assert!(err.contains("evaluated code"), "{}: {err}", p.display());
                inner += 1;
            }
        }
    }
    assert!(
        apps >= 6 && inner > 0,
        "{apps} apps, {inner} evaluated plans"
    );
}

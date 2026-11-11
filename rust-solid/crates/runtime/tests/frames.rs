//! Slice 6: the frames server (crate::frames, docs/FRAMES.md) against what
//! Solid's own server answered. The fixtures in `fixtures/frames/` are written
//! by the frontend's `scripts/frames-corpus.ts` from runs of the native split
//! (N) on Solid's frames server wiring (`frames/leg-server.ts`): the
//! tracker-frames slice's scenario (plus a request without fetch metadata) and
//! placement-fuzz programs with server roots. Each holds the plan v2.2, the
//! answer script recorded from N's server host log, every request in arrival
//! order with Solid's response (status, headers, body chunks as flushed), N's
//! host log and its document's outermost server calls. The page side is the
//! frontend's oracle (`slices/tracker-frames.test.ts` and the placement fuzz,
//! Chromium); here only the bytes are checked, without Node.
use rust_solid::frames::document;
use rust_solid::frames::hosts::{Answer, Hosts};
use rust_solid::frames::plan::Plan;
use rust_solid::frames::server::{FramesServer, Request, Response};
use serde_json::{json, Value as J};

fn fixtures() -> Vec<(String, J)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/frames");
    let mut out = std::fs::read_dir(dir)
        .expect("the frames fixtures")
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

fn server(f: &J, answers: &J) -> FramesServer {
    let plan = Plan::parse(&f["plan"].to_string()).expect("a v2.2 plan");
    let answers: Vec<Answer> = serde_json::from_value(answers.clone()).expect("answers");
    FramesServer::new(plan, Hosts::new(answers).expect("a well-formed script"))
}

fn request(r: &J) -> Request {
    let headers: Vec<(String, String)> = r["headers"]
        .as_array()
        .expect("headers")
        .iter()
        .map(|h| {
            (
                h[0].as_str().unwrap().to_string(),
                h[1].as_str().unwrap().to_string(),
            )
        })
        .collect();
    let host = headers
        .iter()
        .find(|(k, _)| k == "host")
        .map(|(_, v)| v.clone())
        .expect("a host header");
    Request {
        method: r["method"].as_str().unwrap().into(),
        target: r["target"].as_str().unwrap().into(),
        headers,
        body: r["body"].as_str().unwrap().as_bytes().to_vec(),
        origin: format!("http://{host}"),
    }
}

/// The frames server's answer to one request: the document or the endpoint.
fn answer(s: &FramesServer, req: &Request) -> Result<Response, String> {
    if req.method == "GET" && req.target == "/" {
        document::serve(s, req)
    } else {
        s.handle(req)
    }
}

fn as_json(r: &Response) -> J {
    json!({ "status": r.status, "headers": r.headers.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(), "chunks": r.chunks })
}

#[test]
fn the_frames_corpus_answers_as_solids_server_answered_it() {
    let all = fixtures();
    assert!(all.len() >= 10, "{} fixtures", all.len());
    let (mut exchanges, mut documents, mut streams) = (0, 0, 0);
    for (name, f) in &all {
        let s = server(f, &f["answers"]);
        for (k, x) in f["exchanges"]
            .as_array()
            .expect("exchanges")
            .iter()
            .enumerate()
        {
            let req = request(&x["request"]);
            let got =
                answer(&s, &req).unwrap_or_else(|e| panic!("{name} #{k} {}: {e}", req.target));
            assert_eq!(
                as_json(&got),
                x["response"],
                "{name} #{k}: {} {}",
                req.method,
                req.target
            );
            assert!(
                s.hosts.failure.borrow().is_none(),
                "{name} #{k}: {:?}",
                s.hosts.failure.borrow()
            );
            exchanges += 1;
            if req.target == "/" {
                documents += 1;
            }
            if got.headers.iter().any(|(k, _)| k == "x-frame-stream") {
                streams += 1;
            }
        }
        assert_eq!(
            J::Array(s.hosts.log.borrow().clone()),
            f["hosts"],
            "{name}: the server host log"
        );
        assert_eq!(
            J::Array(s.document_calls.borrow().clone()),
            f["document"],
            "{name}: the document's server calls"
        );
    }
    assert_eq!(documents, all.len(), "every fixture renders its document");
    assert!(streams >= 10, "{streams} frame streams");
    assert!(exchanges >= 50, "{exchanges} exchanges");
}

#[test]
fn the_tracker_frames_corpus_covers_every_response_kind() {
    let f = &fixtures()
        .into_iter()
        .find(|(n, _)| n == "tracker-frames.json")
        .expect("the slice's fixture")
        .1;
    let statuses: Vec<u64> = f["exchanges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["response"]["status"].as_u64().unwrap())
        .collect();
    for want in [200, 500, 403] {
        assert!(
            statuses.contains(&want),
            "a {want} response in {statuses:?}"
        );
    }
    let kinds: Vec<String> = f["exchanges"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|x| {
            x["response"]["headers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|h| h[0] == "content-type")
                .map(|h| h[1].as_str().unwrap().to_string())
        })
        .collect();
    for want in [
        "text/html; charset=utf-8",
        "application/x-frame-stream",
        "application/json",
        "text/plain",
    ] {
        assert!(
            kinds.iter().any(|k| k == want),
            "a {want} response in {kinds:?}"
        );
    }
}

#[test]
fn an_answer_the_script_does_not_hold_fails_the_server_closed() {
    let f = &fixtures()
        .into_iter()
        .find(|(n, _)| n == "tracker-frames.json")
        .expect("the slice's fixture")
        .1;
    // Every answer's arguments changed: the document's first host call no
    // longer matches its answer.
    let mut answers = f["answers"].clone();
    for a in answers.as_array_mut().unwrap() {
        if let Some(args) = a["args"].as_array_mut() {
            args.push(json!(99));
        }
    }
    let s = server(f, &answers);
    let x = &f["exchanges"][0];
    let req = request(&x["request"]);
    let failed = match answer(&s, &req) {
        Err(_) => true,
        Ok(r) => s.hosts.failure.borrow().is_some() && as_json(&r) != x["response"],
    };
    assert!(
        failed,
        "a mismatched script must fail the server, not answer"
    );
}

#[test]
fn a_changed_byte_in_solids_response_is_a_difference() {
    let f = &fixtures()
        .into_iter()
        .find(|(n, _)| n == "tracker-frames.json")
        .expect("the slice's fixture")
        .1;
    let s = server(f, &f["answers"]);
    let x = &f["exchanges"][0];
    let got = as_json(&answer(&s, &request(&x["request"])).expect("the document"));
    let mut tampered = x["response"].clone();
    let chunk = tampered["chunks"][0]
        .as_str()
        .unwrap()
        .replacen("<div", "<dIv", 1);
    tampered["chunks"][0] = J::String(chunk);
    assert_eq!(got, x["response"]);
    assert_ne!(got, tampered);
}

/// The CSRF gate (server.ts:4144-4192) on a data request of the slice's plan:
/// same-origin fetch metadata admits; `none`, `same-site` and `cross-site`
/// refuse; without it, `Origin` (else `Referer`) must be the request's own
/// origin; with none of the three, refuse. A refusal is a bodiless 403 with
/// the finalized headers.
#[test]
fn the_csrf_gate_admits_same_origin_requests_only() {
    let f = &fixtures()
        .into_iter()
        .find(|(n, _)| n == "tracker-frames.json")
        .expect("the slice's fixture")
        .1;
    let s = server(f, &json!([]));
    let id = f["plan"]["serverFns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == "loadList")
        .expect("loadList")["id"]
        .as_str()
        .unwrap()
        .to_string();
    let at = |headers: &[(&str, &str)]| -> u16 {
        let mut h: Vec<(String, String)> = vec![("host".into(), "127.0.0.1:1".into())];
        h.extend(headers.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        let req = Request {
            method: "POST".into(),
            target: format!("/_server/data/{id}"),
            headers: h,
            body: vec![],
            origin: "http://127.0.0.1:1".into(),
        };
        let r = s.handle(&req).expect("an answer");
        if r.status == 403 {
            assert!(r.chunks.is_empty());
            assert_eq!(
                r.headers,
                vec![
                    ("cache-control".to_string(), "no-store".to_string()),
                    (
                        "vary".to_string(),
                        "Sec-Fetch-Site, Origin, Referer".to_string()
                    ),
                    ("x-content-type-options".to_string(), "nosniff".to_string())
                ]
            );
        }
        r.status
    };
    for site in ["none", "same-site", "cross-site"] {
        assert_eq!(at(&[("sec-fetch-site", site)]), 403, "{site}");
    }
    assert_eq!(at(&[]), 403, "no metadata");
    assert_eq!(at(&[("origin", "http://evil.example")]), 403);
    assert_eq!(at(&[("referer", "http://evil.example/page")]), 403);
    assert_eq!(
        at(&[
            ("sec-fetch-site", "cross-site"),
            ("origin", "http://127.0.0.1:1")
        ]),
        403,
        "fetch metadata decides first"
    );
    // The admitted ones reach the host table, which this script leaves empty:
    // the server fails closed instead of answering.
    for h in [
        vec![("sec-fetch-site", "same-origin")],
        vec![("origin", "http://127.0.0.1:1")],
        vec![("referer", "http://127.0.0.1:1/x")],
    ] {
        let s = server(f, &json!([]));
        let mut headers: Vec<(String, String)> = vec![("host".into(), "127.0.0.1:1".into())];
        headers.extend(h.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        let req = Request {
            method: "POST".into(),
            target: format!("/_server/data/{id}"),
            headers,
            body: vec![],
            origin: "http://127.0.0.1:1".into(),
        };
        let r = s.handle(&req);
        assert!(
            r.is_err() || s.hosts.failure.borrow().is_some(),
            "{h:?} is admitted, and the empty script fails it"
        );
    }
}

/// The endpoint's refusals outside the frames subset are diagnostics (the
/// server's `Err`), never answers; an unknown id is Solid's labelled 404.
#[test]
fn the_endpoint_refuses_what_the_frames_subset_never_sends() {
    let f = &fixtures()
        .into_iter()
        .find(|(n, _)| n == "tracker-frames.json")
        .expect("the slice's fixture")
        .1;
    let s = server(f, &json!([]));
    let id = f["plan"]["serverFns"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let req = |target: String, method: &str| Request {
        method: method.into(),
        target,
        headers: vec![
            ("host".into(), "h:1".into()),
            ("sec-fetch-site".into(), "same-origin".into()),
        ],
        body: vec![],
        origin: "http://h:1".into(),
    };
    let unknown = s
        .handle(&req("/_server/data/nope-00000000".into(), "POST"))
        .expect("an answer");
    assert_eq!(
        (
            unknown.status,
            unknown
                .headers
                .iter()
                .any(|(k, v)| k == "x-server-function-unknown" && v == "true")
        ),
        (404, true)
    );
    let get = s
        .handle(&req(format!("/_server/data/{id}"), "GET"))
        .expect("an answer");
    assert_eq!(get.status, 405);
    assert!(get
        .headers
        .contains(&("allow".to_string(), "POST".to_string())));
    for target in [
        format!("/_server/{id}"),
        format!("/_server/live/{id}"),
        format!("/_server/data/{id}?args=%5B%5D"),
    ] {
        assert!(
            s.handle(&req(target.clone(), "POST")).is_err(),
            "{target} is refused with a diagnostic"
        );
    }
}

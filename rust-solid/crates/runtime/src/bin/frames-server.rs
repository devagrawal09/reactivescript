//! `frames-server PLAN.json ANSWERS.json`: serves a plan v2.2 as Solid's
//! own server serves its canonical split (the document, the frame streams,
//! the server-function endpoint), its server hosts answered by the script.
//! Prints `{"port":N}` on its first line, then serves until killed.
use rust_solid::frames::{
    document,
    hosts::{Answer, Hosts},
    http::Http,
    plan::Plan,
    server::FramesServer,
};
use std::net::TcpListener;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        eprintln!("usage: frames-server PLAN.json ANSWERS.json");
        std::process::exit(2);
    }
    let run = || -> Result<(), String> {
        let plan = Plan::parse(&std::fs::read_to_string(&args[0]).map_err(|e| e.to_string())?)?;
        let answers: Vec<Answer> =
            serde_json::from_str(&std::fs::read_to_string(&args[1]).map_err(|e| e.to_string())?)
                .map_err(|e| format!("answers: {e}"))?;
        let server = FramesServer::new(plan, Hosts::new(answers)?);
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        println!(
            "{{\"port\":{}}}",
            listener.local_addr().map_err(|e| e.to_string())?.port()
        );
        Http::new(server, Box::new(document::serve)).serve(listener)
    };
    if let Err(e) = run() {
        eprintln!("frames-server: {e}");
        std::process::exit(1);
    }
}

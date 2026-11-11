//! The frames server over HTTP/1.1 (std only): one request per connection
//! (`Connection: close`), the handler's status, headers and body chunks
//! written as produced. The transport adds `connection` and nothing else.
//! Endpoints: `GET /` the document, `/_server/...` the server-function
//! endpoint, `GET /__log` the server host log and the wire records (every
//! response the handler produced, as frontend `frames/leg-server.ts` records
//! Solid's).
use super::server::{FramesServer, Request, Response};
use serde_json::{json, Value as J};
use std::{
    cell::RefCell,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
};

/// The document's handler (`document::serve`).
pub type DocumentHandler = Box<dyn Fn(&FramesServer, &Request) -> Result<Response, String>>;

pub struct Http {
    pub server: FramesServer,
    pub document: DocumentHandler,
    wire: RefCell<Vec<J>>,
}

impl Http {
    pub fn new(server: FramesServer, document: DocumentHandler) -> Http {
        Http {
            server,
            document,
            wire: RefCell::new(vec![]),
        }
    }

    pub fn serve(&self, listener: TcpListener) -> Result<(), String> {
        for stream in listener.incoming() {
            let mut stream = stream.map_err(|e| e.to_string())?;
            if let Err(e) = self.connection(&mut stream) {
                eprintln!("frames-server: {e}");
                let _ = write_response(
                    &mut stream,
                    &Response {
                        status: 500,
                        headers: vec![("content-type".into(), "text/plain".into())],
                        chunks: vec![format!("rust-solid frames-server: {e}")],
                    },
                );
            }
        }
        Ok(())
    }

    fn connection(&self, stream: &mut TcpStream) -> Result<(), String> {
        let req = read_request(stream)?;
        let path = req.target.split('?').next().unwrap_or("").to_string();
        let response = if req.method == "GET" && path == "/__log" {
            let log = json!({ "hosts": *self.server.hosts.log.borrow(), "document": *self.server.document_calls.borrow(), "wire": *self.wire.borrow(), "failure": *self.server.hosts.failure.borrow() });
            Response {
                status: 200,
                headers: vec![("content-type".into(), "application/json".into())],
                chunks: vec![log.to_string()],
            }
        } else {
            let r = if req.method == "GET" && path == "/" {
                (self.document)(&self.server, &req)?
            } else if path.starts_with("/_server") {
                self.server.handle(&req)?
            } else {
                Response {
                    status: 404,
                    headers: vec![],
                    chunks: vec![],
                }
            };
            if let Some(f) = self.server.hosts.failure.borrow().clone() {
                return Err(f);
            }
            self.wire.borrow_mut().push(json!({
                "method": req.method, "path": req.target,
                "body": String::from_utf8_lossy(&req.body),
                "status": r.status,
                "headers": r.headers.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(),
                "chunks": r.chunks,
            }));
            r
        };
        write_response(stream, &response).map_err(|e| e.to_string())
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let local = stream.local_addr().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.trim_end().splitn(3, ' ');
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut headers = vec![];
    let mut length = 0usize;
    loop {
        let mut h = String::new();
        reader.read_line(&mut h).map_err(|e| e.to_string())?;
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        let (k, v) = h
            .split_once(':')
            .ok_or_else(|| format!("a malformed header {h:?}"))?;
        let (k, v) = (k.trim().to_ascii_lowercase(), v.trim().to_string());
        if k == "content-length" {
            length = v.parse().map_err(|_| "a malformed content-length")?;
        }
        if k == "transfer-encoding" {
            return Err("chunked request bodies are not read by the frames server".into());
        }
        headers.push((k, v));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    // The request's own origin: the Host it was sent to (the harness's proxy
    // forwards the page's Host), else the socket's.
    let host = headers
        .iter()
        .find(|(k, _)| k == "host")
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| local.to_string());
    Ok(Request {
        method,
        target,
        headers,
        body,
        origin: format!("http://{host}"),
    })
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

fn write_response(stream: &mut TcpStream, r: &Response) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {} {}\r\n", r.status, reason(r.status));
    for (k, v) in &r.headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("connection: close\r\n\r\n");
    stream.write_all(head.as_bytes())?;
    for c in &r.chunks {
        stream.write_all(c.as_bytes())?;
        stream.flush()?;
    }
    Ok(())
}

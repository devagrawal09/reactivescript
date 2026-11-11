//! The wire helpers both frame faces and the server-function endpoint share:
//! chunk framing, the text digest, the frame address, and `JSON.stringify`.
//! `shared.ts` is `packages/web/server-functions/src/shared.ts`.
use serde_json::Value as J;

// Solid: shared.ts:1243-1255 (`createChunk`): `;0x` + the UTF-8 byte length
// in 8 hex digits + `;` + the payload.
pub fn create_chunk(data: &str) -> Result<String, String> {
    let bytes = data.len();
    // shared.ts MAX_CHUNK_BYTES: 8 hex digits.
    if bytes > 0xffff_ffff {
        return Err("Server function chunk is too large to frame.".into());
    }
    Ok(format!(";0x{bytes:08x};{data}"))
}

// Solid: shared.ts:1595-1604 (`textDigest`): two FNV-1a lanes over the
// UTF-16 code units, 16 hex digits.
pub fn text_digest(text: &str) -> String {
    let mut a: u32 = 0x811c_9dc5;
    let mut b: u32 = 0x050c_5d1f;
    for code in text.encode_utf16() {
        a = (a ^ code as u32).wrapping_mul(0x0100_0193);
        b = (b ^ code as u32).wrapping_mul(0x0100_0193);
    }
    format!("{a:08x}{b:08x}")
}

// Solid: shared.ts:484-486 (`frameAddress`).
pub fn frame_address(id: &str, args: &[J]) -> Result<String, String> {
    Ok(if args.is_empty() {
        id.to_string()
    } else {
        format!("{id}:{}", hash_arguments(args)?)
    })
}

// Solid: shared.ts:492-501 (`hashArguments`): a 31-hash over the stable
// string's UTF-16 code units, unsigned, base 36.
pub fn hash_arguments(args: &[J]) -> Result<String, String> {
    let text = stable_string(&J::Array(args.to_vec()))?;
    let mut hash: i32 = 0;
    for c in text.encode_utf16() {
        hash = (hash << 5).wrapping_sub(hash).wrapping_add(c as i32);
    }
    Ok(base36(hash as u32 as u64))
}

// Solid: shared.ts:503-544 (`stableString`), for the wire values a frames plan
// passes (integers, strings, booleans, arrays, records): `String(value)` for a
// primitive, `[…]` for an array, `{k:v,…}` with sorted keys for a record.
fn stable_string(v: &J) -> Result<String, String> {
    Ok(match v {
        J::Null => "null".into(),
        J::Bool(b) => b.to_string(),
        J::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => return Err(format!("frame address of the non-integer {n}")),
        },
        J::String(s) => s.clone(),
        J::Array(xs) => {
            let mut out = "[".to_string();
            for (i, x) in xs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&stable_string(x)?);
            }
            out + "]"
        }
        J::Object(o) => {
            // `Object.keys(value).sort()`: UTF-16 code-unit order.
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            let mut out = "{".to_string();
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(k);
                out.push(':');
                out.push_str(&stable_string(&o[k.as_str()])?);
            }
            out + "}"
        }
    })
}

/// `Number.prototype.toString(36)` for a non-negative integer.
pub fn base36(mut n: u64) -> String {
    if n == 0 {
        return "0".into();
    }
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = vec![];
    while n > 0 {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("ascii")
}

/// `JSON.stringify` of a JSON value, as V8 spells it: object keys in
/// insertion order, integers in base ten, strings with `"`, `\`, the short
/// control escapes and `\u00xx` for the other control characters (lowercase
/// hex), everything else literal.
pub fn json_stringify(v: &J) -> Result<String, String> {
    let mut out = String::new();
    write_json(v, &mut out)?;
    Ok(out)
}

fn write_json(v: &J, out: &mut String) -> Result<(), String> {
    match v {
        J::Null => out.push_str("null"),
        J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J::Number(n) => match n.as_i64() {
            Some(i) => out.push_str(&i.to_string()),
            None => return Err(format!("JSON.stringify of the non-integer {n}")),
        },
        J::String(s) => json_string(s, out),
        J::Array(xs) => {
            out.push('[');
            for (i, x) in xs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(x, out)?;
            }
            out.push(']');
        }
        J::Object(o) => {
            out.push('{');
            for (i, (k, x)) in o.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                json_string(k, out);
                out.push(':');
                write_json(x, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

pub fn json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Observed at the pin: `Detail$server(2)` streams at
    // `Detail$server-c06e01e8:1wpz`... for args [1]; `[2]` hashes to its own.
    #[test]
    fn frame_address_hashes_the_arguments() {
        // hashArguments([1]) = 31-hash of "[1]": 91*31^2 + 49*31 + 93.
        let h = (91u32 * 31 * 31 + 49 * 31 + 93) as u64;
        assert_eq!(hash_arguments(&[json!(1)]).unwrap(), base36(h));
        assert_eq!(base36(h), "1wpz");
        assert_eq!(frame_address("f", &[]).unwrap(), "f");
        assert_eq!(frame_address("f", &[json!(1)]).unwrap(), "f:1wpz");
    }

    #[test]
    fn chunks_and_digests() {
        assert_eq!(create_chunk("{}").unwrap(), ";0x00000002;{}");
        assert_eq!(create_chunk("é").unwrap(), ";0x00000002;é");
        // The empty string: both lanes' offsets.
        assert_eq!(text_digest(""), "811c9dc5050c5d1f");
    }

    #[test]
    fn stringify_spells_as_v8() {
        let v = json!({"b": [1, true, null], "a": "x\"\n\u{1}<"});
        assert_eq!(
            json_stringify(&v).unwrap(),
            r#"{"b":[1,true,null],"a":"x\"\n\u0001<"}"#
        );
    }
}

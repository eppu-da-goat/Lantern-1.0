//! Lantern core, written in Rust and compiled to WebAssembly.
//!
//! The Electron main process loads `lantern_core.wasm` and talks to it through one function,
//! `lc_call`, passing a JSON request `{"fn": "...", "args": {...}}` and getting JSON back:
//! `{"ok": <value>}` or `{"error": "<message>"}`. Everything here is pure computation: the core
//! never touches the network or the disk, so it is easy to test and can't leak anything.

pub mod ai;
pub mod mail;
pub mod qr;
pub mod rank;
pub mod settings;
pub mod theme;

use serde_json::{json, Value};

/// Runs one request. Public so native tests can call it directly.
pub fn dispatch(input: &[u8]) -> Value {
    let req: Value = match serde_json::from_slice(input) {
        Ok(v) => v,
        Err(e) => return json!({ "error": format!("bad request: {e}") }),
    };
    let f = req.get("fn").and_then(Value::as_str).unwrap_or("");
    let empty = json!({});
    let a = req.get("args").unwrap_or(&empty);
    let result: Result<Value, String> = match f {
        "version" => Ok(json!(env!("CARGO_PKG_VERSION"))),
        // AI providers
        "ai.providers" => Ok(ai::providers()),
        "ai.detect" => Ok(ai::detect(s(a, "key"))),
        "ai.validateKey" => Ok(ai::validate_key(s(a, "provider"), s(a, "key"))),
        "ai.maskKey" => Ok(json!(ai::mask_key(s(a, "key")))),
        "ai.buildChat" => ai::build_chat(a),
        "ai.parseChat" => ai::parse_chat(s(a, "provider"), a.get("status").and_then(Value::as_u64).unwrap_or(0), s(a, "body")),
        "ai.sseFeed" => ai::sse_feed(s(a, "provider"), s(a, "buffer")),
        "ai.explainError" => Ok(json!(ai::explain_error(s(a, "provider"), a.get("status").and_then(Value::as_u64).unwrap_or(0), s(a, "body")))),
        "ai.buildModels" => ai::build_models(s(a, "provider"), s(a, "key")),
        "ai.parseModels" => ai::parse_models(s(a, "provider"), s(a, "body")),
        "ai.pageContext" => Ok(json!(ai::page_context(s(a, "title"), s(a, "url"), s(a, "text"), a.get("limit").and_then(Value::as_u64).unwrap_or(12000) as usize))),
        // Customization
        "theme.palette" => theme::palette(s(a, "hex")),
        "theme.contrast" => theme::contrast_json(s(a, "a"), s(a, "b")),
        "settings.validate" => Ok(settings::validate(s(a, "key"), a.get("value").unwrap_or(&Value::Null))),
        "settings.keys" => Ok(settings::keys()),
        "mail.services" => Ok(mail::services()),
        "mail.url" => mail::url(s(a, "service"), s(a, "custom")),
        // Omnibox and library
        "rank.entries" => Ok(rank::rank(a)),
        "qr.svg" => qr::svg(s(a, "text"), s(a, "dark"), s(a, "light")),
        _ => Err(format!("unknown function: {f}")),
    };
    match result {
        Ok(v) => json!({ "ok": v }),
        Err(e) => json!({ "error": e }),
    }
}

pub(crate) fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

// ---------- WebAssembly ABI ----------

/// Reserves `len` bytes the host can write a request into.
#[no_mangle]
pub extern "C" fn lc_alloc(len: usize) -> *mut u8 {
    let buf = vec![0u8; len.max(1)].into_boxed_slice();
    Box::into_raw(buf) as *mut u8
}

/// Frees a buffer from `lc_alloc` or a result from `lc_call`.
///
/// # Safety
/// `ptr` and `len` must come from `lc_alloc` or `lc_call` and be freed once.
#[no_mangle]
pub unsafe extern "C" fn lc_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len.max(1))));
}

/// Runs a request and returns `(ptr << 32) | len` of the UTF-8 JSON result.
///
/// # Safety
/// `ptr..ptr+len` must be a buffer the host filled after `lc_alloc`.
#[no_mangle]
pub unsafe extern "C" fn lc_call(ptr: *const u8, len: usize) -> u64 {
    let input = std::slice::from_raw_parts(ptr, len);
    let out = dispatch(input).to_string().into_bytes();
    let n = out.len();
    let mut boxed = out.into_boxed_slice();
    if n == 0 {
        boxed = vec![0u8; 1].into_boxed_slice();
    }
    let p = Box::into_raw(boxed) as *mut u8;
    ((p as u64) << 32) | n as u64
}

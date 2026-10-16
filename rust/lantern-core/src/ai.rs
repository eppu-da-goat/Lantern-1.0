//! AI providers: Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google) and Groq.
//!
//! Each provider speaks a different API. This module builds the exact HTTP request for the
//! provider the user picked (URL, headers and JSON body), reads its streamed answer, and turns
//! its errors into plain sentences. The main process only sends what this returns.

use serde_json::{json, Map, Value};

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub short: &'static str,
    pub default_model: &'static str,
    pub models: &'static [&'static str],
    pub key_hint: &'static str,
    pub key_url: &'static str,
}

pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "claude",
        name: "Claude (Anthropic)",
        short: "Claude",
        default_model: "claude-sonnet-5-5",
        models: &["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
        key_hint: "sk-ant-…",
        key_url: "https://console.anthropic.com/settings/keys",
    },
    Provider {
        id: "openai",
        name: "ChatGPT (OpenAI)",
        short: "ChatGPT",
        default_model: "gpt-5.4-mini",
        models: &["gpt-5.4-mini", "gpt-6-luna", "gpt-5.5"],
        key_hint: "sk-…",
        key_url: "https://platform.openai.com/api-keys",
    },
    Provider {
        id: "gemini",
        name: "Gemini (Google)",
        short: "Gemini",
        default_model: "gemini-3.6-flash",
        models: &["gemini-3.6-flash", "gemini-3.1-flash-lite"],
        key_hint: "AIza…",
        key_url: "https://aistudio.google.com/app/apikey",
    },
    Provider {
        id: "groq",
        name: "Groq",
        short: "Groq",
        default_model: "llama-3.3-70b-versatile",
        models: &["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"],
        key_hint: "gsk_…",
        key_url: "https://console.groq.com/keys",
    },
];

pub fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

fn need(id: &str) -> Result<&'static Provider, String> {
    provider(id).ok_or_else(|| format!("Unknown AI provider \"{id}\""))
}

pub fn providers() -> Value {
    Value::Array(
        PROVIDERS
            .iter()
            .map(|p| {
                json!({
                    "id": p.id, "name": p.name, "short": p.short, "defaultModel": p.default_model,
                    "models": p.models, "keyHint": p.key_hint, "keyUrl": p.key_url,
                })
            })
            .collect(),
    )
}

/// Guesses which provider issued a key from its prefix.
pub fn detect_id(key: &str) -> Option<&'static str> {
    let k = key.trim();
    if k.starts_with("sk-ant-") {
        Some("claude")
    } else if k.starts_with("gsk_") {
        Some("groq")
    } else if k.starts_with("AIza") {
        Some("gemini")
    } else if k.starts_with("sk-") {
        Some("openai")
    } else {
        None
    }
}

pub fn detect(key: &str) -> Value {
    match detect_id(key) {
        Some(id) => json!({ "provider": id, "name": provider(id).map(|p| p.short) }),
        None => {
            let other = if key.trim().starts_with("xai-") { Some("xAI (Grok)") } else { None };
            json!({ "provider": null, "other": other })
        }
    }
}

/// Checks a key before it's saved. A key that clearly belongs to another provider is refused,
/// with the provider it looks like, so the UI can offer to save it there instead.
pub fn validate_key(provider_id: &str, key: &str) -> Value {
    let Some(p) = provider(provider_id) else {
        return json!({ "ok": false, "message": "Choose which AI service this key is for." });
    };
    let raw = key;
    let k = key.trim();
    if k.is_empty() {
        return json!({ "ok": false, "message": "Paste an API key first." });
    }
    if k.chars().any(char::is_whitespace) || raw.contains('\n') {
        return json!({ "ok": false, "message": "The key has spaces or line breaks in it. Copy it again without them." });
    }
    if !k.chars().all(|c| c.is_ascii_graphic()) {
        return json!({ "ok": false, "message": "The key has characters an API key can't contain. Copy it again." });
    }
    if k.len() < 20 || k.len() > 400 {
        return json!({ "ok": false, "message": "That doesn't look like a complete API key." });
    }
    if let Some(found) = detect_id(k) {
        if found != p.id {
            let other = provider(found).map(|x| x.short).unwrap_or(found);
            return json!({
                "ok": false,
                "suggest": found,
                "message": format!("This looks like a {other} key, not a {} key.", p.short),
            });
        }
    } else if k.starts_with("xai-") {
        return json!({ "ok": false, "message": "That's an xAI (Grok) key. Lantern supports Claude, ChatGPT, Gemini and Groq." });
    }
    json!({ "ok": true, "key": k })
}

/// Shows only the start and end of a key, so it can be recognised but not copied.
pub fn mask_key(key: &str) -> String {
    let k = key.trim();
    let chars: Vec<char> = k.chars().collect();
    if chars.len() <= 10 {
        return "•".repeat(chars.len().max(4));
    }
    let head_len = if k.starts_with("sk-ant-") { 10 } else if k.starts_with("sk-proj-") { 8 } else { 4 };
    let head: String = chars[..head_len.min(chars.len() - 4)].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

fn safe_model(model: &str, p: &Provider) -> Result<String, String> {
    let m = model.trim().trim_start_matches("models/");
    let m = if m.is_empty() { p.default_model } else { m };
    if m.len() > 120 || !m.chars().all(|c| c.is_ascii_alphanumeric() || "._-/:@".contains(c)) {
        return Err(format!("\"{m}\" isn't a valid model name."));
    }
    Ok(m.to_string())
}

/// Chat turns, cleaned up the way every provider accepts: only user/assistant roles, no empty
/// turns, consecutive turns from the same side merged, and the first turn always from the user.
fn normalise_turns(messages: &Value) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for m in messages.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let role = match m.get("role").and_then(Value::as_str) {
            Some("assistant") | Some("model") => "assistant",
            Some("user") => "user",
            _ => continue,
        };
        let text = m.get("content").and_then(Value::as_str).unwrap_or("").trim();
        if text.is_empty() {
            continue;
        }
        if let Some(last) = out.last_mut() {
            if last.0 == role {
                last.1.push_str("\n\n");
                last.1.push_str(text);
                continue;
            }
        }
        out.push((role.to_string(), text.to_string()));
    }
    while out.first().map(|t| t.0 == "assistant").unwrap_or(false) {
        out.remove(0);
    }
    out
}

/// Builds the HTTP request for one chat turn.
/// args: { provider, key, model, system, messages: [{role, content}], maxTokens, temperature, stream }
pub fn build_chat(a: &Value) -> Result<Value, String> {
    let p = need(crate::s(a, "provider"))?;
    let key = crate::s(a, "key").trim();
    if key.is_empty() {
        return Err(format!("Add a {} API key first.", p.short));
    }
    let model = safe_model(crate::s(a, "model"), p)?;
    let system = crate::s(a, "system").trim();
    let stream = a.get("stream").and_then(Value::as_bool).unwrap_or(true);
    let max_tokens = a.get("maxTokens").and_then(Value::as_u64).unwrap_or(2048).clamp(16, 32000);
    let temperature = a.get("temperature").and_then(Value::as_f64);
    let turns = normalise_turns(a.get("messages").unwrap_or(&Value::Null));
    if turns.is_empty() {
        return Err("Type a message first.".into());
    }

    let mut headers = Map::new();
    headers.insert("content-type".into(), json!("application/json"));
    let (url, body) = match p.id {
        "claude" => {
            headers.insert("x-api-key".into(), json!(key));
            headers.insert("anthropic-version".into(), json!("2023-06-01"));
            // Lantern calls the API straight from the user's own device with the user's own key.
            headers.insert("anthropic-dangerous-direct-browser-access".into(), json!("true"));
            let msgs: Vec<Value> = turns.iter().map(|(r, t)| json!({ "role": r, "content": t })).collect();
            let mut b = json!({ "model": model, "max_tokens": max_tokens, "messages": msgs, "stream": stream });
            if !system.is_empty() {
                b["system"] = json!(system);
            }
            if let Some(t) = temperature {
                b["temperature"] = json!(t.clamp(0.0, 1.0));
            }
            ("https://api.anthropic.com/v1/messages".to_string(), b)
        }
        "openai" | "groq" => {
            headers.insert("authorization".into(), json!(format!("Bearer {key}")));
            let mut msgs: Vec<Value> = Vec::new();
            if !system.is_empty() {
                msgs.push(json!({ "role": "system", "content": system }));
            }
            msgs.extend(turns.iter().map(|(r, t)| json!({ "role": r, "content": t })));
            let mut b = json!({ "model": model, "messages": msgs, "stream": stream, "max_completion_tokens": max_tokens });
            if let Some(t) = temperature {
                b["temperature"] = json!(t.clamp(0.0, 2.0));
            }
            let url = if p.id == "openai" {
                "https://api.openai.com/v1/chat/completions"
            } else {
                "https://api.groq.com/openai/v1/chat/completions"
            };
            (url.to_string(), b)
        }
        "gemini" => {
            headers.insert("x-goog-api-key".into(), json!(key));
            let contents: Vec<Value> = turns
                .iter()
                .map(|(r, t)| json!({ "role": if r == "assistant" { "model" } else { "user" }, "parts": [{ "text": t }] }))
                .collect();
            let mut gen = json!({ "maxOutputTokens": max_tokens });
            if let Some(t) = temperature {
                gen["temperature"] = json!(t.clamp(0.0, 2.0));
            }
            let mut b = json!({ "contents": contents, "generationConfig": gen });
            if !system.is_empty() {
                b["systemInstruction"] = json!({ "parts": [{ "text": system }] });
            }
            let action = if stream { "streamGenerateContent?alt=sse" } else { "generateContent" };
            (format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:{action}"), b)
        }
        _ => unreachable!(),
    };
    Ok(json!({
        "url": url,
        "method": "POST",
        "headers": Value::Object(headers),
        "body": body.to_string(),
        "model": model,
        "stream": stream,
    }))
}

fn text_of_openai(v: &Value) -> String {
    v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").to_string()
}

fn text_of_gemini(v: &Value) -> String {
    let mut out = String::new();
    if let Some(parts) = v.pointer("/candidates/0/content/parts").and_then(Value::as_array) {
        for part in parts {
            if part.get("thought").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            if let Some(t) = part.get("text").and_then(Value::as_str) {
                out.push_str(t);
            }
        }
    }
    out
}

fn provider_message(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let m = v
        .pointer("/error/message")
        .or_else(|| v.pointer("/0/error/message"))
        .or_else(|| v.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let m = m.trim();
    if m.is_empty() {
        let plain = body.trim();
        if plain.starts_with('<') || plain.is_empty() { String::new() } else { plain.chars().take(200).collect() }
    } else {
        m.chars().take(300).collect()
    }
}

/// Turns an HTTP failure into a sentence a person can act on.
pub fn explain_error(provider_id: &str, status: u64, body: &str) -> String {
    let name = provider(provider_id).map(|p| p.short).unwrap_or("The AI service");
    let detail = provider_message(body);
    let lower = detail.to_lowercase();
    let base = match status {
        401 => format!("{name} rejected the API key. Check it in AI settings."),
        403 if lower.contains("country") || lower.contains("region") || lower.contains("location") => {
            format!("{name} isn't available from your location with this key.")
        }
        403 => format!("This {name} key isn't allowed to do that. Check its permissions in your {name} account."),
        404 => format!("{name} doesn't have that model. Pick another one in the model list."),
        402 => format!("Your {name} account is out of credit."),
        429 if lower.contains("quota") || lower.contains("credit") || lower.contains("billing") || lower.contains("balance") => {
            format!("Your {name} account is out of credit or over its quota.")
        }
        429 => format!("{name} is rate-limiting this key. Wait a moment and try again."),
        400 if lower.contains("credit balance") => format!("Your {name} account is out of credit."),
        400 if lower.contains("api key") || lower.contains("api_key") => format!("{name} rejected the API key. Check it in AI settings."),
        400 => format!("{name} couldn't use that request."),
        408 | 504 => format!("{name} took too long to answer. Try again."),
        500..=599 => format!("{name} is having trouble right now (error {status}). Try again shortly."),
        0 => format!("Lantern couldn't reach {name}. Check your connection."),
        _ => format!("{name} returned an error ({status})."),
    };
    if detail.is_empty() || matches!(status, 0 | 401) {
        base
    } else {
        format!("{base} ({detail})")
    }
}

/// Reads a complete (non-streamed) answer.
pub fn parse_chat(provider_id: &str, status: u64, body: &str) -> Result<Value, String> {
    let p = need(provider_id)?;
    if !(200..300).contains(&status) {
        return Ok(json!({ "error": explain_error(p.id, status, body) }));
    }
    let v: Value = serde_json::from_str(body).map_err(|_| format!("{} sent an answer Lantern couldn't read.", p.short))?;
    let (text, finish) = match p.id {
        "claude" => {
            let mut t = String::new();
            for block in v.get("content").and_then(Value::as_array).map(|a| a.as_slice()).unwrap_or(&[]) {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    t.push_str(block.get("text").and_then(Value::as_str).unwrap_or(""));
                }
            }
            (t, v.get("stop_reason").cloned().unwrap_or(Value::Null))
        }
        "openai" | "groq" => (text_of_openai(&v), v.pointer("/choices/0/finish_reason").cloned().unwrap_or(Value::Null)),
        "gemini" => (text_of_gemini(&v), v.pointer("/candidates/0/finishReason").cloned().unwrap_or(Value::Null)),
        _ => unreachable!(),
    };
    Ok(json!({ "text": text, "finish": finish }))
}

/// Feeds streamed Server-Sent Events. Pass everything received so far that hasn't been consumed;
/// get back the new text, whether the answer is finished, any error, and the unconsumed rest.
pub fn sse_feed(provider_id: &str, buffer: &str) -> Result<Value, String> {
    let p = need(provider_id)?;
    let buf = buffer.replace("\r\n", "\n");
    let mut delta = String::new();
    let mut done = false;
    let mut error: Option<String> = None;
    let mut finish: Option<String> = None;
    let mut usage = Value::Null;

    let (complete, rest) = match buf.rfind("\n\n") {
        Some(i) => (&buf[..i], &buf[i + 2..]),
        None => ("", buf.as_str()),
    };
    for event in complete.split("\n\n") {
        let mut data = String::new();
        let mut name = "";
        for line in event.lines() {
            if let Some(d) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(d.strip_prefix(' ').unwrap_or(d));
            } else if let Some(e) = line.strip_prefix("event:") {
                name = e.trim();
            }
        }
        let data = data.trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            done = true;
            continue;
        }
        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
            error = Some(format!("{}: {}", p.short, msg.chars().take(300).collect::<String>()));
            done = true;
            continue;
        }
        match p.id {
            "claude" => {
                let kind = v.get("type").and_then(Value::as_str).unwrap_or(name);
                match kind {
                    "content_block_delta" => {
                        if v.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                            delta.push_str(v.pointer("/delta/text").and_then(Value::as_str).unwrap_or(""));
                        }
                    }
                    "message_delta" => {
                        if let Some(r) = v.pointer("/delta/stop_reason").and_then(Value::as_str) {
                            finish = Some(r.to_string());
                        }
                        if let Some(u) = v.get("usage") {
                            usage = u.clone();
                        }
                    }
                    "message_stop" => done = true,
                    "error" => {
                        error = Some(format!("{} had a problem answering. Try again.", p.short));
                        done = true;
                    }
                    _ => {}
                }
            }
            "openai" | "groq" => {
                if let Some(t) = v.pointer("/choices/0/delta/content").and_then(Value::as_str) {
                    delta.push_str(t);
                }
                if let Some(r) = v.pointer("/choices/0/finish_reason").and_then(Value::as_str) {
                    finish = Some(r.to_string());
                }
                if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
                    usage = u.clone();
                }
            }
            "gemini" => {
                delta.push_str(&text_of_gemini(&v));
                if let Some(r) = v.pointer("/candidates/0/finishReason").and_then(Value::as_str) {
                    finish = Some(r.to_string());
                    if r == "SAFETY" || r == "PROHIBITED_CONTENT" || r == "BLOCKLIST" {
                        error = Some("Gemini stopped because the answer tripped its safety filters.".into());
                    }
                }
                if let Some(r) = v.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
                    error = Some(format!("Gemini blocked this request ({r})."));
                    done = true;
                }
                if let Some(u) = v.get("usageMetadata") {
                    usage = u.clone();
                }
            }
            _ => {}
        }
    }
    Ok(json!({ "delta": delta, "done": done, "error": error, "finish": finish, "usage": usage, "rest": rest }))
}

/// The request that lists a provider's models, which also proves the key works.
pub fn build_models(provider_id: &str, key: &str) -> Result<Value, String> {
    let p = need(provider_id)?;
    let key = key.trim();
    let mut headers = Map::new();
    let url = match p.id {
        "claude" => {
            headers.insert("x-api-key".into(), json!(key));
            headers.insert("anthropic-version".into(), json!("2023-06-01"));
            headers.insert("anthropic-dangerous-direct-browser-access".into(), json!("true"));
            "https://api.anthropic.com/v1/models?limit=100"
        }
        "openai" => {
            headers.insert("authorization".into(), json!(format!("Bearer {key}")));
            "https://api.openai.com/v1/models"
        }
        "groq" => {
            headers.insert("authorization".into(), json!(format!("Bearer {key}")));
            "https://api.groq.com/openai/v1/models"
        }
        "gemini" => {
            headers.insert("x-goog-api-key".into(), json!(key));
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
        }
        _ => unreachable!(),
    };
    Ok(json!({ "url": url, "method": "GET", "headers": Value::Object(headers) }))
}

fn is_chat_model(provider_id: &str, id: &str, entry: &Value) -> bool {
    let l = id.to_lowercase();
    let deny = |words: &[&str]| words.iter().any(|w| l.contains(w));
    match provider_id {
        "claude" => l.starts_with("claude"),
        "openai" => {
            (l.starts_with("gpt-") || l.starts_with("chatgpt") || l == "chat-latest" || (l.starts_with('o') && l.chars().nth(1).map_or(false, |c| c.is_ascii_digit())))
                && !deny(&["audio", "realtime", "transcribe", "tts", "image", "embedding", "search", "moderation", "instruct", "codex", "computer-use", "deep-research"])
        }
        "groq" => {
            entry.get("active").and_then(Value::as_bool) != Some(false)
                && !deny(&["whisper", "tts", "orpheus", "guard", "safeguard", "distil", "playai"])
        }
        "gemini" => {
            let gen = entry
                .get("supportedGenerationMethods")
                .and_then(Value::as_array)
                .map(|m| m.iter().any(|x| x.as_str() == Some("generateContent")))
                .unwrap_or(true);
            gen && l.starts_with("gemini") && !deny(&["embedding", "aqa", "imagen", "tts", "image", "native-audio", "live", "robotics", "computer-use"])
        }
        _ => false,
    }
}

/// Reads a model list into the model ids worth offering for chat, suggested ones first.
pub fn parse_models(provider_id: &str, body: &str) -> Result<Value, String> {
    let p = need(provider_id)?;
    let v: Value = serde_json::from_str(body).map_err(|_| "Couldn't read the model list.".to_string())?;
    let list = v.get("data").or_else(|| v.get("models")).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut ids: Vec<(String, String)> = Vec::new();
    for entry in &list {
        let raw = entry.get("id").or_else(|| entry.get("name")).and_then(Value::as_str).unwrap_or("");
        let id = raw.trim_start_matches("models/").to_string();
        if id.is_empty() || !is_chat_model(p.id, &id, entry) || ids.iter().any(|x| x.0 == id) {
            continue;
        }
        let label = entry.get("display_name").or_else(|| entry.get("displayName")).and_then(Value::as_str).unwrap_or(&id).to_string();
        ids.push((id, label));
    }
    ids.sort_by(|a, b| {
        let ra = p.models.iter().position(|m| *m == a.0).unwrap_or(usize::MAX);
        let rb = p.models.iter().position(|m| *m == b.0).unwrap_or(usize::MAX);
        ra.cmp(&rb).then_with(|| b.0.cmp(&a.0))
    });
    Ok(Value::Array(ids.into_iter().map(|(id, label)| json!({ "id": id, "label": label })).collect()))
}

/// Trims a page's text to fit in a prompt, keeping whole paragraphs, and labels where it came from.
pub fn page_context(title: &str, url: &str, text: &str, limit: usize) -> String {
    let limit = limit.clamp(500, 60000);
    let mut body = String::new();
    let mut blank = false;
    for line in text.lines() {
        let l = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if l.is_empty() {
            blank = true;
            continue;
        }
        if body.len() + l.len() + 2 > limit {
            body.push_str("\n[…the rest of the page was cut to fit]");
            break;
        }
        if !body.is_empty() {
            body.push_str(if blank { "\n\n" } else { "\n" });
        }
        blank = false;
        body.push_str(&l);
    }
    format!("<page title=\"{}\" url=\"{}\">\n{}\n</page>", title.replace('"', "'"), url.replace('"', "%22"), body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_keys() {
        assert_eq!(detect_id("sk-ant-api03-abc"), Some("claude"));
        assert_eq!(detect_id("gsk_abc"), Some("groq"));
        assert_eq!(detect_id("AIzaSyAbc"), Some("gemini"));
        assert_eq!(detect_id("sk-proj-abc"), Some("openai"));
        assert_eq!(detect_id("hello"), None);
    }

    #[test]
    fn refuses_wrong_provider() {
        let v = validate_key("claude", "gsk_aaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(v["ok"], false);
        assert_eq!(v["suggest"], "groq");
        let ok = validate_key("groq", " gsk_aaaaaaaaaaaaaaaaaaaaaaaaaaaa ");
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["key"], "gsk_aaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    }

    #[test]
    fn masks() {
        assert_eq!(mask_key("sk-ant-api03-ABCDEFGHIJKLMNOP1234"), "sk-ant-api…1234");
        assert_eq!(mask_key("gsk_ABCDEFGHIJKLMNOP9876"), "gsk_…9876");
    }

    #[test]
    fn builds_claude() {
        let r = build_chat(&json!({ "provider": "claude", "key": "sk-ant-x", "system": "Be brief",
            "messages": [{ "role": "assistant", "content": "hi" }, { "role": "user", "content": "a" }, { "role": "user", "content": "b" }] })).unwrap();
        assert_eq!(r["url"], "https://api.anthropic.com/v1/messages");
        assert_eq!(r["headers"]["x-api-key"], "sk-ant-x");
        let body: Value = serde_json::from_str(r["body"].as_str().unwrap()).unwrap();
        assert_eq!(body["system"], "Be brief");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert_eq!(body["messages"][0]["content"], "a\n\nb");
    }

    #[test]
    fn builds_gemini_and_groq() {
        let g = build_chat(&json!({ "provider": "gemini", "key": "AIza", "model": "models/gemini-3.6-flash",
            "messages": [{ "role": "user", "content": "q" }, { "role": "assistant", "content": "a" }, { "role": "user", "content": "q2" }] })).unwrap();
        assert_eq!(g["url"], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse");
        let body: Value = serde_json::from_str(g["body"].as_str().unwrap()).unwrap();
        assert_eq!(body["contents"][1]["role"], "model");
        let q = build_chat(&json!({ "provider": "groq", "key": "gsk_x", "system": "s", "messages": [{ "role": "user", "content": "q" }] })).unwrap();
        assert_eq!(q["url"], "https://api.groq.com/openai/v1/chat/completions");
        assert_eq!(q["headers"]["authorization"], "Bearer gsk_x");
        assert!(build_chat(&json!({ "provider": "openai", "key": "sk-x", "model": "bad model!", "messages": [{ "role": "user", "content": "q" }] })).is_err());
    }

    #[test]
    fn streams() {
        let claude = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\nevent: ping\nda";
        let r = sse_feed("claude", claude).unwrap();
        assert_eq!(r["delta"], "Hello");
        assert_eq!(r["done"], true);
        assert_eq!(r["rest"], "event: ping\nda");
        let oa = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
        let r = sse_feed("openai", oa).unwrap();
        assert_eq!(r["delta"], "Hi");
        assert_eq!(r["done"], true);
        let gm = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Yo\"}]},\"finishReason\":\"STOP\"}]}\n\n";
        assert_eq!(sse_feed("gemini", gm).unwrap()["delta"], "Yo");
    }

    #[test]
    fn errors_read_well() {
        let m = explain_error("groq", 401, "{\"error\":{\"message\":\"Invalid API Key\"}}");
        assert!(m.starts_with("Groq rejected the API key"));
        let m = explain_error("claude", 404, "{\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",\"message\":\"model: x\"}}");
        assert!(m.contains("doesn't have that model") && m.contains("model: x"));
    }

    #[test]
    fn model_lists() {
        let body = "{\"data\":[{\"id\":\"whisper-large-v3\"},{\"id\":\"llama-3.1-8b-instant\"},{\"id\":\"llama-3.3-70b-versatile\"}]}";
        let v = parse_models("groq", body).unwrap();
        assert_eq!(v[0]["id"], "llama-3.3-70b-versatile");
        assert_eq!(v.as_array().unwrap().len(), 2);
        let g = "{\"models\":[{\"name\":\"models/gemini-3.6-flash\",\"displayName\":\"Gemini 3.6 Flash\",\"supportedGenerationMethods\":[\"generateContent\"]},{\"name\":\"models/text-embedding-004\",\"supportedGenerationMethods\":[\"embedContent\"]}]}";
        let v = parse_models("gemini", g).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["label"], "Gemini 3.6 Flash");
    }
}

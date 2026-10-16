//! Every setting a Lantern page can change is checked here before it's saved. Anything that
//! doesn't match is refused, so a page can never write an unexpected value into a profile.

use serde_json::{json, Value};

pub const THEME_COLORS: &[&str] = &["ember", "ocean", "forest", "grape", "rose", "teal", "graphite", "gold", "custom"];

fn boolean(v: &Value) -> Result<Value, String> {
    v.as_bool().map(Value::Bool).ok_or_else(|| "expected on or off".into())
}

fn one_of(v: &Value, options: &[&str]) -> Result<Value, String> {
    match v.as_str() {
        Some(s) if options.contains(&s) => Ok(json!(s)),
        _ => Err(format!("expected one of: {}", options.join(", "))),
    }
}

/// A web address that is safe to store: http(s) only, no spaces or control characters, a real host.
pub fn web_url(raw: &str, https_only: bool) -> Option<String> {
    let s = raw.trim();
    if s.len() > 2000 || s.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let lower = s.to_ascii_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("https://") {
        r
    } else if let Some(r) = lower.strip_prefix("http://") {
        if https_only {
            return None;
        }
        r
    } else {
        return None;
    };
    let host_port = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host_port.rsplit('@').next().unwrap_or("");
    if host_port.contains('@') {
        return None; // no user:password@ addresses
    }
    let host = host.split(':').next().unwrap_or("");
    let ok_host = host == "localhost"
        || (host.contains('.') && !host.starts_with('.') && !host.ends_with('.') && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'));
    if !ok_host {
        return None;
    }
    Some(s.to_string())
}

fn hex_colour(v: &Value) -> Result<Value, String> {
    let s = v.as_str().unwrap_or("");
    crate::theme::parse_hex(s).map(|rgb| json!(crate::theme::to_hex(rgb))).ok_or_else(|| "expected a colour like #3b82f6".into())
}

fn shortcuts(v: &Value) -> Result<Value, String> {
    let list = v.as_array().ok_or("expected a list")?;
    if list.len() > 12 {
        return Err("up to 12 shortcuts".into());
    }
    let mut out = Vec::new();
    for item in list {
        let title = item.get("title").and_then(Value::as_str).unwrap_or("").trim();
        let url = item.get("url").and_then(Value::as_str).unwrap_or("");
        if title.is_empty() || title.chars().count() > 40 {
            return Err("each shortcut needs a name of up to 40 characters".into());
        }
        let url = web_url(url, false).ok_or("each shortcut needs a web address starting with http:// or https://")?;
        out.push(json!({ "title": title, "url": url }));
    }
    Ok(Value::Array(out))
}

/// Checks one setting. Returns `{ok: true, value}` with the cleaned value, or `{ok: false, message}`.
pub fn validate(key: &str, v: &Value) -> Value {
    let r: Result<Value, String> = match key {
        "summaryMode" | "blockTrackers" | "httpsOnly" | "blockThirdPartyCookies" | "sendGpc" | "clearOnExit" | "memorySaver"
        | "safeBrowsing" | "downloadWarnings" | "showHomeButton" | "showShortcuts" | "toolbarSummary" | "toolbarShield"
        | "downloadsAsk" | "searchSuggestions" | "rememberSearches" | "bookmarksBar" | "showAiButton" | "saveHistory"
        | "aiIncludePage" | "inlineAutocomplete" | "showMailLink" => boolean(v),
        "searchEngine" => one_of(v, &["lantern", "duckduckgo", "brave", "startpage", "ecosia", "google", "bing"]),
        "camera" | "microphone" | "notifications" | "location" => one_of(v, &["ask", "block"]),
        "theme" => one_of(v, &["system", "light", "dark"]),
        "themeColor" => one_of(v, THEME_COLORS),
        "customAccent" => hex_colour(v),
        "ntpBackground" => match v.as_str() {
            Some(s) if ["glow", "none", "image"].contains(&s) => Ok(json!(s)),
            Some(s) if s.starts_with("color:") && crate::theme::parse_hex(&s[6..]).is_some() && s.len() == 13 => Ok(json!(s.to_ascii_lowercase())),
            _ => Err("expected glow, none, image or color:#rrggbb".into()),
        },
        "shortcuts" => shortcuts(v),
        "defaultZoom" => match v.as_f64() {
            Some(z) if [0.75, 0.9, 1.0, 1.1, 1.25, 1.5].iter().any(|x| (x - z).abs() < 1e-9) => Ok(json!(z)),
            _ => Err("expected 75% to 150%".into()),
        },
        "startup" => one_of(v, &["newtab", "continue", "url"]),
        "startupUrl" => match v.as_str() {
            Some("") => Ok(json!("")),
            Some(s) => web_url(s, false).map(Value::String).ok_or_else(|| "expected a web address".into()),
            None => Err("expected a web address".into()),
        },
        "mailService" => one_of(v, &crate::mail::IDS),
        "mailUrl" => match v.as_str() {
            Some("") => Ok(json!("")),
            Some(s) => web_url(s, true).map(Value::String).ok_or_else(|| "use a secure address that starts with https://".into()),
            None => Err("expected a web address".into()),
        },
        _ => Err(format!("\"{key}\" isn't a setting")),
    };
    match r {
        Ok(value) => json!({ "ok": true, "value": value }),
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

/// The settings this core knows how to check (used by tests to keep JS and Rust in step).
pub fn keys() -> Value {
    json!([
        "summaryMode", "blockTrackers", "httpsOnly", "blockThirdPartyCookies", "sendGpc", "clearOnExit", "memorySaver", "safeBrowsing",
        "downloadWarnings", "showHomeButton", "showShortcuts", "toolbarSummary", "toolbarShield", "downloadsAsk", "searchSuggestions",
        "rememberSearches", "bookmarksBar", "showAiButton", "saveHistory", "aiIncludePage", "inlineAutocomplete", "showMailLink",
        "searchEngine", "camera", "microphone", "notifications", "location", "theme", "themeColor", "customAccent", "ntpBackground",
        "shortcuts", "defaultZoom", "startup", "startupUrl", "mailService", "mailUrl"
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks() {
        assert_eq!(validate("memorySaver", &json!(true))["ok"], true);
        assert_eq!(validate("memorySaver", &json!("yes"))["ok"], false);
        assert_eq!(validate("themeColor", &json!("custom"))["ok"], true);
        assert_eq!(validate("customAccent", &json!("#ABC"))["value"], "#aabbcc");
        assert_eq!(validate("mailUrl", &json!("http://mail.example.com"))["ok"], false);
        assert_eq!(validate("mailUrl", &json!("https://mail.example.com/inbox"))["ok"], true);
        assert_eq!(validate("mailUrl", &json!("https://user@evil.com"))["ok"], false);
        assert_eq!(validate("mailUrl", &json!("javascript:alert(1)"))["ok"], false);
        assert_eq!(validate("defaultZoom", &json!(1.25))["ok"], true);
        assert_eq!(validate("nope", &json!(1))["ok"], false);
        assert_eq!(validate("shortcuts", &json!([{ "title": "A", "url": "https://a.com" }]))["ok"], true);
        assert_eq!(validate("ntpBackground", &json!("color:#AABBCC"))["value"], "color:#aabbcc");
    }
}

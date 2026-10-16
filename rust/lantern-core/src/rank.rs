//! Ranks history and bookmarks for the address bar and the History page, the way Chrome's
//! omnibox does: how well the words match (start of the site name beats the middle of a title),
//! how often and how recently you visited, and whether it's bookmarked. It also works out the
//! inline completion, so typing "wik" can complete to "wikipedia.org".

use serde_json::{json, Value};

fn strip_scheme(url: &str) -> &str {
    let u = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).unwrap_or(url);
    u.strip_prefix("www.").unwrap_or(u)
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

struct Scored {
    index: usize,
    score: f64,
    inline: Option<String>,
}

/// args: { query, items: [{ title, url, visits, last, bookmark }], now, limit }
pub fn rank(a: &Value) -> Value {
    let query = a.get("query").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    let now = a.get("now").and_then(Value::as_f64).unwrap_or(0.0);
    let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(8).clamp(1, 500) as usize;
    let items = a.get("items").and_then(Value::as_array).map(|x| x.as_slice()).unwrap_or(&[]);
    let terms: Vec<&str> = query.split_whitespace().collect();
    let mut out: Vec<Scored> = Vec::new();

    for (index, item) in items.iter().enumerate() {
        let url = item.get("url").and_then(Value::as_str).unwrap_or("");
        let title = item.get("title").and_then(Value::as_str).unwrap_or("");
        if url.is_empty() {
            continue;
        }
        let bare = strip_scheme(url).to_lowercase();
        let host = bare.split(['/', '?', '#']).next().unwrap_or("").to_string();
        let path = &bare[host.len()..];
        let title_l = title.to_lowercase();
        let title_words = words(title);

        let mut matched = 0.0;
        let mut all = true;
        for t in &terms {
            let s = if host.starts_with(t) {
                30.0
            } else if host.split('.').any(|label| label.starts_with(t)) {
                18.0
            } else if title_words.iter().any(|w| w.starts_with(t)) {
                14.0
            } else if path.contains(t) {
                6.0
            } else if title_l.contains(t) || host.contains(t) {
                5.0
            } else {
                0.0
            };
            if s == 0.0 {
                all = false;
                break;
            }
            matched += s;
        }
        if !all {
            continue;
        }

        let mut inline = None;
        if terms.len() == 1 && !query.contains(' ') && !query.is_empty() {
            let full = bare.trim_end_matches('/');
            if host.starts_with(&query) && host.len() > query.len() {
                inline = Some(host[query.len()..].to_string());
                matched += 40.0;
            } else if full.starts_with(&query) && full.len() > query.len() {
                inline = Some(full[query.len()..].to_string());
                matched += 30.0;
            }
        }

        let visits = item.get("visits").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
        let last = item.get("last").and_then(Value::as_f64).unwrap_or(0.0);
        let days = if now > 0.0 && last > 0.0 { ((now - last) / 86_400_000.0).max(0.0) } else { 365.0 };
        let recency = 20.0 * 0.5f64.powf(days / 7.0);
        let frequency = (1.0 + visits).ln() * 8.0;
        let bookmark = if item.get("bookmark").and_then(Value::as_bool).unwrap_or(false) { 15.0 } else { 0.0 };
        // Short addresses (home pages) are usually what people mean when they type a site name.
        let brevity = if path.len() <= 1 { 6.0 } else { 0.0 };
        let score = if terms.is_empty() { recency + frequency + bookmark } else { matched + recency + frequency + bookmark + brevity };
        out.push(Scored { index, score, inline });
    }

    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.index.cmp(&b.index)));
    out.truncate(limit);
    Value::Array(
        out.into_iter()
            .map(|s| json!({ "i": s.index, "score": (s.score * 100.0).round() / 100.0, "inline": s.inline }))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_site_names_first() {
        let r = rank(&json!({
            "query": "wik", "now": 1_000_000_000_000.0, "limit": 5,
            "items": [
                { "title": "Talk about wikis", "url": "https://blog.example.com/wikis", "visits": 9, "last": 1_000_000_000_000.0 },
                { "title": "Wikipedia", "url": "https://www.wikipedia.org/", "visits": 2, "last": 999_000_000_000.0 },
                { "title": "Nothing", "url": "https://example.org/" }
            ]
        }));
        assert_eq!(r[0]["i"], 1);
        assert_eq!(r[0]["inline"], "ipedia.org");
        assert_eq!(r.as_array().unwrap().len(), 2);
    }

    #[test]
    fn all_words_must_match() {
        let r = rank(&json!({ "query": "rust book", "items": [
            { "title": "The Rust Programming Language", "url": "https://doc.rust-lang.org/book/" },
            { "title": "Rust", "url": "https://rust-lang.org/" }
        ] }));
        assert_eq!(r.as_array().unwrap().len(), 1);
        assert_eq!(r[0]["i"], 0);
    }
}

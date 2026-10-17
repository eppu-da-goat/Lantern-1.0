//! Lantern Search's ranking. Results arrive from several independent sources (your own page index,
//! Wikipedia, Mwmbl, Marginalia, and Brave or Mojeek if you add a key). This module merges them
//! into one list: the same page found by several sources counts once and ranks higher, titles and
//! snippets are matched against your words, and no single site is allowed to fill the top.
//! Pure computation: nothing here touches the network.

use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// Reciprocal-rank-fusion constant: how quickly lower positions in a source count for less.
const K: f64 = 12.0;

struct Hit {
    url: String,
    title: String,
    snippet: String,
    host: String,
    score: f64,
    sources: Vec<String>,
    first: usize,
}

/// The page's identity for de-duplication: no scheme, no `www.`, no fragment, no trailing slash,
/// and no tracking parameters.
pub fn url_key(url: &str) -> String {
    let cleaned = crate::cleanurl::clean(url);
    let u = cleaned.get("url").and_then(Value::as_str).unwrap_or(url);
    let mut k = u.trim().to_ascii_lowercase();
    if let Some(i) = k.find('#') { k.truncate(i); }
    for p in ["https://", "http://"] { if let Some(r) = k.strip_prefix(p) { k = r.to_string(); } }
    if let Some(r) = k.strip_prefix("www.") { k = r.to_string(); }
    if let Some(r) = k.strip_prefix("m.") { if r.contains("wikipedia.org") { k = r.to_string(); } }
    while k.ends_with('/') { k.pop(); }
    k
}

pub fn host_of(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let h = rest.split(['/', '?', '#']).next().unwrap_or("");
    let h = h.rsplit('@').next().unwrap_or(h);
    let h = h.split(':').next().unwrap_or(h).to_ascii_lowercase();
    h.strip_prefix("www.").map(str::to_string).unwrap_or(h)
}

/// "news.bbc.co.uk" -> "bbc.co.uk", "en.wikipedia.org" -> "wikipedia.org".
pub fn site_of(host: &str) -> String {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() <= 2 { return host.to_string(); }
    let two = parts[parts.len() - 2..].join(".");
    let second = parts[parts.len() - 2];
    if ["co", "com", "org", "net", "gov", "ac", "edu", "nic"].contains(&second) && parts[parts.len() - 1].len() == 2 {
        parts[parts.len() - 3..].join(".")
    } else {
        two
    }
}

fn words(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in text.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
        if w.chars().count() > 1 && !STOP.contains(&w) && !out.iter().any(|x| x == w) { out.push(w.to_string()); }
    }
    out
}
const STOP: &[&str] = &["the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are", "what", "how", "why", "with", "by", "at", "from", "me", "my"];

fn clean(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c { '<' => in_tag = true, '>' if in_tag => in_tag = false, _ if !in_tag => out.push(c), _ => {} }
    }
    let out = out.replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Merge result lists from several sources.
///
/// args: `{ query, lists: [{ source, weight, results: [{ url, title, snippet }] }], seen: [url keys], limit }`
/// returns `[{ url, title, snippet, host, sources: [..], score }]`
pub fn fuse(args: &Value) -> Value {
    let query = args.get("query").and_then(Value::as_str).unwrap_or("");
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(30) as usize;
    let seen: HashSet<String> = args.get("seen").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(url_key).collect()).unwrap_or_default();
    let qwords = words(query);
    let compact: String = query.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();

    let mut hits: Vec<Hit> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut order = 0usize;
    for list in args.get("lists").and_then(Value::as_array).into_iter().flatten() {
        let source = list.get("source").and_then(Value::as_str).unwrap_or("web").to_string();
        let weight = list.get("weight").and_then(Value::as_f64).unwrap_or(1.0).clamp(0.0, 3.0);
        for (i, r) in list.get("results").and_then(Value::as_array).into_iter().flatten().enumerate() {
            let url = r.get("url").and_then(Value::as_str).unwrap_or("").trim();
            if !(url.starts_with("https://") || url.starts_with("http://")) { continue; }
            let key = url_key(url);
            if key.is_empty() || seen.contains(&key) { continue; }
            let title = clean(r.get("title").and_then(Value::as_str).unwrap_or(""));
            let snippet = clean(r.get("snippet").and_then(Value::as_str).unwrap_or(""));
            let add = weight / (K + i as f64);
            match index.get(&key) {
                Some(&j) => {
                    let h = &mut hits[j];
                    h.score += add;
                    if !h.sources.contains(&source) { h.sources.push(source.clone()); }
                    if h.title.is_empty() && !title.is_empty() { h.title = title; }
                    if snippet.len() > h.snippet.len() && snippet.len() < 400 { h.snippet = snippet; }
                }
                None => {
                    index.insert(key, hits.len());
                    hits.push(Hit { host: host_of(url), url: url.to_string(), title, snippet, score: add, sources: vec![source.clone()], first: order });
                    order += 1;
                }
            }
        }
    }

    for h in hits.iter_mut() {
        let t = h.title.to_lowercase();
        let sn = h.snippet.to_lowercase();
        let site = site_of(&h.host);
        let site_name = site.split('.').next().unwrap_or("");
        if !qwords.is_empty() {
            let n = qwords.len() as f64;
            let in_title = qwords.iter().filter(|w| t.contains(w.as_str())).count() as f64;
            let in_snip = qwords.iter().filter(|w| sn.contains(w.as_str())).count() as f64;
            let in_host = qwords.iter().filter(|w| h.host.contains(w.as_str())).count() as f64;
            h.score += 0.020 * in_title / n + 0.008 * in_snip / n + 0.010 * in_host / n;
        }
        // Navigational searches: "github", "kerala tourism" -> the site itself first.
        if !compact.is_empty() && (site_name == compact || site.replace('.', "") == compact) {
            h.score += 0.08;
            if h.url.trim_end_matches('/').matches('/').count() <= 2 { h.score += 0.04; }
        }
        if h.sources.len() > 1 { h.score += 0.006 * (h.sources.len() - 1) as f64; }
        if site == "wikipedia.org" { h.score += 0.004; }
        let tld2 = h.host.rsplit('.').nth(1).unwrap_or("");
        if h.host.ends_with(".gov") || h.host.ends_with(".edu") || h.host.ends_with(".gov.in") || h.host.ends_with(".nic.in") || (tld2 == "ac" || tld2 == "gov") { h.score += 0.004; }
        if ["pinterest.com", "quora.com", "medium.com"].contains(&site.as_str()) { h.score -= 0.006; }
        if h.title.is_empty() { h.score -= 0.01; }
        if h.url.len() > 160 { h.score -= 0.003; }
    }

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.first.cmp(&b.first)));

    // At most two results per site among the first ones; the rest move down.
    let mut per_site: HashMap<String, usize> = HashMap::new();
    let (mut top, mut later) = (Vec::new(), Vec::new());
    for h in hits {
        let site = site_of(&h.host);
        let n = per_site.entry(site).or_insert(0);
        *n += 1;
        if *n <= 2 { top.push(h) } else { later.push(h) }
    }
    top.extend(later);
    let out: Vec<Value> = top.into_iter().take(limit).map(|h| {
        let mut m = Map::new();
        m.insert("url".into(), json!(h.url));
        m.insert("title".into(), json!(if h.title.is_empty() { h.host.clone() } else { h.title }));
        m.insert("snippet".into(), json!(h.snippet));
        m.insert("host".into(), json!(h.host));
        m.insert("sources".into(), json!(h.sources));
        m.insert("score".into(), json!((h.score * 10000.0).round() / 10000.0));
        Value::Object(m)
    }).collect();
    Value::Array(out)
}

/// Turns what you typed into a safe SQLite FTS5 query for the local page index:
/// each word becomes a quoted prefix term, all of which must match.
pub fn fts_query(query: &str) -> Value {
    let terms: Vec<String> = query.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).take(12).map(|w| format!("\"{w}\"*")).collect();
    json!({ "all": terms.join(" "), "any": terms.join(" OR ") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_and_ranks() {
        let r = fuse(&json!({
            "query": "kerala backwaters",
            "lists": [
                { "source": "mwmbl", "weight": 0.9, "results": [
                    { "url": "https://www.pinterest.com/x", "title": "pins", "snippet": "" },
                    { "url": "https://en.wikipedia.org/wiki/Kerala_backwaters", "title": "<b>Kerala</b> backwaters", "snippet": "The Kerala backwaters are a network" }
                ]},
                { "source": "wikipedia", "weight": 1.0, "results": [
                    { "url": "https://en.wikipedia.org/wiki/Kerala_backwaters#History", "title": "Kerala backwaters", "snippet": "" }
                ]}
            ]
        }));
        let a = r.as_array().unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(a[0]["host"], "en.wikipedia.org");
        assert_eq!(a[0]["title"], "Kerala backwaters");
        assert_eq!(a[0]["sources"], json!(["mwmbl", "wikipedia"]));
    }

    #[test]
    fn navigational_and_diversity() {
        let r = fuse(&json!({
            "query": "github",
            "lists": [{ "source": "x", "weight": 1.0, "results": [
                { "url": "https://blog.example.com/github-tips", "title": "GitHub tips" },
                { "url": "https://docs.example.com/a", "title": "a" },
                { "url": "https://example.com/b", "title": "b" },
                { "url": "https://github.com/", "title": "GitHub" }
            ]}]
        }));
        let a = r.as_array().unwrap();
        assert_eq!(a[0]["url"], "https://github.com/");
        // three example.com pages: the third one is pushed below the others
        assert_eq!(a[3]["host"], "example.com");
    }

    #[test]
    fn seen_and_keys() {
        assert_eq!(url_key("https://www.Example.com/a/?utm_source=x#top"), "example.com/a");
        let r = fuse(&json!({ "query": "a", "seen": ["https://example.com/a"], "lists": [{ "source": "x", "results": [{ "url": "http://example.com/a/", "title": "A" }, { "url": "javascript:alert(1)", "title": "bad" }] }] }));
        assert_eq!(r.as_array().unwrap().len(), 0);
        assert_eq!(site_of("news.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(site_of("keralatourism.gov.in"), "keralatourism.gov.in");
        assert_eq!(fts_query("Kerala \"boat\" race!")["all"], "\"kerala\"* \"boat\"* \"race\"*");
    }
}

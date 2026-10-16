//! Removes tracking parameters (utm_source, fbclid, gclid…) from web addresses before a page
//! loads, and for "Copy clean link". Everything else in the address is kept exactly as it was.

use serde_json::{json, Value};

/// Parameters that only exist to track where a click came from.
const EXACT: &[&str] = &[
    "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "ttclid", "twclid", "li_fat_id", "igshid",
    "igsh", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking", "mkt_tok", "oly_anon_id",
    "oly_enc_id", "vero_id", "vero_conv", "wickedid", "rb_clickid", "s_cid", "_openstat", "epik", "ncid", "sr_share", "ref_src",
    "ref_url", "spm", "scm", "trk", "trkcampaign", "gs_lcrp", "ved", "ei", "sxsrf", "sca_esv", "srsltid", "_ga", "_gl", "_kx",
    "cvid", "zanpid", "irclickid", "irgwc", "at_recipient_id", "at_recipient_list", "pk_campaign", "pk_kwd", "piwik_campaign",
    "piwik_kwd", "matomo_campaign", "mtm_campaign", "mtm_source", "mtm_medium", "mtm_content", "mtm_cid", "mtm_keyword", "wt_mc",
    "wt_zmc", "ns_mchannel", "ns_source", "ns_campaign", "ns_linkname", "ns_fee", "obOrigUrl", "obClickId", "guccounter",
    "guce_referrer", "guce_referrer_sig", "bbeml", "cmpid", "ito", "smid", "cid_source",
];
/// Parameter name prefixes used by campaign trackers.
const PREFIXES: &[&str] = &["utm_", "hmb_", "pk_", "mtm_", "itm_", "stm_", "ga_", "__s"];
/// Parameters that are tracking only on particular sites (they mean something elsewhere).
const BY_SITE: &[(&str, &[&str])] = &[
    ("youtube.com", &["si", "feature", "pp"]),
    ("youtu.be", &["si", "feature"]),
    ("spotify.com", &["si", "context"]),
    ("amazon.", &["ref", "ref_", "pf_rd_r", "pf_rd_p", "pf_rd_s", "pf_rd_t", "pf_rd_i", "pf_rd_m", "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pd_rd_i", "crid", "sprefix", "dib", "dib_tag", "qid", "sr", "content-id", "linkCode", "tag", "linkId"]),
    ("twitter.com", &["s", "t"]),
    ("x.com", &["s", "t"]),
    ("instagram.com", &["igsh", "img_index"]),
    ("linkedin.com", &["trackingId", "refId", "lipi", "midToken", "midSig", "trk", "trkEmail"]),
    ("reddit.com", &["share_id", "rdt"]),
    ("tiktok.com", &["_r", "_t", "is_from_webapp", "sender_device", "sender_web_id"]),
    ("facebook.com", &["mibextid", "__tn__", "__cft__"]),
    ("aliexpress.", &["spm", "scm", "algo_pvid", "algo_exp_id", "pdp_npi", "pdp_ext_f", "aff_platform", "sk", "aff_trace_key"]),
    ("flipkart.com", &["otracker", "otracker1", "lid", "marketplace", "store", "srno", "iid", "ssid", "qH", "fm"]),
];

fn host_of(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host_port = rest.split(['/', '?', '#']).next()?;
    let host = host_port.rsplit('@').next()?;
    Some(host.split(':').next().unwrap_or(host))
}

fn site_matches(host: &str, pattern: &str) -> bool {
    let host = host.trim_start_matches("www.").trim_start_matches("m.");
    if pattern.ends_with('.') {
        // "amazon." matches amazon.com, amazon.co.uk, amazon.in…
        host.starts_with(pattern) || host.contains(&format!(".{pattern}"))
    } else {
        host == pattern || host.ends_with(&format!(".{pattern}"))
    }
}

fn is_tracking(name: &str, host: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if EXACT.iter().any(|p| p.eq_ignore_ascii_case(&lower)) || PREFIXES.iter().any(|p| lower.starts_with(p)) {
        return true;
    }
    BY_SITE.iter().any(|(site, names)| site_matches(host, site) && names.iter().any(|n| *n == name))
}

/// Returns `{url, removed: [names]}`. The address is unchanged when nothing was removed.
pub fn clean(url: &str) -> Value {
    let Some(host) = host_of(url).map(|h| h.to_ascii_lowercase()) else {
        return json!({ "url": url, "removed": [] });
    };
    let (before_hash, hash) = match url.find('#') {
        Some(i) => (&url[..i], &url[i..]),
        None => (url, ""),
    };
    let Some(q) = before_hash.find('?') else {
        return json!({ "url": url, "removed": [] });
    };
    let (path, query) = (&before_hash[..q], &before_hash[q + 1..]);
    let mut kept: Vec<&str> = Vec::new();
    let mut removed: Vec<String> = Vec::new();
    for part in query.split('&') {
        if part.is_empty() {
            continue;
        }
        let name = part.split('=').next().unwrap_or("");
        if is_tracking(name, &host) {
            removed.push(name.to_string());
        } else {
            kept.push(part);
        }
    }
    if removed.is_empty() {
        return json!({ "url": url, "removed": [] });
    }
    let mut out = path.to_string();
    if !kept.is_empty() {
        out.push('?');
        out.push_str(&kept.join("&"));
    }
    out.push_str(hash);
    json!({ "url": out, "removed": removed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_trackers_keeps_the_rest() {
        let r = clean("https://example.com/a?id=5&utm_source=x&utm_medium=y&fbclid=abc#top");
        assert_eq!(r["url"], "https://example.com/a?id=5#top");
        assert_eq!(r["removed"].as_array().unwrap().len(), 3);
        assert_eq!(clean("https://example.com/?gclid=1")["url"], "https://example.com/");
        assert_eq!(clean("https://youtu.be/abc?si=xyz&t=30")["url"], "https://youtu.be/abc?t=30");
        // "si" means something on other sites, so it stays there
        assert_eq!(clean("https://example.com/?si=1")["url"], "https://example.com/?si=1");
        assert_eq!(clean("https://www.amazon.in/dp/B0?ref_=x&th=1")["url"], "https://www.amazon.in/dp/B0?th=1");
        assert_eq!(clean("https://a.com/p?q=hello%20world")["url"], "https://a.com/p?q=hello%20world");
        assert_eq!(clean("lantern://app/search.html?q=utm_source")["removed"].as_array().unwrap().len(), 0);
    }
}

//! The Mail link at the top right of Lantern Search and the New Tab page. It opens whichever
//! web mail the user picked, or any web mail address they type in.

use serde_json::{json, Value};

pub const IDS: [&str; 9] = ["gmail", "outlook", "proton", "yahoo", "icloud", "zoho", "fastmail", "custom", "off"];

const SERVICES: &[(&str, &str, &str)] = &[
    ("gmail", "Gmail", "https://mail.google.com/mail/u/0/"),
    ("outlook", "Outlook", "https://outlook.live.com/mail/"),
    ("proton", "Proton Mail", "https://mail.proton.me/"),
    ("yahoo", "Yahoo Mail", "https://mail.yahoo.com/"),
    ("icloud", "iCloud Mail", "https://www.icloud.com/mail"),
    ("zoho", "Zoho Mail", "https://mail.zoho.com/"),
    ("fastmail", "Fastmail", "https://app.fastmail.com/"),
];

pub fn services() -> Value {
    let mut list: Vec<Value> = SERVICES.iter().map(|(id, name, url)| json!({ "id": id, "name": name, "url": url })).collect();
    list.push(json!({ "id": "custom", "name": "Your own web mail", "url": null }));
    list.push(json!({ "id": "off", "name": "Don't show a Mail link", "url": null }));
    Value::Array(list)
}

/// Where the Mail link goes. `custom` must be a secure https address.
pub fn url(service: &str, custom: &str) -> Result<Value, String> {
    if service == "off" {
        return Ok(json!({ "url": null, "name": null, "host": null }));
    }
    if service == "custom" {
        let u = crate::settings::web_url(custom, true).ok_or("Type the web address of your mail, starting with https://")?;
        let host = u.split("://").nth(1).and_then(|r| r.split(['/', '?', '#']).next()).unwrap_or("").to_string();
        return Ok(json!({ "url": u, "name": "Mail", "host": host }));
    }
    let (_, name, u) = SERVICES.iter().find(|(id, _, _)| *id == service).or_else(|| SERVICES.first()).unwrap();
    let host = u.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or("");
    Ok(json!({ "url": u, "name": name, "host": host }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        assert_eq!(url("proton", "").unwrap()["url"], "https://mail.proton.me/");
        assert_eq!(url("custom", "https://webmail.me.org/").unwrap()["host"], "webmail.me.org");
        assert!(url("custom", "ftp://x").is_err());
        assert_eq!(url("off", "").unwrap()["url"], Value::Null);
    }
}

//! QR codes for "Share this page", drawn as a small SVG so they stay sharp at any size.

use qrcode::{Color, EcLevel, QrCode};
use serde_json::{json, Value};

fn colour(c: &str, fallback: &str) -> String {
    match crate::theme::parse_hex(c) {
        Some(rgb) => crate::theme::to_hex(rgb),
        None => fallback.to_string(),
    }
}

pub fn svg(text: &str, dark: &str, light: &str) -> Result<Value, String> {
    if text.is_empty() {
        return Err("Nothing to encode.".into());
    }
    if text.len() > 2000 {
        return Err("That address is too long for a QR code.".into());
    }
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M).map_err(|e| format!("Couldn't make a QR code: {e}"))?;
    let w = code.width();
    let colors = code.to_colors();
    let quiet = 4;
    let size = w + quiet * 2;
    let mut path = String::new();
    for y in 0..w {
        let mut x = 0;
        while x < w {
            if colors[y * w + x] == Color::Dark {
                let start = x;
                while x < w && colors[y * w + x] == Color::Dark {
                    x += 1;
                }
                path.push_str(&format!("M{} {}h{}v1h-{}z", start + quiet, y + quiet, x - start, x - start));
            } else {
                x += 1;
            }
        }
    }
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\" shape-rendering=\"crispEdges\"><rect width=\"{size}\" height=\"{size}\" fill=\"{}\"/><path d=\"{path}\" fill=\"{}\"/></svg>",
        colour(light, "#ffffff"),
        colour(dark, "#000000"),
    );
    Ok(json!({ "svg": svg, "modules": w }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn makes_svg() {
        let v = super::svg("https://example.com/", "", "").unwrap();
        assert!(v["svg"].as_str().unwrap().starts_with("<svg"));
        assert!(v["modules"].as_u64().unwrap() >= 21);
    }
}

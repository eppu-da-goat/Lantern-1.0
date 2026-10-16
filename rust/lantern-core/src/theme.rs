//! Custom theme colours. Any colour the user picks becomes a full palette for light and dark mode,
//! adjusted until text and highlights stay readable (WCAG contrast) on Lantern's backgrounds.

use serde_json::{json, Value};

const LIGHT_BG: (f64, f64, f64) = (0xfb as f64 / 255.0, 0xfb as f64 / 255.0, 0xfd as f64 / 255.0);
const DARK_BG: (f64, f64, f64) = (0x0a as f64 / 255.0, 0x0b as f64 / 255.0, 0x0e as f64 / 255.0);

pub fn parse_hex(hex: &str) -> Option<(f64, f64, f64)> {
    let h = hex.trim().trim_start_matches('#');
    let h = if h.len() == 3 { h.chars().flat_map(|c| [c, c]).collect::<String>() } else { h.to_string() };
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let n = u32::from_str_radix(&h, 16).ok()?;
    Some((((n >> 16) & 255) as f64 / 255.0, ((n >> 8) & 255) as f64 / 255.0, (n & 255) as f64 / 255.0))
}

pub fn to_hex((r, g, b): (f64, f64, f64)) -> String {
    let c = |x: f64| (x.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", c(r), c(g), c(b))
}

fn rgb_to_hsl((r, g, b): (f64, f64, f64)) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-9 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

fn hsl_to_rgb((h, s, l): (f64, f64, f64)) -> (f64, f64, f64) {
    let h = ((h % 360.0) + 360.0) % 360.0 / 360.0;
    if s <= 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0))
}

fn luminance((r, g, b): (f64, f64, f64)) -> f64 {
    let ch = |c: f64| if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

pub fn contrast(a: (f64, f64, f64), b: (f64, f64, f64)) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

/// Moves lightness until the colour reaches `target` contrast against `bg`.
fn readable(hsl: (f64, f64, f64), bg: (f64, f64, f64), target: f64, darker: bool) -> (f64, f64, f64) {
    let (h, s, mut l) = hsl;
    for _ in 0..100 {
        if contrast(hsl_to_rgb((h, s, l)), bg) >= target {
            break;
        }
        l = if darker { (l - 0.01).max(0.0) } else { (l + 0.01).min(1.0) };
    }
    (h, s, l)
}

fn variant(base: (f64, f64, f64), bg: (f64, f64, f64), dark: bool) -> Value {
    let (h, s, l) = base;
    let s = s.max(0.0);
    let accent = readable((h, s, if dark { l.max(0.55) } else { l.min(0.5) }), bg, 4.5, !dark);
    let accent2 = readable(((h + 18.0) % 360.0, (s * 1.05).min(1.0), accent.2), bg, 3.0, !dark);
    let glow_a = (h - 8.0, (s * 0.9).min(0.95), if dark { 0.72 } else { 0.76 });
    let glow_b = (h + 14.0, s.min(0.9), if dark { 0.6 } else { 0.64 });
    let accent_rgb = hsl_to_rgb(accent);
    let on_accent = if contrast(accent_rgb, (1.0, 1.0, 1.0)) >= contrast(accent_rgb, (0.08, 0.09, 0.11)) { "#ffffff" } else { "#15171c" };
    json!({
        "accent": to_hex(accent_rgb),
        "accent2": to_hex(hsl_to_rgb(accent2)),
        "glowA": to_hex(hsl_to_rgb(glow_a)),
        "glowB": to_hex(hsl_to_rgb(glow_b)),
        "onAccent": on_accent,
        "contrast": (contrast(accent_rgb, bg) * 100.0).round() / 100.0,
    })
}

/// A light and a dark palette from one picked colour.
pub fn palette(hex: &str) -> Result<Value, String> {
    let rgb = parse_hex(hex).ok_or_else(|| format!("\"{hex}\" isn't a colour. Use a hex code like #3b82f6."))?;
    let hsl = rgb_to_hsl(rgb);
    Ok(json!({
        "base": to_hex(rgb),
        "light": variant(hsl, LIGHT_BG, false),
        "dark": variant(hsl, DARK_BG, true),
        "gray": hsl.1 < 0.08,
    }))
}

pub fn contrast_json(a: &str, b: &str) -> Result<Value, String> {
    let x = parse_hex(a).ok_or("first colour isn't valid")?;
    let y = parse_hex(b).ok_or("second colour isn't valid")?;
    Ok(json!((contrast(x, y) * 100.0).round() / 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palettes_are_readable() {
        for hex in ["#ffff00", "#00ff88", "#0000ff", "#777777", "#ff0000", "#fff"] {
            let p = palette(hex).unwrap();
            let l = parse_hex(p["light"]["accent"].as_str().unwrap()).unwrap();
            let d = parse_hex(p["dark"]["accent"].as_str().unwrap()).unwrap();
            assert!(contrast(l, LIGHT_BG) >= 4.5, "{hex} light");
            assert!(contrast(d, DARK_BG) >= 4.5, "{hex} dark");
        }
        assert!(palette("blue").is_err());
    }
}

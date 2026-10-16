//! !bangs: type `!w lanterns` or `lanterns !w` in the address bar to search a site directly.
//! Everything is resolved here, on the device; the query goes straight to the site you named.
//! Your own bangs (from Settings) are checked first, so you can override any built-in one.

use serde_json::{json, Value};

/// (triggers, site name, category, URL template with `{q}` for the search terms)
pub const BUILTIN: &[(&[&str], &str, &str, &str)] = &[
    // General search
    (&["g", "google"], "Google", "search", "https://www.google.com/search?q={q}"),
    (&["ddg", "d", "duckduckgo"], "DuckDuckGo", "search", "https://duckduckgo.com/?q={q}"),
    (&["b", "bing"], "Bing", "search", "https://www.bing.com/search?q={q}"),
    (&["br", "brave"], "Brave Search", "search", "https://search.brave.com/search?q={q}"),
    (&["sp", "startpage"], "Startpage", "search", "https://www.startpage.com/do/search?q={q}"),
    (&["eco", "ecosia"], "Ecosia", "search", "https://www.ecosia.org/search?q={q}"),
    (&["k", "kagi"], "Kagi", "search", "https://kagi.com/search?q={q}"),
    (&["qw", "qwant"], "Qwant", "search", "https://www.qwant.com/?q={q}"),
    (&["mj", "mojeek"], "Mojeek", "search", "https://www.mojeek.com/search?q={q}"),
    (&["yd", "yandex"], "Yandex", "search", "https://yandex.com/search/?text={q}"),
    (&["gi", "images", "img"], "Google Images", "search", "https://www.google.com/search?tbm=isch&q={q}"),
    (&["gn", "news"], "Google News", "news", "https://news.google.com/search?q={q}"),
    (&["gs", "scholar"], "Google Scholar", "research", "https://scholar.google.com/scholar?q={q}"),
    (&["gt", "translate"], "Google Translate", "tools", "https://translate.google.com/?sl=auto&tl=en&text={q}"),
    (&["deepl"], "DeepL", "tools", "https://www.deepl.com/translator#auto/en/{q}"),
    // Knowledge
    (&["w", "wiki", "wikipedia"], "Wikipedia", "knowledge", "https://en.wikipedia.org/wiki/Special:Search?search={q}"),
    (&["wd", "wikidata"], "Wikidata", "knowledge", "https://www.wikidata.org/w/index.php?search={q}"),
    (&["wt", "wiktionary"], "Wiktionary", "knowledge", "https://en.wiktionary.org/wiki/Special:Search?search={q}"),
    (&["wq", "wikiquote"], "Wikiquote", "knowledge", "https://en.wikiquote.org/wiki/Special:Search?search={q}"),
    (&["wv", "wikivoyage"], "Wikivoyage", "travel", "https://en.wikivoyage.org/wiki/Special:Search?search={q}"),
    (&["wc", "commons"], "Wikimedia Commons", "media", "https://commons.wikimedia.org/w/index.php?search={q}"),
    (&["wa", "wolfram"], "Wolfram|Alpha", "knowledge", "https://www.wolframalpha.com/input?i={q}"),
    (&["brit", "britannica"], "Britannica", "knowledge", "https://www.britannica.com/search?query={q}"),
    (&["def", "define", "dict"], "Merriam-Webster", "knowledge", "https://www.merriam-webster.com/dictionary/{q}"),
    (&["cam", "cambridge"], "Cambridge Dictionary", "knowledge", "https://dictionary.cambridge.org/search/english/direct/?q={q}"),
    (&["thes", "thesaurus"], "Thesaurus.com", "knowledge", "https://www.thesaurus.com/browse/{q}"),
    (&["ud", "urban"], "Urban Dictionary", "knowledge", "https://www.urbandictionary.com/define.php?term={q}"),
    (&["etym", "etymology"], "Etymonline", "knowledge", "https://www.etymonline.com/search?q={q}"),
    (&["arxiv"], "arXiv", "research", "https://arxiv.org/search/?query={q}&searchtype=all"),
    (&["pubmed", "pm"], "PubMed", "research", "https://pubmed.ncbi.nlm.nih.gov/?term={q}"),
    (&["ss", "semantic"], "Semantic Scholar", "research", "https://www.semanticscholar.org/search?q={q}"),
    (&["ia", "archive"], "Internet Archive", "knowledge", "https://archive.org/search?query={q}"),
    (&["wb", "wayback"], "Wayback Machine", "knowledge", "https://web.archive.org/web/*/{q}"),
    (&["gutenberg", "pg"], "Project Gutenberg", "books", "https://www.gutenberg.org/ebooks/search/?query={q}"),
    (&["ol", "openlibrary"], "Open Library", "books", "https://openlibrary.org/search?q={q}"),
    (&["gr", "goodreads"], "Goodreads", "books", "https://www.goodreads.com/search?q={q}"),
    // AI
    (&["chat", "chatgpt", "gpt"], "ChatGPT", "ai", "https://chatgpt.com/?q={q}"),
    (&["claude"], "Claude", "ai", "https://claude.ai/new?q={q}"),
    (&["perplexity", "ppx"], "Perplexity", "ai", "https://www.perplexity.ai/search?q={q}"),
    (&["gemini"], "Gemini", "ai", "https://gemini.google.com/app?q={q}"),
    (&["hf", "huggingface"], "Hugging Face", "ai", "https://huggingface.co/search/full-text?q={q}"),
    // Developers
    (&["gh", "github"], "GitHub", "dev", "https://github.com/search?q={q}"),
    (&["ghr", "repo"], "GitHub repositories", "dev", "https://github.com/search?type=repositories&q={q}"),
    (&["ghc", "ghcode"], "GitHub code", "dev", "https://github.com/search?type=code&q={q}"),
    (&["gl", "gitlab"], "GitLab", "dev", "https://gitlab.com/search?search={q}"),
    (&["so", "stackoverflow"], "Stack Overflow", "dev", "https://stackoverflow.com/search?q={q}"),
    (&["se", "stackexchange"], "Stack Exchange", "dev", "https://stackexchange.com/search?q={q}"),
    (&["su", "superuser"], "Super User", "dev", "https://superuser.com/search?q={q}"),
    (&["au", "askubuntu"], "Ask Ubuntu", "dev", "https://askubuntu.com/search?q={q}"),
    (&["mdn"], "MDN Web Docs", "dev", "https://developer.mozilla.org/en-US/search?q={q}"),
    (&["caniuse", "ciu"], "Can I use", "dev", "https://caniuse.com/?search={q}"),
    (&["npm"], "npm", "dev", "https://www.npmjs.com/search?q={q}"),
    (&["pypi", "pip"], "PyPI", "dev", "https://pypi.org/search/?q={q}"),
    (&["crates", "cargo"], "crates.io", "dev", "https://crates.io/search?q={q}"),
    (&["docsrs", "rsdoc"], "Docs.rs", "dev", "https://docs.rs/releases/search?query={q}"),
    (&["rust", "rustdoc"], "Rust standard library", "dev", "https://doc.rust-lang.org/std/?search={q}"),
    (&["py", "python"], "Python docs", "dev", "https://docs.python.org/3/search.html?q={q}"),
    (&["go", "pkg"], "Go packages", "dev", "https://pkg.go.dev/search?q={q}"),
    (&["node", "nodejs"], "Node.js docs", "dev", "https://nodejs.org/api/all.html#:~:text={q}"),
    (&["electron"], "Electron docs", "dev", "https://www.electronjs.org/search?q={q}"),
    (&["react"], "React docs", "dev", "https://react.dev/?search={q}"),
    (&["docker", "dh"], "Docker Hub", "dev", "https://hub.docker.com/search?q={q}"),
    (&["brew", "homebrew"], "Homebrew", "dev", "https://formulae.brew.sh/search?q={q}"),
    (&["aur"], "Arch User Repository", "dev", "https://aur.archlinux.org/packages?K={q}"),
    (&["archwiki", "aw"], "ArchWiki", "dev", "https://wiki.archlinux.org/index.php?search={q}"),
    (&["debian", "deb"], "Debian packages", "dev", "https://packages.debian.org/search?keywords={q}"),
    (&["man"], "Linux man pages", "dev", "https://man7.org/search?q={q}"),
    (&["regex", "regex101"], "regex101", "dev", "https://regex101.com/?regex={q}"),
    (&["cve"], "CVE records", "dev", "https://www.cve.org/CVERecord/SearchResults?query={q}"),
    (&["hn", "hackernews"], "Hacker News", "dev", "https://hn.algolia.com/?q={q}"),
    (&["devto", "dev"], "DEV Community", "dev", "https://dev.to/search?q={q}"),
    (&["cpp", "cppref"], "cppreference", "dev", "https://duckduckgo.com/?q=site%3Aen.cppreference.com+{q}"),
    (&["php"], "PHP manual", "dev", "https://www.php.net/manual-lookup.php?pattern={q}"),
    (&["java"], "Java docs", "dev", "https://docs.oracle.com/search/?q={q}"),
    (&["kotlin"], "Kotlin docs", "dev", "https://kotlinlang.org/docs/home.html?q={q}"),
    (&["swift"], "Swift docs", "dev", "https://developer.apple.com/search/?q={q}"),
    (&["android"], "Android developers", "dev", "https://developer.android.com/s/results?q={q}"),
    (&["godot"], "Godot docs", "dev", "https://docs.godotengine.org/en/stable/search.html?q={q}"),
    (&["unity"], "Unity docs", "dev", "https://docs.unity3d.com/ScriptReference/30_search.html?q={q}"),
    (&["figma"], "Figma Community", "design", "https://www.figma.com/community/search?query={q}"),
    (&["codepen"], "CodePen", "dev", "https://codepen.io/search/pens?q={q}"),
    (&["replit"], "Replit", "dev", "https://replit.com/search?query={q}"),
    // Video and music
    (&["yt", "youtube"], "YouTube", "media", "https://www.youtube.com/results?search_query={q}"),
    (&["ytm", "ytmusic"], "YouTube Music", "media", "https://music.youtube.com/search?q={q}"),
    (&["vimeo"], "Vimeo", "media", "https://vimeo.com/search?q={q}"),
    (&["twitch", "ttv"], "Twitch", "media", "https://www.twitch.tv/search?term={q}"),
    (&["spotify", "spot"], "Spotify", "media", "https://open.spotify.com/search/{q}"),
    (&["sc", "soundcloud"], "SoundCloud", "media", "https://soundcloud.com/search?q={q}"),
    (&["bc", "bandcamp"], "Bandcamp", "media", "https://bandcamp.com/search?q={q}"),
    (&["genius", "lyrics"], "Genius", "media", "https://genius.com/search?q={q}"),
    (&["am", "applemusic"], "Apple Music", "media", "https://music.apple.com/search?term={q}"),
    (&["lastfm", "lfm"], "Last.fm", "media", "https://www.last.fm/search?q={q}"),
    (&["discogs"], "Discogs", "media", "https://www.discogs.com/search/?q={q}"),
    (&["imdb"], "IMDb", "media", "https://www.imdb.com/find/?q={q}"),
    (&["tmdb"], "TMDB", "media", "https://www.themoviedb.org/search?query={q}"),
    (&["lb", "letterboxd"], "Letterboxd", "media", "https://letterboxd.com/search/{q}/"),
    (&["rt", "rottentomatoes"], "Rotten Tomatoes", "media", "https://www.rottentomatoes.com/search?search={q}"),
    (&["jw", "justwatch"], "JustWatch", "media", "https://www.justwatch.com/us/search?q={q}"),
    (&["netflix", "nf"], "Netflix", "media", "https://www.netflix.com/search?q={q}"),
    (&["mal", "anime"], "MyAnimeList", "media", "https://myanimelist.net/search/all?q={q}"),
    (&["anilist"], "AniList", "media", "https://anilist.co/search/anime?search={q}"),
    (&["unsplash"], "Unsplash", "media", "https://unsplash.com/s/photos/{q}"),
    (&["pexels"], "Pexels", "media", "https://www.pexels.com/search/{q}/"),
    (&["giphy", "gif"], "GIPHY", "media", "https://giphy.com/search/{q}"),
    (&["flickr"], "Flickr", "media", "https://www.flickr.com/search/?text={q}"),
    (&["pin", "pinterest"], "Pinterest", "social", "https://www.pinterest.com/search/pins/?q={q}"),
    (&["dribbble"], "Dribbble", "design", "https://dribbble.com/search/{q}"),
    (&["behance"], "Behance", "design", "https://www.behance.net/search/projects?search={q}"),
    (&["gfonts", "fonts"], "Google Fonts", "design", "https://fonts.google.com/?query={q}"),
    (&["icons", "lucide"], "Lucide icons", "design", "https://lucide.dev/icons/?search={q}"),
    (&["canva"], "Canva", "design", "https://www.canva.com/search/templates?q={q}"),
    // Social
    (&["r", "reddit"], "Reddit", "social", "https://www.reddit.com/search/?q={q}"),
    (&["x", "twitter", "tw"], "X", "social", "https://x.com/search?q={q}"),
    (&["bs", "bsky", "bluesky"], "Bluesky", "social", "https://bsky.app/search?q={q}"),
    (&["masto", "mastodon"], "Mastodon", "social", "https://mastodon.social/search?q={q}"),
    (&["threads"], "Threads", "social", "https://www.threads.net/search?q={q}"),
    (&["ig", "instagram"], "Instagram", "social", "https://www.instagram.com/explore/search/keyword/?q={q}"),
    (&["fb", "facebook"], "Facebook", "social", "https://www.facebook.com/search/top?q={q}"),
    (&["li", "linkedin"], "LinkedIn", "social", "https://www.linkedin.com/search/results/all/?keywords={q}"),
    (&["tt", "tiktok"], "TikTok", "social", "https://www.tiktok.com/search?q={q}"),
    (&["quora"], "Quora", "social", "https://www.quora.com/search?q={q}"),
    (&["medium"], "Medium", "social", "https://medium.com/search?q={q}"),
    (&["substack"], "Substack", "social", "https://substack.com/search/{q}"),
    (&["discord"], "Discord servers", "social", "https://discord.com/servers?query={q}"),
    // Shopping
    (&["a", "amazon", "amz"], "Amazon", "shopping", "https://www.amazon.com/s?k={q}"),
    (&["ain", "amazonin"], "Amazon India", "shopping", "https://www.amazon.in/s?k={q}"),
    (&["auk", "amazonuk"], "Amazon UK", "shopping", "https://www.amazon.co.uk/s?k={q}"),
    (&["ebay", "eb"], "eBay", "shopping", "https://www.ebay.com/sch/i.html?_nkw={q}"),
    (&["fk", "flipkart"], "Flipkart", "shopping", "https://www.flipkart.com/search?q={q}"),
    (&["etsy"], "Etsy", "shopping", "https://www.etsy.com/search?q={q}"),
    (&["ali", "aliexpress"], "AliExpress", "shopping", "https://www.aliexpress.com/wholesale?SearchText={q}"),
    (&["walmart", "wm"], "Walmart", "shopping", "https://www.walmart.com/search?q={q}"),
    (&["target"], "Target", "shopping", "https://www.target.com/s?searchTerm={q}"),
    (&["bestbuy", "bb"], "Best Buy", "shopping", "https://www.bestbuy.com/site/searchpage.jsp?st={q}"),
    (&["ikea"], "IKEA", "shopping", "https://www.ikea.com/us/en/search/?q={q}"),
    (&["myntra"], "Myntra", "shopping", "https://www.myntra.com/{q}"),
    (&["meesho"], "Meesho", "shopping", "https://www.meesho.com/search?q={q}"),
    (&["nykaa"], "Nykaa", "shopping", "https://www.nykaa.com/search/result/?q={q}"),
    (&["pcpp", "pcpartpicker"], "PCPartPicker", "shopping", "https://pcpartpicker.com/search/?q={q}"),
    (&["steam"], "Steam", "games", "https://store.steampowered.com/search/?term={q}"),
    (&["gog"], "GOG", "games", "https://www.gog.com/en/games?query={q}"),
    (&["epic"], "Epic Games Store", "games", "https://store.epicgames.com/en-US/browse?q={q}"),
    (&["itch"], "itch.io", "games", "https://itch.io/search?q={q}"),
    (&["pdb", "protondb"], "ProtonDB", "games", "https://www.protondb.com/search?q={q}"),
    (&["mcwiki", "minecraft"], "Minecraft Wiki", "games", "https://minecraft.wiki/?search={q}"),
    (&["fandom"], "Fandom", "games", "https://community.fandom.com/wiki/Special:Search?query={q}"),
    (&["chrome", "cws"], "Chrome Web Store", "tools", "https://chromewebstore.google.com/search/{q}"),
    (&["play", "gplay"], "Google Play", "shopping", "https://play.google.com/store/search?q={q}"),
    (&["appstore", "ios"], "App Store", "shopping", "https://www.apple.com/us/search/{q}?src=globalnav"),
    // Maps and travel
    (&["m", "maps", "gm"], "Google Maps", "travel", "https://www.google.com/maps/search/{q}"),
    (&["osm", "openstreetmap"], "OpenStreetMap", "travel", "https://www.openstreetmap.org/search?query={q}"),
    (&["amaps", "applemaps"], "Apple Maps", "travel", "https://maps.apple.com/?q={q}"),
    (&["flights", "gf"], "Google Flights", "travel", "https://www.google.com/travel/flights?q={q}"),
    (&["sky", "skyscanner"], "Skyscanner", "travel", "https://www.skyscanner.net/transport/flights-from/{q}"),
    (&["booking"], "Booking.com", "travel", "https://www.booking.com/searchresults.html?ss={q}"),
    (&["airbnb"], "Airbnb", "travel", "https://www.airbnb.com/s/{q}/homes"),
    (&["ta", "tripadvisor"], "Tripadvisor", "travel", "https://www.tripadvisor.com/Search?q={q}"),
    (&["weather", "wx"], "Weather", "tools", "https://wttr.in/{q}"),
    (&["time"], "Time and Date", "tools", "https://www.timeanddate.com/worldclock/?query={q}"),
    // News and money
    (&["bbc"], "BBC", "news", "https://www.bbc.co.uk/search?q={q}"),
    (&["reuters"], "Reuters", "news", "https://www.reuters.com/site-search/?query={q}"),
    (&["ap", "apnews"], "AP News", "news", "https://apnews.com/search?q={q}"),
    (&["guardian", "tg"], "The Guardian", "news", "https://www.theguardian.com/search?q={q}"),
    (&["nyt"], "The New York Times", "news", "https://www.nytimes.com/search?query={q}"),
    (&["th", "thehindu"], "The Hindu", "news", "https://www.thehindu.com/search/?q={q}"),
    (&["verge"], "The Verge", "news", "https://www.theverge.com/search?q={q}"),
    (&["ars"], "Ars Technica", "news", "https://arstechnica.com/search/?query={q}"),
    (&["yf", "yahoofinance", "stock"], "Yahoo Finance", "money", "https://finance.yahoo.com/quote/{q}"),
    (&["gfin", "googlefinance"], "Google Finance", "money", "https://www.google.com/finance/quote/{q}"),
    (&["tv", "tradingview"], "TradingView", "money", "https://www.tradingview.com/symbols/{q}/"),
    (&["cg", "coingecko"], "CoinGecko", "money", "https://www.coingecko.com/en/search?query={q}"),
    (&["xe", "currency"], "XE currency", "money", "https://www.xe.com/currencyconverter/convert/?Amount={q}"),
    // Jobs, food, health
    (&["jobs", "indeed"], "Indeed", "work", "https://www.indeed.com/jobs?q={q}"),
    (&["naukri"], "Naukri", "work", "https://www.naukri.com/{q}-jobs"),
    (&["glassdoor", "gd"], "Glassdoor", "work", "https://www.glassdoor.com/Search/results.htm?keyword={q}"),
    (&["recipe", "allrecipes"], "Allrecipes", "food", "https://www.allrecipes.com/search?q={q}"),
    (&["zomato"], "Zomato", "food", "https://www.zomato.com/search?q={q}"),
    (&["swiggy"], "Swiggy", "food", "https://www.swiggy.com/search?query={q}"),
    (&["yelp"], "Yelp", "food", "https://www.yelp.com/search?find_desc={q}"),
    (&["mayo", "health"], "Mayo Clinic", "health", "https://www.mayoclinic.org/search/search-results?q={q}"),
    (&["drugs", "medline"], "MedlinePlus", "health", "https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query={q}"),
    // Lantern itself
    (&["l", "lantern"], "Lantern Search", "search", "lantern://app/search.html?q={q}"),
    (&["ls", "summary"], "Lantern Search summary", "search", "lantern://app/search.html?q={q}&summary=1"),
    (&["h", "history"], "Lantern history", "lantern", "lantern://app/library.html#history?q={q}"),
    (&["bm", "bookmarks"], "Lantern bookmarks", "lantern", "lantern://app/library.html#bookmarks?q={q}"),
];

/// Percent-encodes search terms the way `encodeURIComponent` does.
pub fn encode(q: &str) -> String {
    let mut out = String::with_capacity(q.len() * 3);
    for b in q.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// The site's front page, used for a bare bang like `!yt` with nothing to search for.
fn home_of(template: &str) -> String {
    if let Some(rest) = template.strip_prefix("https://").or_else(|| template.strip_prefix("http://")) {
        let scheme = if template.starts_with("https://") { "https://" } else { "http://" };
        let host = rest.split(['/', '?', '#']).next().unwrap_or("");
        return format!("{scheme}{host}/");
    }
    if let Some(rest) = template.strip_prefix("lantern://app/") {
        let page = rest.split(['?', '#']).next().unwrap_or("");
        return format!("lantern://app/{page}");
    }
    template.replace("{q}", "")
}

fn valid_trigger(t: &str) -> bool {
    !t.is_empty() && t.len() <= 24 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

struct Bang {
    trigger: String,
    name: String,
    template: String,
    custom: bool,
}

fn find(trigger: &str, custom: &Value) -> Option<Bang> {
    let t = trigger.to_ascii_lowercase();
    if let Some(list) = custom.as_array() {
        for c in list {
            let ct = c.get("trigger").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
            if ct == t {
                return Some(Bang {
                    trigger: ct,
                    name: c.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                    template: c.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
                    custom: true,
                });
            }
        }
    }
    BUILTIN.iter().find(|(ts, ..)| ts.contains(&t.as_str())).map(|(ts, name, _, url)| Bang {
        trigger: ts[0].to_string(),
        name: name.to_string(),
        template: url.to_string(),
        custom: false,
    })
}

/// Reads what was typed. A bang can come first (`!w moon`) or last (`moon !w`).
/// Returns `null` when there is no known bang, otherwise where to go.
pub fn resolve(input: &str, custom: &Value) -> Value {
    let words: Vec<&str> = input.split_whitespace().collect();
    if words.is_empty() {
        return Value::Null;
    }
    let is_bang = |w: &str| w.len() > 1 && w.starts_with('!') && valid_trigger(&w[1..]);
    let (pos, word) = if is_bang(words[0]) {
        (0, words[0])
    } else if words.len() > 1 && is_bang(words[words.len() - 1]) {
        (words.len() - 1, words[words.len() - 1])
    } else {
        return Value::Null;
    };
    let Some(bang) = find(&word[1..], custom) else { return Value::Null };
    let query: Vec<&str> = words.iter().enumerate().filter(|(i, _)| *i != pos).map(|(_, w)| *w).collect();
    let query = query.join(" ");
    let url = if query.is_empty() { home_of(&bang.template) } else { bang.template.replace("{q}", &encode(&query)) };
    json!({ "url": url, "name": bang.name, "trigger": bang.trigger, "query": query, "custom": bang.custom })
}

/// Bangs whose trigger starts with what's been typed after `!`, for the address bar's suggestions.
pub fn suggest(prefix: &str, custom: &Value, limit: usize) -> Value {
    let p = prefix.trim_start_matches('!').to_ascii_lowercase();
    let mut out: Vec<Value> = Vec::new();
    if let Some(list) = custom.as_array() {
        for c in list {
            let t = c.get("trigger").and_then(Value::as_str).unwrap_or("");
            if t.starts_with(&p) {
                out.push(json!({ "trigger": t, "name": c.get("name").and_then(Value::as_str).unwrap_or(""), "custom": true }));
            }
        }
    }
    let mut exact: Vec<Value> = Vec::new();
    let mut rest: Vec<Value> = Vec::new();
    for (ts, name, _, _) in BUILTIN {
        if let Some(t) = ts.iter().find(|t| t.starts_with(&p)) {
            let v = json!({ "trigger": t, "name": name, "custom": false });
            if *t == p { exact.push(v) } else { rest.push(v) }
        }
    }
    rest.sort_by_key(|v| v["trigger"].as_str().map(str::len).unwrap_or(0));
    out.extend(exact);
    out.extend(rest);
    out.truncate(limit.max(1));
    Value::Array(out)
}

/// Every built-in bang, for the settings page.
pub fn list() -> Value {
    Value::Array(
        BUILTIN
            .iter()
            .map(|(ts, name, cat, url)| json!({ "triggers": ts, "name": name, "category": cat, "url": url }))
            .collect(),
    )
}

/// Checks a list of your own bangs: `[{trigger, name, url}]`, where the address has `{q}` (or `%s`).
pub fn validate_custom(v: &Value) -> Result<Value, String> {
    let list = v.as_array().ok_or("expected a list")?;
    if list.len() > 200 {
        return Err("up to 200 bangs".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in list {
        let trigger = item.get("trigger").and_then(Value::as_str).unwrap_or("").trim().trim_start_matches('!').to_ascii_lowercase();
        if !valid_trigger(&trigger) {
            return Err("a bang is up to 24 letters, numbers, - _ or . (like !wiki)".into());
        }
        if !seen.insert(trigger.clone()) {
            return Err(format!("!{trigger} is in the list twice"));
        }
        let name = item.get("name").and_then(Value::as_str).unwrap_or("").trim();
        let name = if name.is_empty() { trigger.clone() } else { name.chars().take(40).collect() };
        let url = item.get("url").and_then(Value::as_str).unwrap_or("").trim().replace("%s", "{q}");
        if !url.contains("{q}") {
            return Err(format!("the address for !{trigger} needs {{q}} (or %s) where the search goes"));
        }
        crate::settings::web_url(&url.replace("{q}", "x"), false).ok_or(format!("the address for !{trigger} must start with http:// or https://"))?;
        out.push(json!({ "trigger": trigger, "name": name, "url": url }));
    }
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_and_suffix() {
        let none = json!([]);
        let r = resolve("!w lantern festival", &none);
        assert_eq!(r["url"], "https://en.wikipedia.org/wiki/Special:Search?search=lantern%20festival");
        assert_eq!(r["name"], "Wikipedia");
        let r = resolve("rust ownership !gh", &none);
        assert_eq!(r["url"], "https://github.com/search?q=rust%20ownership");
        let r = resolve("!yt", &none);
        assert_eq!(r["url"], "https://www.youtube.com/");
        assert!(resolve("hello world", &none).is_null());
        assert!(resolve("!nosuchbangxyz cats", &none).is_null());
        assert!(resolve("wow! cats", &none).is_null());
        assert_eq!(resolve("!W Moon", &none)["trigger"], "w");
        assert_eq!(resolve("c++ & rust !g", &none)["url"], "https://www.google.com/search?q=c%2B%2B%20%26%20rust");
    }

    #[test]
    fn custom_wins() {
        let custom = json!([{ "trigger": "w", "name": "My wiki", "url": "https://wiki.example.com/?q={q}" }]);
        assert_eq!(resolve("!w cats", &custom)["url"], "https://wiki.example.com/?q=cats");
        assert_eq!(resolve("!w cats", &custom)["custom"], true);
    }

    #[test]
    fn suggestions_and_checks() {
        let none = json!([]);
        let s = suggest("!y", &none, 8);
        assert!(s.as_array().unwrap().iter().any(|v| v["trigger"] == "yt"));
        assert_eq!(suggest("!w", &none, 3)[0]["trigger"], "w");
        assert!(validate_custom(&json!([{ "trigger": "!Docs", "url": "https://docs.example.com/search?q=%s" }])).is_ok());
        assert!(validate_custom(&json!([{ "trigger": "x y", "url": "https://a.com/?q={q}" }])).is_err());
        assert!(validate_custom(&json!([{ "trigger": "a", "url": "javascript:alert({q})" }])).is_err());
        assert!(validate_custom(&json!([{ "trigger": "a", "url": "https://a.com/" }])).is_err());
        let mut all = std::collections::HashSet::new();
        for (ts, ..) in BUILTIN { for t in *ts { assert!(all.insert(*t), "duplicate trigger {t}"); } }
        // every built-in template is usable and every trigger is valid and unique per entry
        for (ts, _, _, url) in BUILTIN {
            assert!(url.contains("{q}"), "{url}");
            for t in *ts { assert!(valid_trigger(t), "{t}"); }
        }
    }
}

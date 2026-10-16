# Changelog

## 1.6.0 (2026-10-16)

Ideas from Helium and Brave, written fresh for Lantern.

**Tabs and layout**
- **Vertical tabs**: a sidebar on the left or right that you can resize or collapse to icons (⇧⌘E). Pinned tabs sit on top.
- **Split view**: two tabs side by side, with a draggable divider and a swap button. Open it with the toolbar button or ⌥⌘S, Shift+click a tab, or right-click a tab or link.
- **Tab groups**: named, coloured and collapsible. Drag tabs onto a group to add them. Groups are kept when Lantern restores your session.
- **Compact mode**: smaller tabs and toolbar.
- **Most-recently-used switching**: an option to make Ctrl+Tab go to the tab you used last.
- **Search your open tabs**: type `@tabs` in the address bar or press ⇧⌘Space. `@history` and `@bookmarks` work too.

**Search**
- **!bangs**: 185 built in, such as `!w`, `!yt` and `!gh`. Put the bang at the start or end, as in `!w moon` or `moon !w`, and add your own. They're resolved by the Rust core on your device.

**Privacy and the ad blocker**
- **Shields per site**: click the shield in the address bar to turn blocking off for a site, or to allow its fingerprinting or cookies.
- **Ad blocker**: hides the empty boxes ads leave behind, and can also hide cookie banners and other annoyances.
- **Fingerprint protection**: standard or strict. Canvas, audio and hardware readings differ from site to site. Strict also hides your graphics card and battery, and stops WebRTC from leaking your network address.
- **Clean links**: tracking parameters (utm_*, fbclid, gclid and others) are removed before a page loads, using a new Rust module. **Copy clean link** is in the right-click menu.
- **Secure DNS (DNS over HTTPS)**: Cloudflare, Quad9, Google, Mullvad, AdGuard or your own server.
- **Lantern services**: a log of every request Lantern makes on its own, with switches to stop the list updates.
- **Incognito windows**: what were private windows, now with an Incognito label (⇧⌘N).

**More**
- **Import**: bookmarks and history from Chrome, Brave, Edge, Helium, Arc, Vivaldi, Opera and Firefox. Bookmark files (Raindrop.io and every browser) can be imported and exported.
- **Site apps**: run any site in its own window (⋮ → Apps).
- **Picture in picture and screenshots**: both in the ⋮ menu.

## 1.5.1 (2026-10-16)

**Fixed**
- The tab strip and toolbar were blank in installed copies of 1.5.0, because the toolbar couldn't load from inside the app. Lantern now loads it correctly on macOS and Windows.

## 1.5.0 (2026-10-15)

**New: AI assistant**
- An AI button at the top right opens a side panel that answers with Claude, ChatGPT, Gemini or Groq, using your own API key.
- Paste a key and say which service it's for. Lantern recognises the service, refuses a key that belongs to another one, and checks it before saving.
- Keys are encrypted with the system keychain and only shown masked.
- Answers stream in with formatting and code blocks. You can ask about the current page or a selection, switch model per service, and use *Ask AI* from the address bar.
- Built on a new **Rust core** (compiled to WebAssembly) that builds each service's requests, reads its streamed answers and explains its errors in plain language.

**New: Chrome features Lantern was missing**
- History page with search, and address-bar suggestions from history and bookmarks, including inline completion.
- Bookmarks: the star in the address bar, a bookmarks bar and a bookmark manager.
- Private windows.
- Reopen closed tab, plus pin, mute, duplicate and close-others from the tab menu.
- Side panel with reading mode and Share (link and QR code).
- Downloads page, print, save page as, and a zoom indicator.

**New: customization**
- A Mail link at the top right of Lantern Search and the New Tab page: Gmail, Outlook, Proton Mail, Yahoo, iCloud, Zoho, Fastmail or your own web mail.
- Pick any theme colour. The Rust core adjusts it so text stays readable in light and dark mode.
- Every setting is validated by the Rust core before it's saved.

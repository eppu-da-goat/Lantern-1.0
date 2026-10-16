# Changelog

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

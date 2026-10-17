# Building Lantern 1.7

Everything here was built on Linux; on a Mac the same steps work (and `pkgbuild` could replace make-pkg.py).

1. Rust core → WebAssembly: `./build/build-core.sh` (add `LANTERN_BUILD_STD=1` if the wasm32 target can't be downloaded and rust-src is present).
2. `cd app && npm install`
3. Windows installer: `npx electron-builder --win nsis --x64` → `app/dist/Lantern-Setup-1.7.0.exe` (needs Wine with 32-bit support on Linux; resedit sets the icon, see build/after-pack.js).
4. macOS app: `node build/patch-universal.js` (Linux only, needs `lipo` = llvm-lipo), then `npx electron-builder --mac dir --universal`.
5. Ad-hoc sign: `rcodesign sign app/dist/mac-universal/Lantern.app` (on a Mac: `codesign --force --deep -s - Lantern.app`).
6. macOS installer: `python3 build/make-pkg.py app/dist/mac-universal/Lantern.app app/dist/Lantern-1.7.0-universal.pkg 1.7.0 --mkbom /path/to/mkbom` (mkbom from bomutils).

Tests: `cd rust/lantern-core && cargo test`, and the end-to-end test in a real window:
`LANTERN_FIXTURES=1 LANTERN_TEST_SHOT=/tmp/shots LANTERN_NO_EXT=1 LANTERN_AI_MOCK=1 LANTERN_AI_MOCK_LOG=/tmp/mock.log LANTERN_TEST_SCRIPT=test/e2e.js electron .`

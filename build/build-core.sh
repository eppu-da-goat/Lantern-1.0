#!/usr/bin/env bash
# Builds Lantern's Rust core to WebAssembly and copies it into the app.
# Needs Rust with the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown).
# If that target can't be downloaded, set LANTERN_BUILD_STD=1 to build the standard library
# from rust-src instead (needs the rust-src component or the library sources in the sysroot).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here/rust/lantern-core"
cargo test --release --quiet
if [ "${LANTERN_BUILD_STD:-0}" = "1" ]; then
  RUSTC_BOOTSTRAP=1 cargo build --release --target wasm32-unknown-unknown -Zbuild-std=std,panic_abort
else
  cargo build --release --target wasm32-unknown-unknown
fi
mkdir -p "$here/app/src/core"
cp target/wasm32-unknown-unknown/release/lantern_core.wasm "$here/app/src/core/lantern_core.wasm"
ls -la "$here/app/src/core/lantern_core.wasm"

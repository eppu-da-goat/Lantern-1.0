'use strict';
// Lets @electron/universal merge the Intel and Apple Silicon builds on Linux. It only needs
// `lipo` (llvm-lipo works) and `file`, which Linux has; the darwin-only check is just a guard.
const fs = require('fs');
const path = require('path');
for (const flavour of ['cjs', 'esm']) {
  const f = path.join(__dirname, '..', 'node_modules', '@electron', 'universal', 'dist', flavour, 'index.js');
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const out = s.replace("if (process.platform !== 'darwin')\n        throw new Error('@electron/universal is only supported on darwin platforms');", '/* darwin check removed by build/patch-universal.js */');
  if (out !== s) { fs.writeFileSync(f, out); console.log('patched', path.relative(process.cwd(), f)); }
}

/* Copyright (c) 2026 KropAl-Playable */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'node_modules', '@babylonjs', 'havok');
const sourceDir = path.join(packageDir, 'lib', 'esm');
const targetDir = path.join(root, 'external', 'emscripten', 'havok');

const files = ['HavokPhysics_es.js', 'HavokPhysics.wasm'];

for (const file of files) {
  const source = path.join(sourceDir, file);
  if (!fs.existsSync(source)) {
    throw new Error(`[havok] Missing ${source}. Run npm install with @babylonjs/havok@1.3.14 available.`);
  }
}

fs.mkdirSync(targetDir, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}

const license = path.join(packageDir, 'LICENSE');
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(targetDir, 'LICENSE'));

console.log('[havok] Synced @babylonjs/havok 1.3.14 ESM factory + WASM into external/emscripten/havok.');

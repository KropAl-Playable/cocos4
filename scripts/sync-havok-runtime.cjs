/* Copyright (c) 2026 KropAl-Playable */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'node_modules', '@babylonjs', 'havok');
const sourceDir = path.join(packageDir, 'lib', 'esm');

// COCOS 4 uses two different resolution paths here:
// - the vendored Emscripten factory is imported by a normal relative source path;
// - `external:emscripten/...` WASM imports are resolved against native/external.
const sourceTargetDir = path.join(root, 'external', 'emscripten', 'havok');
const nativeTargetDir = path.join(root, 'native', 'external', 'emscripten', 'havok');

const files = ['HavokPhysics_es.js', 'HavokPhysics.wasm'];

for (const file of files) {
  const source = path.join(sourceDir, file);
  if (!fs.existsSync(source)) {
    throw new Error(`[havok] Missing ${source}. Run npm install with @babylonjs/havok@1.3.14 available.`);
  }
}

function syncTo(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  }

  const license = path.join(packageDir, 'LICENSE');
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(targetDir, 'LICENSE'));
}

syncTo(sourceTargetDir);
syncTo(nativeTargetDir);

console.log('[havok] Synced @babylonjs/havok 1.3.14 runtime to:');
console.log(`[havok]   ${sourceTargetDir}`);
console.log(`[havok]   ${nativeTargetDir}`);

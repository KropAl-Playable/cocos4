# Havok Web runtime

`HavokPhysics.wasm` and `HavokPhysics_es.js` are copied unchanged from
`@babylonjs/havok` 1.3.14.

The factory is vendored because Cocos Creator 3.8.8 QuickCompiler incorrectly
selects the package's conditional `types` export as runtime JavaScript. Keeping
the matching factory and WASM under `external/emscripten` also gives the playable
packer stable, version-matched inputs.

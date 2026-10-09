# Havok Web runtime

The runtime is pinned to `@babylonjs/havok@1.3.14`.

`HavokPhysics_es.js` is kept in this tree for stable source imports. The matching
`HavokPhysics.wasm` is generated locally by:

~~~bash
npm run sync:havok-runtime
~~~

The sync script copies both files unchanged from
`node_modules/@babylonjs/havok/lib/esm`. Web build scripts run the sync first,
so the ESM factory and WASM always stay version-matched.

The factory uses a vendored/relative source path because the earlier Creator
3.8.8 integration found that QuickCompiler could select the package's conditional
`types` export as runtime JavaScript. Keeping the runtime under
`external/emscripten/havok` also gives the playable packer a stable path.

The WASM binary is intentionally not committed in COCOS 4; it is reproduced from
the pinned npm package to avoid duplicating a ~2.1 MB binary in Git history.

# Playable AO Baker — Creator 3.8.x Extension

Editor extension for the AO Baker implemented in the custom COCOS 4 fork.

## Requirements

- Cocos Creator 3.8.8
- this repository checked out on the `feat/ao-baker` branch (or later branch containing the AO baker)
- Creator configured to use this custom engine

The engine exposes the editor-only module:

```
cc/editor/serialization
```

The extension deliberately calls it only from the **scene script**. The main extension process and panel do not import `cc`.

## Install for development

This folder is intended to be imported through Creator's **Extension Manager → Developer Import**, so it can remain inside the engine repository.

From this directory:

```bash
npm install
npm run build
```

Then Developer Import this folder:

```
tools/creator-extensions/playable-ao-baker
```

Enable the extension and open:

```
Playable Tools → AO Baker
```

## Workflow

1. Select one or more scene nodes containing `MeshRenderer`.
2. Click **Refresh Selection**.
3. Configure AO.
4. Click **Preview AO**.
5. Use **Restore** to return to the source meshes.
6. Set an existing AssetDB output directory, for example `db://assets`.
7. Click **Bake Selected**.

Bake creates a new `.mesh` asset through AssetDB, reloads it, and assigns it to the selected renderer.

## Important v0.1 limitation

The standard material must actually consume the selected vertex-color channel for the AO to be visible. The baker only writes the data; material integration/debug AO visualization is the next layer.

The AssetDB persistence path uses Creator's scene-side `EditorExtends.serialize()` and should be tested on Creator 3.8.8 before relying on it for production assets. Preview is fully non-destructive and does not require asset serialization.

## Current mesh restrictions

- static meshes
- triangle-list primitives
- Float32 positions and normals
- tightly packed primary vertex stream
- no morphs
- no clustered meshes
- no pre-existing vertex color attribute

These restrictions are deliberate for v0.1 so a bake cannot silently corrupt production mesh data.

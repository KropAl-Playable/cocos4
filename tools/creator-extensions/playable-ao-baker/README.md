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
5. **Preview AO** uses a temporary grayscale vertex-color material, so the AO is visible independently of the production material.
6. Use **Restore** to return both the original mesh and materials.
7. Set an existing AssetDB output directory, for example `db://assets/Scene/Object/BakedModels`.
8. Click **Bake Selected**.

Bake writes a generated `.glb` source asset, lets Creator's glTF importer create the real `cc.Mesh` sub-asset, then assigns that Mesh to the selected renderer. This intentionally avoids writing Creator's internal `.mesh` format directly.

## Important v0.1 limitation

The baked production mesh stores AO in the selected vertex-color channel. A production material still needs to consume that channel, but Preview uses an AO-only debug material automatically.

Persistence goes through Creator's supported glTF/GLB importer rather than the internal `.mesh` importer. The generated GLB currently preserves POSITION, NORMAL, TANGENT, TEXCOORD_0, TEXCOORD_1, COLOR_0 and triangle indices.

## Current mesh restrictions

- static meshes
- triangle-list primitives
- Float32 positions and normals
- tightly packed primary vertex stream
- no morphs
- no clustered meshes
- no pre-existing vertex color attribute

These restrictions are deliberate for v0.1 so a bake cannot silently corrupt production mesh data.


## Shared mesh baking

For repeated objects such as trees, use **Mesh Sharing → Shared by source mesh**. The extension groups selected renderers by their original source `Mesh`, bakes AO for each instance in world space, averages the per-vertex AO values, then exports only one baked GLB/cc.Mesh for the whole group.

This preserves mesh reuse and avoids multiplying geometry size. With **Scene Occluders** enabled, the shared result is an averaged approximation of the instances' surroundings. Disable **Scene Occluders** for a pure reusable self-AO asset.

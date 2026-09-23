# Playable Cage Baker

Editor-only persistence tool for Cage Deform v0.1.

## Build

~~~powershell
cd tools\creator-extensions\playable-cage-baker
npm install
npm run build
~~~

Install/link the extension in Cocos Creator 3.8.8, select one or more nodes with MeshRenderer and open:

~~~text
Playable Tools → Cage Baker
~~~

## Data contract

The baked GLB uses standard glTF color streams so Creator can round-trip the data:

~~~text
COLOR_0  = optional Vertex AO / existing packed color data
JOINTS_0  = cage control indices (RGBA8UI)
WEIGHTS_0 = cage weights (RGBA8 normalized)
~~~

The cage shader reuses the standard static JOINTS_0 / WEIGHTS_0 semantics as a compact four-influence transport. This remains 8 bytes/vertex total and avoids Creator 3.8 rejecting COLOR_1/COLOR_2 while using only two vertex-attribute slots.

When AO + Cage are used together, bake AO first and Cage second so the Cage exporter preserves COLOR_0. JOINTS_0 / WEIGHTS_0 are reserved by Cage v0.1, so the source mesh must be static and must not already contain skinning data.

Meshes that share the same source Mesh are baked once and assigned to all selected instances.


## CageDeformer Inspector

When the extension is enabled, the CageDeformer component gets a custom Inspector that keeps the runtime properties editable and adds:

~~~text
Cage Data: Baked | Runtime Generated | Mixed
[ Bake Cage Data ] [ Refresh ]
~~~

The Bake button uses the component's current Control Count and writes generated assets to `db://assets`. The standalone Cage Baker panel remains available for batch baking and custom output directories.

Creator may need an extension reload or restart after changing inspector contributions.

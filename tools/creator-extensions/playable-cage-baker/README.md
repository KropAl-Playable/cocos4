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
COLOR_0   = optional Vertex AO / existing packed color data
TEXCOORD_2 = cage indices 0..1 (RG8 normalized)
TEXCOORD_3 = cage indices 2..3 (RG8 normalized)
TEXCOORD_4 = cage weights 0..1 (RG8 normalized)
TEXCOORD_5 = cage weights 2..3 (RG8 normalized)
~~~

The cage shader reconstructs four indices and four weights from TEXCOORD_2..5. This remains 8 bytes/vertex total and avoids Creator 3.8's GLB importer rejecting COLOR_1/COLOR_2.

When AO + Cage are used together, bake AO first and Cage second so the Cage exporter preserves COLOR_0. TEXCOORD_2..5 are reserved by Cage v0.1 and must be unused by the source mesh.

Meshes that share the same source Mesh are baked once and assigned to all selected instances.

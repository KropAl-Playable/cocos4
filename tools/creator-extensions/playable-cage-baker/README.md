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
COLOR_0 = optional Vertex AO / existing packed color data
COLOR_1 = cage control indices (RGBA8 normalized)
COLOR_2 = cage weights (RGBA8 normalized)
~~~

The cage shader consumes COLOR_1 / COLOR_2 directly.

When AO + Cage are used together, bake AO first and Cage second so the Cage exporter preserves COLOR_0.

Meshes that share the same source Mesh are baked once and assigned to all selected instances.

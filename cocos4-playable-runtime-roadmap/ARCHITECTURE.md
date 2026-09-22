# Architecture

## Experimental layer

The experiments should conceptually sit above or beside existing Cocos systems rather than replacing them.

```text
Cocos Creator Editor
        |
        +-- Playable Bake Tools
        |      +-- AO Baker
        |      +-- future masks/light bake tools
        |
        +-- Scene / Components
               +-- CageDeformer
               +-- WindField / impulse source
                       |
                       v
                 Cocos Renderer
                       |
                       v
                     GFX
```

## Shared design target

Both initial systems should exploit existing mesh data whenever possible.

Potential vertex-data packing:

```text
COLOR.r = baked AO
COLOR.g = wind influence
COLOR.b = branch/random variation
COLOR.a = reserved/general mask
```

Do not hard-code this packing globally yet. Introduce an explicit configuration/contract so production assets with vertex colors remain supported.

## AO ownership

AO is an **editor/offline process**.

Runtime responsibilities should be limited to reading a baked attribute or texture and applying it in a material/shader.

No runtime ray tracing, SSAO, or scene capture is part of v0.1.

## Cage ownership

Cage deformation consists of three distinct layers:

```text
Author/Bake
  -> compute vertex influence data

Simulation
  -> update a small set of control points

Rendering
  -> deform the final mesh in the vertex stage
```

Keep these layers separable.

### v0.1 representation

Do not begin with full tetrahedral-cage interpolation.

Start with a lightweight control hierarchy / deformation skeleton:

```text
root
  |
trunk_low
  |
trunk_high
 /   |   \
L   crown  R
```

Each render vertex receives a small number of influences.

This validates:

- mesh data transport;
- shader deformation;
- wind response;
- impulse response;
- performance.

A later version may replace the influence model with tetrahedral barycentric interpolation without changing the public component API.

## Runtime budget

Target for vegetation prototype:

- 5–15 control points/tree;
- no per-vertex CPU update;
- one compact control buffer/uniform payload per tree or batch;
- zero or near-zero allocations per frame;
- deterministic fallback to undeformed/static rendering.

## Compatibility

The first implementation must work on the existing WebGL rendering path.

WebGPU-specific compute can be added later as an optional accelerator, not as a prerequisite.

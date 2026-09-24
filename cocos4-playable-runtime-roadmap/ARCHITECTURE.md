# Architecture

## Experimental layer

The playable-runtime additions should sit above or beside existing Cocos systems rather than replacing them.

~~~text
Cocos Creator Editor
        |
        +-- Playable Bake / Authoring Tools
        |      +-- AO Baker
        |      +-- Cage Baker / control authoring
        |      +-- future packed masks/light tools
        |
        +-- Runtime Components
        |      +-- CageDeformer
        |      +-- WaterSurface / WaterWaveProfile
        |      +-- WaterBuoyancy
        |      +-- future physics / VFX helpers
        |
        +-- Opt-in Effects
               +-- standard + Vertex AO
               +-- standard + Cage + Vertex AO
               +-- Advanced Water-derived playable effect
                       |
                       v
                 Cocos Renderer
                       |
                       v
                     GFX
~~~

## Shared design target

The project optimizes for **visual / physical information per byte**.

Preferred data sources, roughly in order:

~~~text
procedural math
→ existing vertex attributes
→ compact additional vertex attributes
→ tiny shared LUT/noise textures
→ larger textures only when clearly justified
~~~

## Packed vertex data

Candidate production contract:

~~~text
COLOR.r = baked AO
COLOR.g = wind / deformation mask
COLOR.b = material/random variation
COLOR.a = reserved/general mask
~~~

Cage v0.1 reuses standard static-mesh glTF semantics for compact persistent influences:

~~~text
JOINTS_0  : RGBA8UI   // cage control indices
WEIGHTS_0 : RGBA8     // normalized cage weights
~~~

This keeps the payload at 8 bytes/vertex and round-trips through Creator 3.8.8. The source mesh must be static and must not already use skinning data.

Do not globally reserve all channels yet. Materials must explicitly declare the packed-data contract they consume.

## AO ownership

AO is an **editor/offline process**.

Runtime responsibility is limited to reading packed AO and applying a controllable response in the material.

All relevant custom materials, including cage materials, should support the same Vertex AO convention.

## Cage ownership

Cage deformation has three separable layers:

~~~text
Author/Bake
  → control layout + vertex influences

Simulation
  → update a tiny hierarchy of rotational controls

Rendering
  → dense vertex deformation on GPU
~~~

The public runtime API should remain stable even if the influence representation changes later.

Generalized tetrahedral cages remain a research follow-up.

## Water ownership

Water deliberately uses a **dual representation**:

~~~text
        WaterWaveProfile
          /          \
         /            \
        v              v
GPU renderer       CPU sampler
visual detail      gameplay surface
~~~

The low-frequency analytical waves are shared conceptually by both sides.

GPU responsibilities:

- reuse the built-in Advanced Water presentation model where practical;
- analytical surface displacement;
- visual normals/detail;
- Fresnel/specular;
- foam/wakes;
- optional cheap reflection/refraction features.

CPU responsibilities:

- evaluate low-frequency wave height;
- evaluate low-frequency normal;
- optional water velocity;
- supply buoyancy/gameplay queries.

No GPU readback. Visual-only high-frequency detail must not affect gameplay collision/buoyancy.

## Future physics ownership

Physics backends remain behind the existing Cocos selector/adapter model.

Havok, if added, is optional rather than a dependency of Cage, Water or VFX.

~~~text
WaterBuoyancy
      |
      +-- transform-only/simple-body path
      |
      +-- existing physics adapter
      |
      +-- future Havok adapter
~~~

## GPU simulation ownership

GPU particles and later compute/VFX systems should initially run **beside** the renderer rather than replacing GFX or the full rendering architecture.

Target:

~~~text
existing renderer
      +
custom GPU simulation/pass layer
~~~

WebGPU can add richer compute paths later, while WebGL remains a required playable fallback.

## Runtime budget philosophy

Typical systems should aim for:

- zero per-vertex CPU updates;
- zero or near-zero per-frame allocations;
- shared geometry/material data wherever possible;
- bounded control/sample counts;
- deterministic quality tiers;
- explicit static/fallback mode.

Every new runtime system must be benchmarked against its visual/gameplay benefit.

# Roadmap

## Goal

Build a reusable COCOS 4 playable-runtime layer that maximizes **visual / physical information per byte** under a typical ~5 MB playable-ad delivery budget.

The roadmap favors systems that move expensive work offline, reuse compact mesh data, keep dense work on the GPU, expose cheap CPU gameplay proxies, preserve WebGL compatibility, and remain opt-in.

## Current status

| Priority | System | Status | Next gate |
|---:|---|---|---|
| 1 | **AO / lighting baker** | ✅ v0.1 working | Vertex AO integration across custom materials + production validation |
| 2 | **Cage deformation** | 🟡 v0.1 nearly ready | finish authoring/bake flow, debug tooling, Vertex AO compatibility |
| 3 | **Advanced water + buoyancy** | ⏭ next | shared visual/CPU wave model |
| 4 | **Havok backend** | planned | playable-size/runtime feasibility |
| 5 | **GPU particles** | planned | scalable particle simulation + fallback |
| 6 | **GPU-driven VFX / compute** | planned | reusable custom GPU pass framework |
| 7 | **SDF collision / VFX** | research | compact spatial interaction representation |
| 8 | **GPU culling / indirect rendering** | research | only if scene scale justifies complexity |

---

# Phase 0 — Baseline

Establish reproducible custom-engine builds, keep a clean upstream reference, maintain representative benchmark scenes, and record baseline size/performance before enabling each system.

Record engine revision, Creator version, HTML/ZIP size, startup time, target device/WebView, FPS, CPU/GPU time where available, draw calls, triangles and useful memory metrics.

Exit criterion: the baseline can be rebuilt and reproduced.

---

# Phase 1 — AO / Lighting Baker

## Status

**AO Baker v0.1 is functional.**

Implemented direction:

- editor/offline AO;
- deterministic hemisphere sampling;
- self + scene occluders;
- vertex-color output;
- shared-mesh baking;
- GLB persistence;
- debug preview;
- near-zero runtime CPU cost.

## Remaining integration work

- define the production packed vertex-data contract;
- support Vertex AO in all relevant custom materials, including the cage shader;
- validate shared/self AO versus averaged environment AO;
- benchmark size delta and visual gain on production scenes.

## Exit criteria

- AO survives import/build;
- shared meshes remain shared;
- custom materials expose controllable AO response;
- runtime CPU cost is negligible;
- the common path needs no AO texture.

---

# Phase 2 — Cage Deform

## Status

**Cage Deform v0.1 is functional but not finished.**

Implemented direction:

- CageDeformer component;
- small hierarchical control set;
- GPU vertex deformation;
- rotational trunk bending;
- 4 influences per vertex;
- procedural wind;
- spring response;
- external impulse API;
- shared derived meshes;
- isolated cage standard shader;
- fixed-step control simulation.

## Remaining work before v0.1 is complete

1. make the cage shader support the same Vertex AO contract as the AO pipeline;
2. finish reliable debug visualization;
3. add persistent editor/offline influence baking;
4. add basic control authoring/editing;
5. add influence heatmap/debug view;
6. benchmark repeated instances and impulse-heavy cases;
7. validate WebGL/mobile behavior.

## Decision gate

Do not jump directly to generalized tetrahedral cages. First prove the lightweight hierarchy gives a clear visual advantage over classic vertex wind at acceptable size/runtime cost.

---

# Phase 3 — Advanced Water + Buoyancy

This is the **next major task** after the short AO/Cage integration pass.

## Core idea

Use the same compact analytical wave model twice:

~~~text
                 shared wave parameters
                        |
              +---------+---------+
              |                   |
              v                   v
        GPU water shader     CPU wave sampler
              |                   |
        visual surface       buoyancy/gameplay
~~~

No GPU readback.

## Visual target

Use COCOS 4's existing `editor/assets/effects/advanced/water.effect` as the visual baseline rather than designing the presentation shader from zero. Extend/fork it only for the features the playable runtime needs.

The existing effect already covers Fresnel/PBR water presentation, layered animated normals and optional water scattering. Task 003 primarily adds analytical surface displacement + CPU agreement + buoyancy.

Target additions/preserved features include:

- layered directional waves;
- large low-frequency displacement;
- smaller visual detail;
- depth/shore color hooks where data exists;
- Fresnel/specular response;
- foam/wake hooks;
- optional contact/intersection foam;
- configurable quality tiers;
- no mandatory large textures.

Prefer procedural math and tiny reusable noise/LUT assets over heavyweight texture sets.

## Buoyancy target

Expose a lightweight CPU sampler that returns water height and normal from the same low-frequency equations used by the shader.

Typical sample budgets:

~~~text
small prop     1–2
crate/barrel   2–4
boat / raft    4
large vehicle  4–8
~~~

The CPU never simulates the water mesh.

## Candidate wave model

Start with 2–4 Gerstner-style or sine wave layers with packed direction, frequency/wavelength, amplitude, speed and steepness.

Gameplay uses stable low-frequency layers. Higher-frequency detail may remain visual-only.

## Exit criteria

- visibly richer than a flat scrolling-normal water shader;
- CPU sampled height closely matches visible large waves;
- 4-point buoyancy is stable under variable frame rate;
- no GPU readback;
- WebGL path works;
- build-size delta is acceptable;
- quality degrades gracefully.

COCOS also includes Houdini/Zeno fluid VAT playback. Those are offline-baked fluid animations, not runtime solvers, and are documented as a separate optional VFX path in TASK_003.

Detailed plan: TASK_003_ADVANCED_WATER_BUOYANCY.md.

---

# Phase 4 — Havok Backend

Evaluate Havok as an optional high-end physics backend without making it mandatory for playable delivery.

Targets:

- adapter compatible with the Cocos physics selector;
- rigid bodies, shapes and joints;
- ragdoll workflow;
- force-field / constant-force helpers;
- 2-wheel and 4-wheel vehicle helpers;
- WASM payload, startup and runtime benchmarks.

Promotion requires a convincing compressed-size and startup/runtime trade-off for selected playable classes.

---

# Phase 5 — GPU Particles

Target substantially richer particle counts without CPU-side per-particle updates.

Candidate features:

- WebGL-friendly GPU path where practical;
- optional WebGPU compute path;
- spawn/update/kill lifecycle;
- mesh and billboard particles;
- forces, drag, attractors and simple collision hooks;
- deterministic fallback to the existing particle system.

Showcase candidates: debris, sparks, leaves, rain, vortex/tornado and projectile trails.

---

# Phase 6 — GPU-driven VFX / Compute

Generalize the particle work into a small reusable framework for custom GPU simulation/passes.

Candidate systems:

- boids;
- grass interaction;
- procedural debris;
- fluid-like effects;
- custom postFX;
- procedural geometry;
- simulation buffers shared by rendering and VFX.

The first objective is not replacing the renderer. It is adding cheap parallel custom passes beside the existing renderer.

---

# Phase 7 — SDF Collision / VFX

Research compact signed-distance-field representations for cases where full mesh or rigid-body collision is unnecessary.

Potential uses:

- VFX collision;
- soft intersection masks;
- force fields;
- terrain/volume queries;
- stylized destruction;
- localized fog/smoke interaction.

Key question: does an SDF encode enough useful spatial information to justify its bytes versus simpler analytic primitives?

---

# Phase 8 — GPU Culling / Indirect Rendering

Lowest priority until a real playable scene proves it is needed.

Research:

- GPU visibility/culling;
- indirect draw preparation;
- repeated prop/vegetation rendering;
- integration with instancing and shared mesh data;
- WebGPU-first acceleration with a WebGL fallback strategy.

Do not pursue this without a measured CPU/draw-call bottleneck.

---

# Cross-system packing strategy

Treat vertex channels as a compact data bus rather than only visible color.

Candidate contract:

~~~text
COLOR.r = baked AO
COLOR.g = wind / deformation mask
COLOR.b = random variation / material mask
COLOR.a = reserved
~~~

Cage influence indices/weights currently use dedicated compact attributes.

Do not globally reserve channels until production use cases prove the contract. Custom materials must declare what packed data they consume.

---

# Promotion rule

An experiment enters the reusable playable toolkit only if:

1. its visual/gameplay benefit is obvious side-by-side;
2. compressed build-size cost is acceptable;
3. CPU/GPU cost is acceptable on target mobile hardware;
4. fallback behavior is reliable;
5. authoring workflow is practical;
6. relevant WebView/ad-network compatibility is acceptable.

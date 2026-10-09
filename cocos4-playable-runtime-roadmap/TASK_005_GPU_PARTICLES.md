# Task 005 — GPU Particles

## M5.1 implementation status (2026-10-09)

Experimental analytical WebGL2 spike committed to feat/havok-backend; **not yet validated in Creator**.

- Independent GPUParticleSystem component with seeded, fixed-capacity quad mesh.
- Dedicated WebGL2 shader: billboard, analytical gravity/initial-velocity/drag approximation, cyclic lifetime, alpha fade.
- Public exports/gpu-particles.ts and opt-in GPU Particles (Experimental) Feature Cropping.
- No CPU-side per-particle update; CPU advances one uniform per emitter.

### Creator smoke test

1. Enable 3D, gfx-webgl2, and GPU Particles (Experimental) in Feature Cropping.
2. Import/create a Material using advanced/playable-gpu-particles.effect.
3. Add GPU Particle System (Experimental) to an empty node; assign the material.
4. Check 1k, 5k, 10k particles in Web Mobile build, after clearing the global engine cache if feature modules changed.
5. Capture render/compile errors, p50/p95 frame times, draw calls, device GPU, and compressed single-HTML delta.

### Explicit known limitations

- Shader compilation and runtime behavior have not been tested in Cocos Creator yet.
- Shader displacement exceeds static mesh bounds; conservative bounds/culling solution pending.
- Billboard only; stretched and mesh particles plus analytical plane/sphere/box collisions are M5.2.
- No Transform Feedback or mutable simulation state yet; this is an analytical GPU rendering spike.
- Changes to serialized settings after startup require rebuilding mesh/material.
- Drag only damps initial velocity; gravity is ballistic, not drag-integrated.
- WebGL1 unsupported: component disables itself.

---

## Objective

Build a compact, reusable GPU-driven particle path for COCOS 4 that can render substantially richer playable-ad VFX without CPU-side per-particle updates.

The first milestone is deliberately WebGL-first. WebGPU compute may accelerate the same high-level system later, but Task 005 v0.1 must not require WebGPU.

Primary target workloads:

- sparks and impact debris;
- rain;
- leaves;
- projectile trails;
- vortex / tornado effects;
- simple mesh particles where billboard-only presentation is insufficient.

The design goal remains **visual information per byte**. Prefer procedural state, compact buffers and shared materials over large flipbooks or CPU object pools.

## Design constraints

- opt-in and removable from ordinary builds;
- no regression to the existing ParticleSystem;
- WebGL2 path first, with a graceful fallback strategy;
- avoid per-particle Node/Component objects;
- no GPU readback in the normal simulation path;
- deterministic/reproducible authoring where practical;
- compact authoring data suitable for single-HTML builds;
- benchmark against stock CPU particles, not only against an empty baseline.

## Phase 5.1 — Feasibility spike

Prove a minimal end-to-end GPU particle loop:

1. emitter component owns one logical particle system;
2. compact particle state stored in GPU-friendly buffers/textures;
3. spawn/update/kill occurs without one CPU update per particle;
4. billboard rendering supports camera-facing quads;
5. fixed-seed spawn can reproduce the same initial distribution;
6. system runs in Creator preview and Web build.

Start with a single emitter and one material. Do not build a graph editor yet.

### First visual smoke

Create three simple effects:

~~~text
A. 10k falling rain particles
B. 5k sparks with gravity + drag
C. 5k vortex particles around an attractor
~~~

The point is to validate architecture and cost, not final art quality.

## Phase 5.2 — Simulation contract

Target common particle state:

~~~text
position.xyz
velocity.xyz
age
lifetime
size
rotation
seed/random
optional custom0/custom1
~~~

Prefer packing that maps well to WebGL2 and remains easy to upload once at initialization.

Candidate update operations:

- gravity;
- linear drag;
- radial force / attractor;
- vortex/tangential force;
- constant directional force;
- simple procedural noise;
- lifetime/kill;
- respawn.

Avoid adding every VFX feature until the update path is measured.

## Phase 5.3 — Rendering

v0.1 rendering targets:

- camera-facing billboard;
- stretched billboard for trails/sparks;
- optional mesh particle path if size/runtime cost remains reasonable;
- per-particle size/rotation;
- gradient/tint over lifetime;
- soft fade by age;
- additive and alpha-blended materials.

Prefer tiny LUT/gradient textures or uniforms over large flipbooks.

## Phase 5.4 — Spawn model

Support at least:

- point;
- box;
- sphere;
- cone/directional burst.

Authoring parameters should stay compact:

~~~text
rate
burst count
lifetime range
speed range
size range
direction/cone
seed
max particles
loop
prewarm
~~~

CPU should configure emitters and occasional bursts, not touch every living particle each frame.

## Phase 5.5 — Interaction hooks

Keep interaction cheap and analytic.

Candidate hooks:

- plane collision;
- sphere collision;
- AABB collision;
- depth/scene collision only if a WebGL-safe path proves worthwhile;
- attractor/repulsor;
- vortex field;
- externally supplied impulse/source list with a strict small-count cap.

Do not introduce full rigid-body collision for particles.

## Phase 5.6 — Fallback strategy

Define an explicit capability/fallback path:

1. GPU particle path when supported;
2. reduced-count stock ParticleSystem fallback;
3. optional static/simple VFX fallback for extremely constrained targets.

The gameplay must never depend on a high-count visual particle simulation.

## Benchmark matrix

Compare GPU particles against stock particles using identical visual intent where possible:

~~~text
A. 1k billboard particles
B. 5k billboard particles
C. 10k billboard particles
D. 20k billboard particles
E. rain
F. sparks + gravity/drag
G. vortex/attractor
H. burst-heavy repeated impacts
~~~

Record:

- CPU frame time;
- GPU frame time where available;
- average / p95 / p99 frame time;
- draw calls;
- particle count;
- buffer/texture memory;
- build-size delta;
- startup cost;
- Safari/WebView behavior.

## v0.1 acceptance criteria

Task 005 v0.1 is successful if:

- 10k+ simple particles are practical on the target desktop and representative mobile path;
- CPU cost grows much more slowly than one-object-per-particle approaches;
- no per-particle Node/Component allocation is required;
- WebGL path works;
- fallback behavior is explicit and reliable;
- common sparks/rain/vortex effects are straightforward to author;
- system is optional and removable;
- compressed build-size delta is acceptable for playable production.

## Non-goals for first pass

- Niagara/VFX-Graph-style node editor;
- general-purpose compute framework;
- fluid simulation;
- arbitrary mesh collisions;
- GPU sorting for every transparent case;
- replacing the stock particle system;
- WebGPU-only architecture.

## First implementation step

1. inspect the current COCOS 4 particle/rendering internals and available GPU buffer/texture update paths;
2. choose the smallest WebGL2-compatible state transport;
3. implement one fixed-capacity emitter with billboard rendering;
4. implement gravity + drag + lifetime/respawn;
5. build a 10k-particle benchmark scene;
6. measure CPU/GPU/build-size cost before expanding the feature set.

# Task 005 — GPU Particles

## M5.1 — analytical billboards: visual smoke PASS (2026-10-11)

Confirmed by Creator Preview-in-Editor: WebGL2 (gfxAPI=7), 10,000 seeded billboards, one additional draw call, live analytical motion and alpha fade. The key rendering fix was **using the implicit default phase** in the effect; an explicit `phase: default` was imported under a different phase ID and rejected by Custom Pipeline culling.

- Renderer uses one generated mesh and one material; no per-particle Node.
- The engine-wide phase debug instrumentation has been removed.
- Material and runtime debug log instrumentation has been removed.
- Depth testing restored after the diagnostic solid-magenta pass.
- This is a *desktop Preview visual smoke*, **not** Web Mobile / Safari verification or a performance benchmark.

## M5.2 — Sphere Collision implementation (2026-10-12)

Plane collision confirmed working by user. Sphere collision implemented, **not yet compiled/tested in Creator**.

- Inspector: `collideWithSphere` (default false), `sphereCenter` (world coordinates), `sphereRadius`, `sphereRestitution`.
- GPU uniform blocks `u_collisionSphere` and `u_sphereParams` shared by both shader stages.
- Tests the first entering segment/sphere intersection across 8 time intervals in a particle lifespan. Exact for straight-line motion, approximate for accelerating ballistic motion.
- Resolves a single bounce with reflected normal velocity. No persistent state, no multi-bounce or contact stabilization.
- Start-inside-sphere particles skip sphere collision; place spawn geometry outside the collider.
- Drag is not included in collision timing. Use `drag=0` for verification.
- **Plane and sphere modes are currently independent and are not a combined earliest-contact solver.** Test sphere with plane collision disabled.
- 8 chord evaluations per vertex per particle can be costly; benchmark in Web Mobile before release.

### Sphere smoke test
1. Update engine and reimport the effect. Set `collideWithPlane=false`, `collideWithSphere=true`.
2. Put emitter at world `(-3, 0, 0)`, sphere center at `(0,0,0)`, radius `1`; turn gravity off.
3. Current emitter velocity distribution is randomized, so a fraction of particles will travel toward sphere when `speed` is set to `4`. Set `capacity=1000`, `lifetime=3`, `spawnExtent=(0,0,0)`, `sphereRestitution=1`.
4. Compare sphere mode ON and OFF: crossing streams should rebound off the sphere. Use `sphereRestitution=0` to compare inelastic normal response.
5. Check baseline billboards and stretched mode with sphere disabled; report any EFX import/link errors.
6. Pending: directed emitter velocity control to make deterministic head-on sphere tests easier.

## M5.2 — rendering extension in progress (2026-10-11)

Implemented (awaiting Creator test):
- Optional **velocity-stretched billboard**, with Inspector `stretchedBillboard` (default false) and `stretchFactor` (default 1).
- GPU computes the view-plane projection of particle velocity, aligning the quad long axis to it and scaling it by projected velocity. When the projected speed is near zero, it falls back to camera up.
- Material parameters updated via `u_stretchParams` in the shared uniform block.
- Standard billboards remain the default to preserve the validated M5.1 behavior.

Validated by user in Creator Preview: velocity-stretched billboards and stretchFactor modulation (2026-10-11).

Implemented, awaiting Creator smoke test:
- Optional first-contact analytic collision with world-space horizontal plane. Inspector fields: `collideWithPlane`, `collisionPlaneHeight` (world Y), `planeRestitution` (0–1).
- Ballistic quadratic impact calculation in vertex shader; single bounce each particle life cycle. Once the subsequent ballistic path reaches the plane, position is clamped to the plane. This is **not** a multi-bounce solver.
- No per-particle CPU update; disabled by default to preserve the visually validated M5.1/M5.2 behavior.
- Collision calculation assumes ballistic motion; with `drag > 0`, collision timing differs from the displayed drag-integrated trajectory. Use `drag = 0` for this spike's collision test.

Not implemented / pending: mesh-particle rendering, analytic sphere/box collisions, multiple rebounds, Web Mobile validation, performance benchmark, inspector-driven geometry rebuild, and WebGL1 fallback.

### Plane collision smoke test

1. Use a fresh GPU particle material imported from the latest effect.
2. Spawn above the ground plane with `spawnExtent=(1,0,1)`, emitter node at world `Y=2`, `speed=0`, `gravity=(0,-9.8,0)`, `lifetime=3`, `drag=0`.
3. Enable `collideWithPlane`, set `collisionPlaneHeight=0`, `planeRestitution=0.6`.
4. In Preview, confirm particles hit the Y=0 plane and rebound once; disable collision and confirm they fall through.
5. Compare restitution `0` versus `1`. Confirm ordinary and stretched billboard paths still render.
6. Verify no new shader compile/link errors and that the emitter still adds approximately one draw call.


### Next Creator test

1. Pull changes and allow reimport of `advanced/playable-gpu-particles.effect`.
2. Verify default `stretchedBillboard=false` still renders ordinary particles in Preview.
3. Enable `stretchedBillboard`; compare `stretchFactor=0`, `1`, and `3` with nonzero speed.
4. Check shader compilation and that draw calls stay near one per emitter.
5. Do not mark M5.2 complete until stretched mode and mobile performance have been verified.

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

# Task 004 — Havok Backend Feasibility

## Objective

Port and re-validate the existing Creator 3.8.8 Havok prototype from
`KropAl-Playable/cocos-engine@codex/box3d-share` into the COCOS 4 playable-runtime fork,
keeping Havok optional and removable from ordinary builds.

The 3.8.8 branch is not just a proof-of-concept: it already contains a functional adapter,
loader, build-feature slicing, queries/constraints, benchmark harnesses, single-HTML WASM
packing validation, and production notes. Task 004 therefore starts as a **selective port +
compatibility audit**, not a greenfield integration.

The first milestone is intentionally **feasibility-first**:

1. integrate through the existing Cocos physics selector/adapter contract;
2. prove world + rigid body + primitive-shape behavior;
3. measure WASM / JS payload and startup cost;
4. only then expand to joints, ragdolls and vehicle helpers.

## Current port status

First COCOS 4 vertical slice is now on `feat/havok-backend`:

- ✅ pinned `@babylonjs/havok@1.3.14` in package + lockfile;
- ✅ deterministic runtime sync helper for the ESM factory + WASM;
- ✅ Creator 3.8.8 `HavokLoader` and typed Web API contract ported;
- ✅ PAL-based async WASM initialization ported;
- ✅ isolated `physics-havok` engine feature and `LOAD_HAVOK_MANUALLY` constant;
- ✅ `PhysicsSystem` manual-load gate extended for Havok;
- ✅ minimal selector adapter ported: world + rigid body + Box/Sphere/Capsule;
- ✅ shared-body, handle registry, collision contact bridge and transform-buffer world path ported;
- ✅ real-WASM smoke harness and body-sync benchmark ported;
- ✅ local COCOS 4 engine build completed after fixing the native external WASM path;
- ✅ Creator runtime log confirms `[havok]: Havok wasm lib loaded.`;
- ✅ local `npm run test:havok-wasm` validation;
- ✅ Feature Cropping exposes Havok;
- ✅ Creator rigid-body scene smoke validated with Box / Sphere / Capsule;
- ✅ contact stability reported high in local testing.

The first Havok core slice is therefore validated enough to move into framework/API work.

## Existing engine integration point

Cocos already exposes a backend registry through:

~~~ts
selector.register(id, wrapper)
selector.switchTo(id)
~~~

The wrapper contract can provide:

~~~text
PhysicsWorld
RigidBody
BoxShape
SphereShape
CapsuleShape
TrimeshShape
CylinderShape
ConeShape
TerrainShape
SimplexShape
PlaneShape
constraints
character controllers
~~~

Task 004 should plug into this abstraction instead of modifying RigidBody/Collider components directly.

Proposed backend id:

~~~text
havok
~~~

The Havok backend must remain opt-in. Existing builtin / cannon / bullet / physx paths must remain untouched.

## Existing 3.8.8 reference implementation

Reference branch:

~~~text
KropAl-Playable/cocos-engine
branch: codex/box3d-share
head: 7f5eb1890ef883e6a255c4f8047fe5731e12f06d
~~~

Useful pieces to port selectively:

- `cocos/physics/havok/havok-loader.ts`;
- `instantiate.ts` / `instantiated.ts`;
- `havok-world.ts`, `havok-rigid-body.ts`, shared-body/handle-registry/util/types;
- primitive/compound/mesh shape wrappers;
- ray/shape queries and constraints;
- feature registration in `cc.config.json`;
- `exports/physics-havok.ts`;
- real-WASM smoke and benchmark harnesses;
- single-HTML packer smoke methodology;
- capability/validation/playable-guideline documentation.

Do **not** cherry-pick the prototype commit wholesale: that branch also contains generated temporary
engine builds and unrelated extension/tool changes. Port the Havok source and build integration in
small reviewable commits.

## Candidate Web runtime

The proven Web runtime is `@babylonjs/havok@1.3.14`, which exposes the standalone Havok WebAssembly runtime independently of Babylon's scene/physics wrapper.

The 3.8.8 experiment exposed an important Creator-specific packaging issue: QuickCompiler could
resolve the package's conditional `types` export and pass `HavokPhysics.d.ts` to Rollup as
JavaScript. The working path vendors the Emscripten ESM factory beside the WASM and imports it by
relative source path, while keeping `@babylonjs/havok@1.3.14` as development provenance/types.

Do **not** import Babylon's HavokPlugin or Babylon scene abstractions. The adapter talks directly to
the Havok interface.

## Phase A — COCOS 4 port/feasibility gate

The 3.8.8 prototype already established useful desktop/build-size baselines:

~~~text
Havok WASM raw                         2,094,563 B
WASM Deflate 9 + Base64                 882,732 B
WASM Brotli Q9 + Base64                 766,656 B
Havok core engine build Deflate+B64   1,431,180 B
Havok core engine build Brotli Q9     1,239,252 B
~~~

These values are reference measurements, not COCOS 4 promises. Re-measure after the port.

Before expanding the COCOS 4 adapter, establish:

- package JS bytes;
- raw WASM bytes;
- gzip/brotli or final playable-pack size contribution;
- initialization time on desktop browser;
- initialization time on representative mobile/Safari where available;
- whether the runtime can be embedded/loaded reliably in a single-HTML playable pipeline;
- whether async WASM initialization conflicts with Cocos PhysicsSystem startup.

This phase may reject or constrain Havok before large adapter work is done.

### Gate

If the compressed payload/startup cost is clearly incompatible with the normal ~5 MB playable target, keep Havok as an explicit high-end/selected-project backend rather than a default production dependency.

## Phase B — minimal Cocos adapter

Target files should live in an isolated backend directory, conceptually:

~~~text
cocos/physics/havok/
  havok.ts
  havok-world.ts
  havok-rigid-body.ts
  shapes/
    havok-box-shape.ts
    havok-sphere-shape.ts
    havok-capsule-shape.ts
  havok-util.ts
~~~

First supported scope:

- PhysicsWorld lifecycle;
- gravity;
- fixed stepping;
- scene -> physics transform sync;
- physics -> scene transform sync;
- dynamic / static / kinematic bodies;
- mass;
- linear/angular velocity;
- force / impulse / torque;
- sleeping/wakeup;
- collision groups/masks;
- Box;
- Sphere;
- Capsule;
- basic raycast / raycastClosest.

Do not start with every shape or constraint.

## Phase 4.2 — Physics framework API expansion

This phase deliberately improves the shared Cocos physics authoring/runtime contract for **all**
backends instead of adding Havok-only gameplay helpers.

Current implementation on `feat/havok-backend`:

- ✅ backend capability metadata contract;
- ✅ serialized `RigidBody.gravityScale`;
- ✅ serialized `automaticCenterOfMass` + `centerOfMass`;
- ⏸ freeze-position / freeze-rotation controls are retained only as hidden serialized/runtime API for compatibility; Creator smoke showed no observable solver effect in the Havok path;
- ⏸ Havok `linearFactor` / `angularFactor` currently act only as input-side masks in the adapter and do not constrain collision-solver response; exact axis locking is moved to backlog;
- ✅ `sleepThreshold` and `useCCD` are now serialized/Inspector-authorable;
- ✅ Havok native gravity factor support;
- ✅ Havok custom center-of-mass support through mass properties;
- ✅ `PhysicsMaterial.bounciness` alias for restitution;
- ✅ Collider-level `bounciness` and `friction` runtime shortcuts that create a local material instance when required;
- ✅ PhysicsMaterial kept authoritative in the Inspector (duplicate Collider friction/bounciness fields removed from editor authoring);
- ✅ Havok restitution combine default changed from geometric mean to arithmetic mean so a bouncy body does not lose all restitution against a zero-restitution floor;
- ⏳ validate serialization + runtime changes across Havok / Bullet / Cannon / PhysX;
- ⏳ extend exact gravity-scale support to additional backends where practical;
- ⏳ evaluate native/exact axis locking for Havok (current generic factor path is not yet claimed as exact solver locking);
- ⏳ add velocity limits and custom inertia in a second 4.2 pass;
- ✅ added shared `EPhysicsMaterialCombine` with Geometric Mean / Minimum / Maximum / Average / Multiply;
- ✅ PhysicsMaterial now serializes independent `frictionCombine` and `restitutionCombine`;
- ✅ defaults: friction = Geometric Mean, restitution = Average;
- ✅ Havok maps all five combine modes natively;
- ✅ backend capability metadata exposes `materialCombineModes`; Cannon/Bullet/PhysX are currently marked unsupported for exact per-material combine selection;
- ⏳ validate combine-mode serialization and Havok runtime behavior in Creator.

The API should exist at the framework level even when a backend cannot implement a feature exactly.
Backend capability metadata is used to distinguish exact support from fallback behavior.

### 4.2 second-pass validation

Recommended Creator smoke:

~~~text
Axis locks
  Freeze Position X only -> impacts may move Y/Z but not X
  Freeze Rotation X/Z -> collision torque should still rotate Y only
  Toggle locks at runtime -> constraint should rebuild from current pose

Velocity limits
  maxLinearVelocity = 2
  maxAngularVelocity = 1
  apply large impulses and verify post-solve clamping

Custom inertia
  automaticInertiaTensor = false
  compare (1,1,1) against strongly biased tensors such as (0.2,4,4)
  verify rotation response changes without changing mass or COM
~~~

No automated-test pass is claimed for this second pass until the local engine/Creator checks run.

### Axis-lock backlog

Do not spend more Task 004.2 time on freeze-axis authoring. Revisit only when one of these is available and validated:

- a Havok body/motion-property API that exposes native locked degrees of freedom;
- a proven constraint configuration whose axes are expressed correctly for the fixed-world body and demonstrably constrains contact-solver response;
- a cross-backend contract that distinguishes true solver locks from input-side velocity/force factors.

Until then, Freeze Position / Freeze Rotation stay hidden in the Inspector, Havok reports `axisLocks=false`, and legacy Linear/Angular Factor remain unchanged.

### 4.2 design rule

Do not silently pretend every backend has identical capabilities. Prefer:

1. exact native implementation;
2. correct lightweight emulation;
3. explicit capability=false fallback.

This is particularly important for center-of-mass control, gravity scaling, CCD and solver locks.

## Phase C — feature expansion

Only after Phase B is stable:

- cylinder / cone;
- trimesh;
- triggers and collision events;
- sweep tests;
- point-to-point / hinge / fixed / configurable constraints;
- advanced character / articulated-body helpers only after the shared framework and constraints are mature;
- a redesigned Ragdoll v2 if a production use-case justifies it;
- a redesigned Vehicle v2 if a production use-case justifies it.

The older 3.8.8 force-field / ragdoll / vehicle extras are **reference material only** and will not
be ported wholesale. Force fields are not planned as a standalone subsystem; radial/vortex effects
can be lightweight query + impulse utilities if needed.

## Async initialization problem

The current Cocos PhysicsSystem constructs the selected backend synchronously during engine initialization.

Havok Web initializes asynchronously because the WASM runtime is loaded/instantiated before the interface becomes usable.

Task 004 must therefore solve this explicitly rather than hiding a Promise behind the synchronous `PhysicsWorld` constructor.

Candidate approaches to evaluate:

1. preload Havok before `PhysicsSystem.constructAndRegister()`;
2. add an opt-in manual-load path analogous to existing manually loaded physics backends;
3. introduce a tiny backend readiness layer that does not affect synchronous backends.

Prefer the smallest isolated change.

## Build / packing requirements

For playable delivery:

- no CDN dependency;
- WASM must be locally packaged;
- single-HTML packing must have a defined path;
- avoid shipping Havok when another backend is selected;
- avoid pulling Babylon core/runtime into the bundle;
- preserve tree-shaking / backend stripping where possible.

## Benchmark matrix

Compare Havok against the project's normal lightweight backend for representative playable workloads.

~~~text
A. 1 dynamic box on static ground
B. 20 primitive rigid bodies
C. 100 primitive rigid bodies
D. impulse-heavy collision pile
E. raycast-heavy scripted gameplay
F. simple hinge chain
~~~

Record:

- JS/WASM/build-size delta;
- startup / WASM init time;
- steady-state FPS;
- physics step time where measurable;
- memory where practical;
- browser/WebView compatibility.

## v0.1 acceptance criteria

A Havok v0.1 experiment is successful if:

- it registers through the normal Cocos selector;
- stock physics components can drive a Havok world without Havok-specific gameplay code;
- Box/Sphere/Capsule + dynamic rigid bodies work;
- forces/impulses work;
- raycast works;
- no changes are required to Cage or Water;
- backend remains optional and removable from builds;
- payload/startup measurements are recorded;
- the size/performance trade-off is convincing for at least one class of high-end playable.

## Non-goals for first pass

- replacing Cocos physics abstractions;
- making Havok mandatory;
- full Havok API exposure;
- vehicles before rigid-body adapter validation;
- ragdoll editor tooling before joint support is stable;
- native Havok integration;
- networking/deterministic multiplayer physics.

## First implementation step

Start by porting the smallest proven vertical slice from the 3.8.8 branch:

1. vendor/pin Havok 1.3.14 ESM factory + WASM using the proven relative-import layout;
2. port `HavokLoader` and the PAL-based async instantiation path;
3. add `physics-havok` as an isolated engine feature and manual-load constant;
4. port the real-WASM smoke test;
5. verify COCOS 4 build + browser initialization + single-HTML packaging;
6. port minimal `HavokWorld` + `HavokRigidBody` + Box/Sphere/Capsule;
7. then bring over the transform-buffer sync optimization and remaining validated features.

The previous adapter's `HP_World_GetBodyBuffer` + per-body transform-offset path is particularly
valuable: its desktop benchmark showed roughly 15–23× lower transform-read overhead than calling
`HP_Body_GetQTransform` per body. Preserve that design unless COCOS 4 provides a better native
batch-sync path.

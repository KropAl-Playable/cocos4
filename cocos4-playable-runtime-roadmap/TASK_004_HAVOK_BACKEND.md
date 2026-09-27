# Task 004 — Havok Backend Feasibility

## Objective

Evaluate Havok as an optional high-end physics backend for the playable-runtime fork without making it a mandatory dependency for ordinary builds.

The first milestone is intentionally **feasibility-first**:

1. integrate through the existing Cocos physics selector/adapter contract;
2. prove world + rigid body + primitive-shape behavior;
3. measure WASM / JS payload and startup cost;
4. only then expand to joints, ragdolls and vehicle helpers.

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

## Candidate Web runtime

The initial Web candidate is `@babylonjs/havok`, which exposes the standalone Havok WebAssembly runtime independently of Babylon's scene/physics wrapper.

Initialization shape:

~~~ts
import HavokPhysics from '@babylonjs/havok';

const havok = await HavokPhysics();
~~~

Do **not** import Babylon's HavokPlugin or Babylon scene abstractions. Task 004 should talk directly to the returned Havok interface and implement Cocos physics specs itself.

Pin the package version during the experiment rather than tracking latest implicitly.

## Phase A — payload/startup gate

Before implementing the full adapter, establish:

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

## Phase C — feature expansion

Only after Phase B is stable:

- cylinder / cone;
- trimesh;
- triggers and collision events;
- sweep tests;
- point-to-point / hinge / fixed / configurable constraints;
- ragdoll authoring helpers;
- force-field / constant-force helpers;
- 2-wheel / 4-wheel vehicle helpers.

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

Start with a **runtime probe**, not the full adapter:

1. add the pinned Havok Web dependency;
2. create an isolated loader that initializes the WASM runtime;
3. expose initialization timing and runtime availability;
4. verify it can be bundled by the custom engine build;
5. measure payload delta;
6. only then implement `HavokWorld` and register `havok` with the selector.

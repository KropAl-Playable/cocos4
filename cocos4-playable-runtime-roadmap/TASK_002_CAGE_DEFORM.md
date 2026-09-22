# Task 002 — Cage Deform v0.1

## Objective

Implement lightweight GPU-driven deformation for trees, initially to simulate:

- wind sway;
- crown inertia;
- interactive bending from nearby impulses.

The first prototype is deliberately **not** a full tetrahedral cage system.

## Architecture

```text
Mesh vertices
   |
prebaked influences
   |
   v
CageDeformer component
   |
small control-point simulation
   |
GPU parameters
   |
vertex shader deformation
```

## Component

Suggested component:

```text
CageDeformer
```

Initial responsibilities:

- own/reference control points;
- own baked vertex influence metadata;
- update wind/spring state;
- accept impulses;
- upload compact deformation data;
- expose debug visualization.

## Control hierarchy

Start with approximately:

```text
root
  |
trunk_low
  |
trunk_mid
  |
trunk_top
 /   |   \
L   crown  R
```

5–15 controls per tree is sufficient for the first test.

Root must remain fixed or strongly constrained.

## Weight bake

For each render vertex, derive influence from:

- height;
- distance to controls;
- optional branch region/mask.

Prefer no more than 2–4 influences per vertex.

Do not perform nearest-control searches every frame.

Bake once.

## GPU deformation

Vertex shader receives:

- rest position;
- influence indices/weights;
- current control transforms/offsets.

Then reconstructs the deformed vertex position.

No CPU-side per-vertex mesh update is allowed.

Normals must remain visually acceptable. For v0.1, choose the cheapest correct-enough strategy and document limitations.

## Wind

Use two layers:

### Low frequency

Moves the cage/control hierarchy.

Responsible for:

- trunk bend;
- large branch movement;
- crown lag.

### High frequency

Optional procedural shader movement.

Responsible for:

- leaves;
- small branches;
- subtle flutter.

Do not make high-frequency movement part of the cage solver.

## Spring model

A simple damped spring is enough:

```text
acceleration += externalForce
acceleration += (restPosition - position) * stiffness
velocity += acceleration * dt
velocity *= damping
position += velocity * dt
```

Use a stable fixed-step or carefully clamped delta if needed.

No general rigid-body solver is required.

## Impulse API

Target API:

```ts
addImpulse(
    worldPosition: Vec3,
    direction: Vec3,
    strength: number,
    radius?: number
): void
```

The impulse should affect nearby cage controls with distance falloff.

Possible sources:

- vehicle passing;
- explosion;
- projectile hit;
- character collision.

## Debug visualization

Required:

- control points;
- rest positions;
- links/hierarchy;
- influence visualization or selected-control heatmap;
- optional current displacement vectors.

Without debug visualization, do not proceed to generalized cages.

## Test matrix

Compare:

```text
A static
B procedural vertex wind only
C cage wind
D cage wind + procedural leaf flutter
E cage wind + impulse
```

Test multiple instances.

## Acceptance criteria

- deformation is visually stable;
- tree base stays planted;
- crown lags naturally;
- impulse produces a readable reaction;
- tree returns toward rest;
- no per-vertex CPU update;
- no persistent per-frame allocations;
- feature can be disabled without changing mesh appearance.

## Do not implement yet

- tetrahedralization;
- soft-body collision;
- Havok coupling;
- GPU compute simulation;
- self collision;
- topology changes;
- automatic destruction.

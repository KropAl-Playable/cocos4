# Roadmap

## Phase 0 — Baseline

### Goals

- establish reproducible custom-engine build;
- preserve a clean upstream reference;
- select one existing project/scene containing trees;
- record baseline metrics.

### Record

- engine commit;
- Creator version;
- HTML size;
- compressed package size;
- target device;
- average FPS;
- approximate CPU/GPU frame time if available;
- number of trees;
- draw calls;
- triangle count.

Exit criterion: baseline can be rebuilt and reproduced.

---

## Phase 1 — AO Baker v0.1

### Scope

- editor command for selected static meshes;
- hemisphere-based AO sampling;
- scene-aware occluders;
- bake to a configurable vertex-color channel;
- preview before/after;
- restore/rebake workflow.

### Explicitly out of scope

- runtime SSAO;
- lightmap atlas generation;
- denoising pipeline;
- GPU compute baking;
- bent normals;
- texture AO.

### Exit criteria

- existing scene receives visibly improved contact/depth perception;
- no meaningful runtime CPU cost;
- negligible build-size increase;
- AO data survives build/import pipeline;
- feature is optional.

---

## Phase 2 — Cage Deform v0.1

### Scope

- `CageDeformer` component;
- 5–15 authored/generated control points;
- automatic/simple influence bake;
- vertex-shader deformation;
- debug visualization;
- procedural wind;
- spring return;
- external impulse API.

Suggested API:

```ts
deformer.addImpulse(worldPosition, direction, strength);
deformer.windStrength = 1.0;
deformer.windFrequency = 0.8;
```

### Exit criteria

- tree trunk/crown visibly sway;
- root remains stable;
- nearby event can bend the tree;
- no CPU per-vertex work;
- acceptable result on target mid/low mobile hardware.

---

## Phase 3 — Production Validation

Compare:

```text
A. static tree
B. classic procedural vertex wind
C. cage wind
D. cage wind + impulse interaction
```

Measure:

- CPU frame;
- GPU frame;
- draw calls;
- memory;
- HTML/package size;
- visual stability;
- device compatibility.

Decision gate:

Only continue toward generalized cages if C/D provide a clear visual advantage at acceptable cost.

---

## Phase 4 — Cage Deform v0.2

Possible extensions:

- automatic cage generation;
- branch-aware weighting;
- LOD deformation;
- shared/batched cage buffers;
- collision-driven impulses;
- deformation masks;
- authoring gizmos.

---

## Phase 5 — Generalized Cage / Tetrahedral Research

Only after v0.1 is proven.

Research:

- tetrahedralization;
- containing-tetrahedron lookup;
- barycentric weight bake;
- GPU reconstruction;
- cage topology constraints;
- deformation stability;
- storage cost vs skeletal weighting.

Potential targets:

- trees;
- vehicle damage;
- jelly/soft props;
- large creature deformation;
- localized destruction.

---

## Later roadmap

After AO + cage validation:

1. packed bake channels;
2. reflection/light bake improvements;
3. advanced water + cheap buoyancy;
4. GPU particles;
5. Havok backend experiment;
6. SDF-based interaction/VFX;
7. optional WebGPU/compute acceleration.

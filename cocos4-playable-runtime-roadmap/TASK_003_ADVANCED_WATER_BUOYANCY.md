# Task 003 — Advanced Water + Buoyancy

## Objective

Implement a visually rich but compact water system for playable ads, with a lightweight CPU buoyancy model that matches the visible GPU surface.

The key requirement is:

> **one wave definition, two consumers**

~~~text
Wave parameters
      |
      +---------------------+
      |                     |
      v                     v
vertex/fragment shader   CPU sampler
      |                     |
visible water           buoyancy/gameplay
~~~

No GPU readback is allowed.

## Target use cases

- stylized ocean/lake/river surfaces;
- floating crates and props;
- boats/rafts;
- motorcycles/vehicles passing through shallow water;
- wakes;
- splashes;
- impact/ripple VFX;
- shoreline/contact foam hooks.

This is not a general CFD or fluid simulation.

## Design constraints

- WebGL-compatible first;
- no mandatory large texture sets;
- deterministic analytical waves;
- low CPU cost;
- no per-water-vertex CPU updates;
- buoyancy independent of render resolution;
- visual-only detail may be richer than the CPU collision surface;
- graceful quality tiers.

## Shared wave model

Start with 2–4 low-frequency analytical waves.

Preferred first implementation:

~~~text
Wave {
    direction: Vec2
    amplitude: number
    wavelength/frequency: number
    speed: number
    steepness: number
    phase: number
}
~~~

Gerstner-style waves are the first candidate because they provide horizontal displacement and analytical derivatives/normals.

If that complexity is unnecessary for the art style, keep the API and allow a cheaper sine-wave implementation.

Conceptually both CPU and shader evaluate:

~~~text
height(positionXZ, time)
displacement(positionXZ, time)
normal(positionXZ, time)
~~~

The equations and parameter conventions must be documented once to avoid CPU/GPU drift.

## Shader architecture

Suggested isolated effect:

~~~text
builtin-standard-water.effect
~~~

Do not patch global builtin-standard.

### Vertex stage

Responsible for:

- low-frequency wave displacement;
- optional horizontal Gerstner displacement;
- world-space surface position;
- large-scale normal basis or data needed to reconstruct it.

### Fragment stage

Responsible for:

- shallow/deep color;
- Fresnel;
- specular response;
- small normal/detail waves;
- foam mask hooks;
- wake/intersection contribution;
- optional cheap refraction-like distortion.

### Quality tiers

~~~text
LOW
- 2 gameplay waves
- analytical normal
- simple Fresnel/specular

MEDIUM
- 3–4 gameplay waves
- one visual ripple/detail layer
- foam/wake

HIGH / optional
- richer normal/detail
- extra reflection/refraction features
~~~

Quality tiers must not change the CPU buoyancy surface.

## CPU water sampler

Target API:

~~~ts
interface IWaterSample {
    height: number;
    normal: Vec3;
    velocity?: Vec3;
}

sampleWater(
    worldPosition: Vec3,
    time: number,
    out?: IWaterSample,
): IWaterSample;
~~~

The implementation evaluates only gameplay wave layers.

No mesh queries and no GPU synchronization.

## Buoyancy component

Suggested component:

~~~text
WaterBuoyancy
~~~

Responsibilities:

- reference a water source / wave profile;
- maintain a small set of local sample points;
- query water height/normal;
- compute buoyancy forces or transform offsets;
- expose damping and stability controls;
- optionally integrate with Cocos/Havok rigid bodies later.

Sample-count guidance:

~~~text
small prop      1–2
crate/barrel    2–4
raft/boat       4
large vehicle   4–8
~~~

A 4-point rig is enough for the first prototype.

## Simplified force model

Per sample point:

~~~text
depth = waterHeight - sampleWorldY

if depth > 0:
    upwardForce += depth * buoyancy
    dampingForce -= verticalVelocity * damping
~~~

Optionally orient the body using sampled water normals.

Do not add a full fluid-drag model in v0.1 unless the simple model is visibly insufficient.

## Wake / ripple hooks

Provide a cheap event path rather than simulating a persistent fluid field.

Suggested conceptual API:

~~~ts
water.addImpulse({
    worldPosition,
    radius,
    strength,
    lifetime,
});
~~~

Possible visual representations:

- small fixed array of ripple sources passed to shader;
- particle/VFX emitters;
- decals/projected quads;
- procedural wake strips.

For v0.1 keep source count bounded and deterministic.

## Shared parameter storage

Avoid duplicating authoring values between component and material.

Potential structure:

~~~text
WaterWaveProfile
  ├─ wave[0..3]
  ├─ gravity / time scale
  ├─ visual detail params
  └─ quality settings
~~~

Renderer and buoyancy sampler read the same profile.

If direct asset sharing between material and component is awkward, use one authoritative component and upload its values to material instances.

## Performance targets

For one water body:

- zero per-vertex CPU work;
- O(waves × buoyancySamples) CPU cost;
- no runtime texture generation;
- no GPU readback;
- no persistent per-frame allocations;
- small constant uniform payload.

For multiple floating bodies:

~~~text
CPU work ≈ body count × sample count × gameplay wave count
~~~

This must remain predictable and cheap.

## Debug tools

Required:

- display buoyancy sample points;
- show sampled water height;
- draw sampled normal;
- show submerged depth;
- optional CPU-vs-visible-wave comparison marker.

A useful validation mode is a marker whose Y comes exclusively from the CPU sampler. It should visually sit on the large-scale rendered surface.

## Test matrix

### Visual

- calm water;
- medium wind;
- exaggerated waves;
- grazing-view Fresnel;
- low/high camera angles;
- mobile portrait scene;
- multiple quality tiers.

### CPU/GPU agreement

Test fixed positions over time:

~~~text
P0 center
P1 near edge
P2 large X/Z coordinates
P3 moving sample
~~~

CPU height should track the rendered low-frequency surface closely.

### Buoyancy

- single floating cube;
- asymmetric 4-point raft;
- changing wave amplitude;
- variable frame rate;
- impulse/splash;
- object entering/exiting water;
- object rotated/scaled.

### Playable performance

- 1 body;
- 10 bodies;
- 30 bodies where practical;
- Safari/iPhone;
- Android WebView when available.

## Acceptance criteria

- water looks materially better than a flat scrolling-normal shader;
- visible large waves and CPU buoyancy agree;
- a 4-point body floats and tilts stably;
- no GPU readback;
- no per-vertex CPU simulation;
- low-quality WebGL mode is viable;
- system can be disabled without affecting unrelated rendering;
- build-size increase is acceptable for a playable.

## Out of scope for v0.1

- FFT ocean;
- Navier–Stokes / real fluid simulation;
- runtime mesh tessellation;
- GPU-to-CPU readback;
- arbitrary shoreline simulation;
- large dynamic ripple heightfields;
- underwater volumetrics;
- heavyweight caustics;
- Havok-specific coupling.

Havok should consume the same water-sampling API later rather than forcing Water v0.1 to depend on Havok.

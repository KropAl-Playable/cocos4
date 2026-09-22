# Task 001 — AO Baker v0.1

## Objective

Create an editor/offline AO baker for static meshes that stores ambient occlusion in vertex data and adds effectively zero runtime CPU cost.

## First implementation target

Bake AO into a selectable vertex-color channel.

Do not implement texture AO yet.

## Proposed algorithm

For each target vertex:

1. transform vertex position and normal to world space;
2. offset the ray origin by a small normal bias;
3. construct a hemisphere oriented around the vertex normal;
4. cast `N` rays against selected/static scene occluders;
5. count/weight occluded samples;
6. optionally distance-weight hits;
7. convert visibility to AO;
8. write AO to the configured vertex attribute/channel.

Conceptually:

```text
visibility = unoccludedSamples / totalSamples
AO = remap(visibility, strength, contrast)
```

## Important implementation questions to resolve first

- Which existing Cocos geometry/raycast acceleration utility is suitable for editor-time use?
- Can mesh CPU geometry be read directly at editor time?
- How does the engine safely rewrite vertex buffers/assets?
- Should the first prototype duplicate the mesh instead of modifying source data?
- How are imported model meshes reimported, and how can baked data survive?

Do not code before answering these from the current source tree.

## UI / controls

Minimum settings:

```text
Sample Count
Max Distance
Ray Bias
Strength
Contrast
Self Occlusion on/off
Scene Occluders on/off
Target vertex-color channel
```

Development defaults should prioritize iteration speed.

## Sampling

Start with deterministic hemisphere samples.

Prefer a precomputed low-discrepancy sequence over random samples so rebakes are reproducible.

Suggested development tiers:

```text
Preview:  16 samples
Normal:   32 samples
High:     64 samples
```

Do not optimize sample count prematurely.

## Scene-aware AO

Support two modes:

```text
Self
Self + selected/static scene occluders
```

The second mode is important for:

- tree-ground contact;
- wall corners;
- props near buildings;
- clustered environment objects.

## Runtime integration

Keep it minimal.

Shader contract conceptually:

```glsl
float ao = <vertex channel>;
finalColor.rgb *= mix(1.0, ao, aoStrength);
```

Do not force all standard materials to use AO during v0.1.

Create a test material/effect or the smallest opt-in integration.

## Debug requirements

Provide at least one:

- vertex AO visualization mode;
- grayscale debug material;
- generated statistics.

Useful statistics:

```text
vertex count
ray count
bake duration
min/avg/max AO
```

## Acceptance test

Test on an existing tree scene.

Check:

- tree trunk contact with ground;
- branch intersections;
- crown depth;
- nearby-object occlusion;
- no visible channel corruption;
- same result after project restart/build.

## Size/performance target

Runtime:

- no additional ray tests;
- no per-frame AO computation;
- no new texture for v0.1.

Expected build-size delta should be limited primarily to code and any increase in vertex attribute data.

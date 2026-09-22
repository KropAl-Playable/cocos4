# Test and Benchmark Plan

## Baseline scene

Use one existing playable project containing trees.

Record the exact project revision and engine revision.

## Devices

At minimum:

- desktop development machine;
- one representative iPhone;
- one mid/low Android device when available.

For playable ads, also validate inside the closest available WebView/ad-network environment.

## Metrics

For every experiment record:

```text
Engine revision
Feature configuration
HTML size
ZIP/compressed size
Startup time
Average FPS
CPU frame time
GPU frame time
Draw calls
Triangles
Texture memory if available
JS heap if useful
Visual notes
```

## AO tests

### Correctness

- isolated mesh;
- mesh resting on ground;
- two nearby meshes;
- concave geometry;
- tree trunk + crown.

### Quality

Compare sample counts:

```text
16
32
64
```

Check noise, banding, excessive self-shadowing, and ray-bias artifacts.

### Data

Verify:

- channel is preserved after save/reload;
- channel is preserved in production build;
- other vertex channels are unchanged;
- mesh compression pipeline does not destroy AO usefulness.

## Cage tests

### Static correctness

With zero wind and zero impulse:

```text
deformed mesh == rest mesh
```

within expected precision.

### Wind

Test:

```text
1 tree
10 trees
30 trees
100 trees
```

as applicable to the scene.

### Impulse

Test:

- impulse at trunk;
- impulse near crown;
- outside radius;
- repeated impulses;
- extreme strength;
- variable frame rate.

### Failure cases

- missing cage data;
- incompatible mesh;
- material without cage shader support;
- component disabled;
- object scaled/rotated;
- duplicated/prefab instances.

## Comparison table

Maintain results like:

| Variant | Size Δ | CPU ms | GPU ms | FPS | Visual result |
|---|---:|---:|---:|---:|---|
| Baseline | 0 | | | | |
| AO | | | | | |
| Vertex wind | | | | | |
| Cage wind | | | | | |
| Cage + impulse | | | | | |

## Decision rule

Do not promote an experiment into the reusable playable toolkit unless:

- the visual gain is obvious in a side-by-side test;
- the build-size delta is acceptable;
- low/mid-tier devices remain usable;
- fallback behavior is reliable.

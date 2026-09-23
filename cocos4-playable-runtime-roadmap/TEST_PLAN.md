# Test and Benchmark Plan

## Baseline

Maintain representative playable scenes for the systems being tested and record exact project/engine revisions.

## Devices

At minimum:

- desktop development machine;
- representative iPhone/Safari/WebView;
- mid/low Android device when available;
- closest available ad-network WebView environment.

## Metrics

For every experiment record:

~~~text
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
Visual/gameplay notes
~~~

## AO tests

Verify isolated meshes, ground contact, nearby occluders, concave geometry, repeated shared meshes and tree trunk/crown cases.

Compare 16/32/64 samples and check noise, banding, self-shadowing and ray-bias artifacts.

Verify AO survives save/reload/build, shared meshes remain shared, other channels are preserved, cage/custom materials consume the same AO convention, and compression/import keeps useful precision.

## Cage tests

With wind/flutter/impulse disabled, deformed mesh should match rest mesh within expected precision.

Test 1/10/30/100 trees where practical and verify root stability, trunk arc, crown secondary motion, editor/browser consistency and variable frame rate.

Impulse cases:

- trunk;
- crown;
- outside radius;
- repeated impulses;
- extreme strength;
- moving vehicle pass-by.

Failure cases:

- missing cage data;
- incompatible mesh;
- material without cage support;
- component disabled;
- object scaled/rotated;
- duplicated/prefab/shared instances.

## Water tests

### CPU/GPU surface agreement

Place debug markers at fixed and moving X/Z positions. CPU-sampled height should visually match the rendered low-frequency surface.

Test t=0, long-running time, negative/large coordinates and moving samples.

### Buoyancy

Test:

~~~text
1-point object
2-point object
4-point raft
4–8 point vehicle/boat
~~~

Validate float height, pitch/roll, damping, entry/exit from water, variable dt and extreme wave amplitudes.

### Quality tiers

Compare LOW / MEDIUM / HIGH where implemented. The gameplay surface must remain identical across tiers.

### Wake / impulse

Validate bounded ripple/wake sources, lifetime cleanup and visual falloff.

## Comparison table

| Variant | Size Δ | CPU ms | GPU ms | FPS | Visual/gameplay result |
|---|---:|---:|---:|---:|---|
| Baseline | 0 | | | | |
| AO | | | | | |
| Vertex wind | | | | | |
| Cage wind | | | | | |
| Cage + impulse | | | | | |
| Water LOW | | | | | |
| Water MEDIUM | | | | | |
| Water + buoyancy | | | | | |

## Promotion rule

Do not promote an experiment into the reusable playable toolkit unless the visual/gameplay gain is obvious, compressed build-size delta is acceptable, low/mid-tier devices remain usable, fallback behavior is reliable, authoring is practical and target WebView compatibility is acceptable.

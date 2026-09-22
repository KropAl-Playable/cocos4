# COCOS 4 Playable Runtime — Experimental Roadmap

Goal: extend a local COCOS 4 fork for highly visual, highly interactive playable ads under a ~5 MB delivery budget.

The first experiments are deliberately narrow:

1. **AO Baker** — editor/offline ambient-occlusion baking with near-zero runtime cost.
2. **Cage Deform** — lightweight GPU-driven deformation for trees/vegetation, initially for wind and impulses.

This repository should remain compatible with stock Cocos Creator 3.8.8 while the experiments are developed.

## Core principles

- Prefer **offline baking** over runtime post-processing.
- Prefer **vertex data / procedural math** over new textures.
- Prefer **GPU deformation** over per-vertex CPU updates.
- Keep WebGL compatibility unless a feature explicitly targets WebGPU.
- Never regress the built-in renderer or physics path.
- Every feature must be measurable in:
  - HTML/build size delta;
  - CPU frame cost;
  - GPU frame cost;
  - memory delta;
  - visual benefit.
- Build experimental features behind explicit switches.

## Suggested development order

1. Establish fork/repository workflow.
2. Add benchmark/demo scene and measurement checklist.
3. Implement AO Baker v0.1 using vertex colors.
4. Validate AO on an existing production scene.
5. Implement Cage Deform v0.1 using a simplified control hierarchy.
6. Add procedural wind.
7. Add spring response and external impulses.
8. Compare baseline vs procedural wind vs cage wind vs cage + interaction.
9. Only after validation, consider tetrahedral interpolation and general-purpose deformation.

See the other Markdown files in this directory for detailed instructions.

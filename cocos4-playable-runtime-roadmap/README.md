# COCOS 4 Playable Runtime — Experimental Roadmap

Goal: extend the local COCOS 4 fork with unusually rich visuals and interaction while respecting the extreme constraints of playable ads.

The central optimization target is:

> **visual / physical information per byte**

Rather than turning Cocos into a general-purpose heavyweight engine, this project adds narrowly scoped systems that are unusually valuable for playable production.

## Current roadmap

| Order | System | State |
|---:|---|---|
| 1 | AO / lighting baker | ✅ working v0.1 |
| 2 | Cage deformation | 🟡 nearly complete v0.1 |
| 3 | Advanced water + buoyancy | ⏭ next |
| 4 | Havok backend | planned |
| 5 | GPU particles | planned |
| 6 | GPU-driven VFX / compute | planned |
| 7 | SDF collision / VFX | research |
| 8 | GPU culling / indirect rendering | research |

AO and Cage establish reusable patterns for editor/offline baking, compact vertex-data transport, shared derived meshes, GPU deformation, small CPU simulation proxies, isolated opt-in shaders and WebGL-safe fallbacks.

Before moving fully into Water, Cage v0.1 still needs a short integration pass: persistent authoring/bake flow, debug tooling and Vertex AO support in the cage material.

## Core principles

- Prefer **offline baking** over runtime post-processing.
- Prefer **procedural math and vertex data** over large textures.
- Prefer **GPU work** when data naturally lives per vertex/particle.
- When gameplay needs the same phenomenon, use a **small analytical CPU proxy** instead of GPU readback.
- Preserve WebGL compatibility unless a feature explicitly targets WebGPU.
- Keep experimental systems opt-in.
- Never regress the stock renderer or physics path.
- Measure HTML/build size, compressed size, startup, CPU/GPU cost, memory and visual/gameplay benefit.

## Documents

- ARCHITECTURE.md — shared architecture and system boundaries.
- ROADMAP.md — full ordered roadmap and decision gates.
- TASK_001_AO_BAKER.md — AO implementation.
- TASK_002_CAGE_DEFORM.md — Cage deformation.
- TASK_003_ADVANCED_WATER_BUOYANCY.md — next major task.
- TEST_PLAN.md — benchmark/acceptance methodology.
- GIT_WORKFLOW.md / AGENTS.md / CLAUDE.md — repository and agent workflow.

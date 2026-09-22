# AGENTS.md — Instructions for Codex and Other Coding Agents

## Project mission

This is an experimental COCOS 4 fork optimized for advanced playable-ad rendering and interaction under strict download-size constraints.

Current priorities:

1. Offline/editor **AO baking**.
2. Lightweight **Cage Deformation** for vegetation wind and interactive bending.

Do not broaden scope without an explicit task.

## Non-negotiable constraints

- Preserve compatibility with **Cocos Creator 3.8.8**.
- Do not break the stock engine build.
- Do not replace existing rendering/physics backends.
- New experimental systems must be opt-in.
- Prefer minimal patches over broad architectural rewrites.
- Preserve WebGL paths.
- Avoid new large runtime dependencies.
- Avoid runtime allocations in frame-critical paths.
- Do not add textures/assets when equivalent data can live in mesh attributes.
- Do not silently modify imported production assets.
- Keep all editor-time destructive operations reversible or explicitly duplicated.

## Required workflow for every task

Before coding:

1. Read the task Markdown file.
2. Locate the existing Cocos subsystem that owns the behavior.
3. Identify the minimum integration boundary.
4. Write a short implementation plan before editing.
5. Record likely build-size and runtime impact.

During coding:

1. Work in small commits.
2. Prefer new modules/components over invasive edits.
3. Add debug visualization when introducing spatial algorithms.
4. Keep data formats versioned if serialized.
5. Comment only non-obvious engine integration or math.

After coding:

1. Run the relevant engine build.
2. Verify Creator opens with the custom engine.
3. Verify stock scenes still render.
4. Verify the experimental feature can be disabled.
5. Report:
   - modified files;
   - architectural decisions;
   - known limitations;
   - measured or estimated size/performance impact;
   - next recommended step.

## Performance philosophy

Optimization priority:

1. eliminate runtime work;
2. move work to editor/offline bake;
3. move suitable per-vertex work to GPU;
4. reduce data transfer and allocations;
5. optimize arithmetic last.

Never optimize by sacrificing deterministic fallback behavior without documenting it.

## Scope discipline

If a task appears to require changing more than one major subsystem, stop and propose an adapter boundary first.

Examples:

- AO baking should not require a new runtime renderer.
- Cage wind should not require Havok.
- Interactive tree bending should not require a general soft-body solver.

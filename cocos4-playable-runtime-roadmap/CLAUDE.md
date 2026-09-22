# CLAUDE.md — Working Rules

Read `AGENTS.md`, `ARCHITECTURE.md`, and the active task file before modifying code.

## Current milestone

Deliver two isolated prototypes:

- `AO Baker v0.1`
- `Cage Deform v0.1`

The goal is validation on an existing playable-ad project, not a general-purpose final engine feature.

## Decision rules

When multiple implementations are possible, choose the one that:

1. adds the least runtime cost;
2. adds the least build size;
3. changes the fewest Cocos core files;
4. remains inspectable/debuggable in Creator;
5. can be upgraded later without invalidating authored content.

## Avoid

- speculative framework creation;
- new third-party dependencies unless strictly required;
- WebGPU-only implementation for these first two tasks;
- CPU per-vertex deformation;
- runtime SSAO;
- hidden global state;
- per-frame object creation;
- changing asset serialization without versioning.

## Expected response after each coding pass

Return:

```text
Summary
Files changed
How it works
How to test
Performance/build-size impact
Known limitations
Next step
```

If the requested change is unsafe or conflicts with Cocos internals, explain the exact boundary and propose the smallest alternative.

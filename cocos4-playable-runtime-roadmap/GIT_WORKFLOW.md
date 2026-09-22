# Git Workflow

## Recommended setup

Do **not** work indefinitely with uncommitted changes.

Use Git locally from day one. Local commits do not affect the upstream Cocos repository and do not require pushing anything to GitHub.

### Option A — public GitHub fork

Use this when publishing the experimental fork is acceptable.

1. Fork `cocos/cocos4` to your GitHub account.
2. Clone your fork.
3. Add the official repository as `upstream`.
4. Develop only in your own feature branches.

```bash
git clone https://github.com/<your-user>/cocos4.git
cd cocos4

git remote add upstream https://github.com/cocos/cocos4.git
git remote -v

git switch -c experiment/playable-runtime
```

Expected remotes:

```text
origin    https://github.com/<your-user>/cocos4.git
upstream  https://github.com/cocos/cocos4.git
```

`origin` is your repository. `upstream` is the official Cocos repository.

### Option B — private standalone repository

A fork of a public GitHub repository is public. If the experiments should remain private, create a new **private** repository in your account instead of using GitHub's Fork button.

Starting from the existing local clone:

```bash
cd E:\Work\cocos4

git remote rename origin upstream
git remote add origin https://github.com/<your-user>/<private-repo-name>.git

git switch -c experiment/playable-runtime
git push -u origin experiment/playable-runtime
```

Keep the original Cocos license/copyright files intact.

## Local-only development is also valid

If no remote backup is desired yet:

```bash
git switch -c experiment/playable-runtime
git add .
git commit -m "chore: establish playable runtime experiment baseline"
```

Do not push.

This is safer than leaving everything uncommitted because every working state can be restored, diffed, bisected, or reverted.

## Branch structure

Recommended:

```text
v4.0.0                         upstream baseline
└─ experiment/playable-runtime
   ├─ feat/ao-baker
   └─ feat/cage-deform
```

For the first iterations, sequential branches are simpler:

```bash
git switch experiment/playable-runtime
git switch -c feat/ao-baker

# after AO is stable:
git switch experiment/playable-runtime
git merge --no-ff feat/ao-baker

git switch -c feat/cage-deform
```

## Syncing from upstream

Do this intentionally, not automatically during an experiment:

```bash
git fetch upstream
git switch experiment/playable-runtime
git merge upstream/v4.0.0
```

Prefer a merge over rewriting published experiment history.

## Commit style

Keep commits small and reversible:

```text
feat(ao): add vertex AO bake command
feat(ao): add hemisphere sampling
feat(ao): add scene occluder collection
perf(ao): batch ray tests

feat(cage): add cage data component
feat(cage): upload control points to shader
feat(cage): add procedural wind
feat(cage): add spring impulse solver
```

Avoid combining engine refactors with feature implementation in the same commit.

## Safety rule

Before touching shared rendering/mesh serialization code:

```bash
git status
git add .
git commit -m "chore: checkpoint before <change>"
```

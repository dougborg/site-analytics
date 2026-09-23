# Releasing to npm

This is the operator runbook for publishing `@dougborg/site-analytics`.
Every step marked **Operator** needs the npm account owner, a browser session on npmjs.com, or 2FA, and no agent or workflow can do it.

## Where things stand

| What | State |
| --- | --- |
| Bootstrap publish | Done: `0.2.0`, published by hand on 2026-09-23 from tag `v0.2.0` |
| Provenance | None for `0.2.0`, the one-time exception below; every later version must have it |
| Tags | `v0.1.0` (pre-bootstrap, never published) and `v0.2.0`, both protected by the `Protect release tags` ruleset |
| GitHub Releases | `v0.2.0` only |
| Trusted publisher | Not yet verified: steps 1 to 3 |
| Next version | Whatever the open release-please PR proposes; it must be the first staged, provenance-attested release |

`v0.1.0` has no Release and no npm version.
It stays because the tag ruleset forbids deleting it, and it predates every artifact consumers can install.
Nothing depends on it: the release-please manifest, `package.json`, the latest tag, the latest Release, and npm's `latest` all say `0.2.0`.

## Why the first version was published by hand

`npm stage publish` and trusted publishing both need a package that already exists on the registry, so `.github/workflows/release.yml` cannot create the package.
The bootstrap was therefore one manual `npm publish` of the built tag, from the owner's account, with 2FA.

### The provenance exception

`0.2.0` has registry signatures but no provenance attestation, because it was not built by GitHub Actions.
It is the only version allowed to lack one.
Anyone can check that it was built from its tag, because the build is reproducible:

```sh
git worktree add --detach /tmp/v020 v0.2.0 && cd /tmp/v020
pnpm install --frozen-lockfile && pnpm build && npm pack --pack-destination /tmp/local
mkdir -p /tmp/local/x /tmp/registry
tar xzf /tmp/local/*.tgz -C /tmp/local/x
curl -sL https://registry.npmjs.org/@dougborg/site-analytics/-/site-analytics-0.2.0.tgz | tar xz -C /tmp/registry
diff -r /tmp/local/x/package /tmp/registry/package && echo identical
```

This was run on 2026-09-23 and printed `identical` for all 11 files.

### If the package ever has to be bootstrapped again

For example, under a new name:

1. Merge the release PR, so the tag and GitHub Release exist first; the publish job then fails at `npm stage publish`, which is expected.
2. **Operator**, on a clean checkout of the tag with the Node from `.nvmrc`: `pnpm install --frozen-lockfile && pnpm build && pnpm check && pnpm test:browser`, then `npm pack --dry-run` and read the file list.
3. **Operator**: `npm publish --access public` (npm asks for the 2FA code).
4. Record the reproducibility check above for that version, then continue with step 1 below.

## 1. Trust the release workflow

**Operator**, on npmjs.com: the package, then **Settings**, then **Trusted Publisher**, then **GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `dougborg` |
| Repository | `site-analytics` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |
| Allowed actions | `npm stage publish` only |

The workflow already has what this needs: the `publish` job runs in the `npm` environment with `id-token: write`, on Node 26.8.2 from `.nvmrc`, whose bundled npm (11.19.1) is newer than the 11.15.0 staged publishing needs.
The GitHub `npm` environment accepts deployments only from `main`.
Renaming `release.yml` or the environment breaks publishing until the trusted publisher is updated to match.

## 2. Stage a release through the workflow

1. Merge the open release-please PR (`chore(release): release X.Y.Z`) after reading its changelog.
   release-please creates tag `vX.Y.Z` and its GitHub Release in the `release-please` job.
2. The `publish` job checks out the tag, installs without a cache, builds, runs `pnpm check` and all three browser engines, and runs `npm stage publish . --provenance --access public`.
   If a step fails after the tag exists, fix the cause and rerun the failed job (`gh run rerun <run-id> --failed`); it rebuilds the same tag.

## 3. Review and approve the staged version

**Operator**, with 2FA:

```sh
npm stage list @dougborg/site-analytics
npm stage view <stage-id>        # version, files, provenance
npm stage download <stage-id>    # the exact tarball that would go live
```

Before approving, check that the staged tarball is the tag's build: run the reproducibility check above against the downloaded tarball instead of the registry one.
Then approve, from the CLI or the package's **Staged Packages** tab:

```sh
npm stage approve <stage-id>
```

If anything is wrong, do not approve it: fix the problem and release the next version.

## 4. Lock publishing down

Only after one staged version has gone live through steps 2 and 3:

1. **Operator**: package **Settings**, then **Publishing access**, then **Require two-factor authentication and disallow tokens**.
   Trusted publishing keeps working; any npm token stops being able to publish.
2. **Operator**: `npm token list`, and revoke any token created for the bootstrap or for automation (`npm token revoke <id>`).
3. **Operator**, optional: turn on GitHub's immutable releases for the repository, so a Release's assets and tag cannot change after publication.

## 5. Verify end to end

After the first staged version goes live, and again after any change to the workflow or npm settings:

```sh
npm view @dougborg/site-analytics@X.Y.Z dist.attestations   # has a provenance attestation
mkdir /tmp/verify && cd /tmp/verify && npm init -y > /dev/null
npm install --save-exact @dougborg/site-analytics@X.Y.Z
npm audit signatures                                          # verified signature and attestation
node --input-type=module -e 'import("@dougborg/site-analytics").then((m) => console.log(Object.keys(m)))'
```

On npmjs.com, the version's provenance must name `dougborg/site-analytics`, `.github/workflows/release.yml`, the tag's commit, and the workflow run that staged it.
Confirm that **Publishing access** still shows **Require two-factor authentication and disallow tokens**; never test it with a real `npm publish`.

Record on the release's tracking issue:

- the npm version URL and its provenance attestation;
- the tag and GitHub Release URLs;
- the workflow run that staged it, and when and by whom it was approved;
- `npm pack --dry-run` output, or the staged tarball's file list;
- the consumer PRs that pin the new version exactly.

## Afterwards

Every release follows steps 2, 3, and 5.
Never publish by hand again: a version without provenance is a sign that something bypassed the workflow.

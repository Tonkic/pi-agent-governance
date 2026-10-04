# Major/minor automatic release verification

## Authorized behavior

User selected option two: relative to the latest published stable plugin-center version, an approved major/minor version delivery may push a dedicated non-main release branch and submit a version after all checks, without repeated permission requests. Patches stay local. New permissions or policy changes need renewed approval. No automatic installation, main merge, force push, pending-version superseding or mutation retries.

Implementation: scripts/release-auto.cjs, scripts/release-policy.json, scripts/plugin-center.cjs. Usage and recovery: scripts/RELEASING.md. AGENTS.md makes invocation part of approved version delivery, not ordinary builds or a background service. No version is invented just to publish.

## Checks performed

- Reviewed release decision, source/package-bound evidence, permission guard, fixed repository/branch push, clean-worktree checks, credential-history scan, durable submission marker and failure ordering.
- npm run typecheck: passed.
- npm test (includes build): 58/58 passed, including 9 offline release tests. Covers patch/unchanged skip, numeric version ordering, invalid/downgrade rejection, pending/duplicate versions, permission expansion, evidence binding, payload mapping and no automatic mutation retry.
- npm run test:browser: passed existing bilingual board/graph/workflow and stale/workspace-switch checks. Screenshots generated; not human visual acceptance.
- git diff --check: passed.
- Actual authenticated npm run release:auto -- --plan and npm run release:auto: both returned publish:false, reason:patch-or-unchanged, published baseline 0.6.0, candidate 0.6.1. No push or version submission occurred.

## Limits

The major/minor mutation path is tested offline, not by publishing a dummy release. Platform submission may be asynchronous: anything other than confirmed published stops for read-only status inspection, never blind resubmission. Evidence receipts are caller-attested, not independently signed acceptance. Existing real-host/visual acceptance blockers remain. Plugin runtime and package contents did not change, so the existing validated 0.6.1 package is retained without repacking. Community remains 0.6.0.

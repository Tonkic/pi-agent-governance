# Community publication checkpoint — 0.6.0

## Outcome

- Plugin ID: `io.github.tonkic.agent-governance`; version `0.6.0`; trust `community` (not a verified-publisher badge).
- User explicitly authorized non-main release-source push and plugin-center submission after checks.
- Source commit: `9e5eda26ce30ff687e7a993c755cf2565c8b34e0`.
- Remote branch: `release/plugin-center-0.6.0` in `Tonkic/pi-agent-governance`; remote SHA matched the tested source. No main merge, force push or changes to the main ref.
- `create_plugin`: accepted, state active, release approved, zero blockers/findings. Platform reports zero review records; do not infer human review.
- Subsequent `list_plugins` and `plugin_status`: `published`, stable channel, published at `2026-10-03T17:39:41Z`; sourceRef/sourceCommit match the source commit above.
- Public `https://plugins.aiuo.net/catalog.json` includes the ID/version and matching source provenance.

## Verification

- Clean scratch copy: `npm ci`, `npm run typecheck`, `npm test` (which runs build) passed, 49/49 tests.
- Working checkout: `npm run build` passed; after source commit, `npm test` passed 49/49 and `node test/browser.cjs` passed again.
- Browser checks use Edge/Playwright and real governance core with a mock host bridge. Chinese full workflow covers drag/keyboard work items, draft cancellation/discard disclosure, graph, workflow, stale and switched-workspace rejection. English covers host-locale precedence, confirmations, cancellation and preservation of literal Chinese/HTML-like user data.
- Both locales: 390/768/1280 widths, light/dark, no document horizontal overflow; twelve screenshots generated in session scratch. No human visual acceptance claimed.
- Official skill.md internationalization gate: zero FAIL, two REVIEW. Reviewed exceptions: manifest command title is a bilingual string because the installed PluginCheck rejects title objects; runtime registration is locale-specific. `STATE` is an unchanged protocol/file identifier.
- PluginCheck/PluginPack passed with expected explicit-grant warning for `agent.tool.register`.
- One read-only code-review pass found no concrete correctness/security defect. Review did not claim test execution.
- `git diff --check` passed. Generated artifacts match build. Architecture references refreshed only for inspected README/panel/graph changes; dependency relationships unchanged.

## Packages

Local package: `plugin/dist/io.github.tonkic.agent-governance-0.6.0.piplug`, 28 files, 276785 bytes.

Local SHA-256: `d9836c38b07657d750ef9b8966d77fdcaca7d55c36bef95aad66e255d1e8237e`.

Published artifact: `https://raw.githubusercontent.com/AIUO-Net/pi-desktop-plugins/main/packages/io.github.tonkic.agent-governance-0.6.0.piplug`, 276784 bytes.

Published SHA-256: `e56e9e38e8ebe21e5cd1401c386f496d8c78ed430427433e086951c99886ca85`.

Downloaded public artifact and verified catalog checksum. ZIP entries are uncompressed and entry names match the local package. All non-manifest file bytes match; manifests are equal after JSON parsing. The platform rebuilds manifest serialization, explaining the differing package hashes. Old packages were preserved.

## Credential handling

The token remains solely in local `.secrets/plugin-center.token`, outside `plugin/`, excluded by root `.gitignore` and not Git-tracked. The directory has protected Windows ACL with only the current user granted access. MCP whoami succeeded as tonkic; the repository is bound. No credential value is recorded here.

Exact-secret scans found no token in tracked files, 335 reachable Git objects before push, local package or downloaded published package. The publisher uses a fixed source-file allowlist from a full commit SHA, requires `--submit`, forbids redirects, checks Git exclusion, and redacts token-like response output. It does not retry mutations automatically. Because the token was pasted in chat, the user should revoke/rotate it and replace the local file.

## Remaining overall acceptance

Publication is complete. The overall `project-board-release` task stays working: new-ID installed-host loading/interaction smoke and human visual review are still outstanding. Do not equate marketplace approval with those acceptance criteria. Installation requires disabling the old ID, retaining STATE/`.governance/`, and granting permissions to the new plugin. Native same-ID updates can be used after installation; no self-updater was added.

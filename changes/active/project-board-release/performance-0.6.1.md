# Local 0.6.1 performance evidence

## Change and regression

Project board/architecture now render before the serial Git overview request. Newly rendered controls remain disabled until refresh settles. No cache, polling, concurrency, permissions or write-guard changes.

The held-Git browser regression failed on the old implementation (2-second timeout), then passed after reordering. It checks board/graph visibility while Git remains pending and disabled refresh, save and card buttons. Existing bilingual browser interactions, stale/workspace-switch checks and responsive screenshots passed. Screenshots are generated, not human visual acceptance.

`npm run typecheck`, `npm run build`, `npm test`: passed; 49/49 unit/integration tests. Source/generated JS and documentation/version diffs reviewed; diff whitespace check passed.

## Same-harness measurements

Chromium fixture: 100 board items, 40 nodes, 100 edges, simulated Git delay 300ms. Forced GC before heap samples. These are isolated harness measurements, not installed-host plugin attribution.

| Metric | Before | After |
| --- | ---: | ---: |
| Board visible | 330.7ms | 25.7ms |
| Entire refresh settled | 330.7ms | 333.3ms |
| Heap after 20 refreshes | 2.523MiB | 2.518MiB |
| Heap after 100 refreshes | 2.620MiB | 2.621MiB |
| DOM nodes after 20 / 100 | 3121 / 3121 | 3121 / 3121 |
| Listeners after 20 / 100 | 773 / 773 | 773 / 773 |
| Idle task time across 2s | 0.000629s | 0.000579s |

No sustained leak reproduced; no demonstrated memory reduction. Faster content visibility is the benefit, not faster total refresh. Backend retained heap delta was 0.785/0.786MiB; harness total heap 41.29MiB includes Playwright. Real-repository API median before/after: snapshot 1.10/0.84ms, Git 112.17/90.59ms, project 4.61/4.03ms; host load varies, so backend differences are not attributed to the renderer change.

Raw diagnostics are in session scratch: profile-governance.cjs, governance-profile-before.json, governance-profile-after.json, perf-tests.log, process-sample.json and process-resample.log.

## System memory and remaining processes

Initial sample 2026-10-04 01:57 +08:00: 15.11GiB physical RAM, 2.97GiB available. PI plus host-core working-set sum about 1.09GiB. Risk of Rain 2 alone used 2581MiB working set / 4692MiB private commit. No Node/Playwright/headless leftovers; a roughly 25MiB Tencent Docs orphan crash reporter was a candidate, not a proven zombie.

Resample 2026-10-04 21:40 +08:00: 5.91GiB available; PI-Desktop plus host-core 1254.9MiB working-set sum / 897.5MiB private commit. Parent processes alive; sampled CPU delta zero. No Node/headless browser leftovers or orphan crash reporter matched. The sampling PowerShell command itself matched text filters and was excluded. Largest working sets were Steam web helper 319.6MiB, QQ 283.8MiB and Discord 281.2MiB. Working sets include shared pages; private commit is not resident RAM. Different sessions/loads cannot establish a plugin memory regression.

No process terminated. Windows parent absence alone is not evidence of a zombie. Exact installed-plugin cost needs controlled host on/off profiling; this has not been performed.

## Local package and limits

PluginPack includes validation: 28 files, 277025 bytes, SHA256 `bebb786706005b802ed09913c4b8862ef7810cac0d70d71181666fafc8523dc3`.

`plugin/dist/io.github.tonkic.agent-governance-0.6.1.piplug`; only warning: explicit grant needed for agent.tool.register. Older packages preserved. Not installed, pushed or published; community release remains 0.6.0. Managed Git registry has no tasks, so a scoped native local commit is used without claiming managed git_verify. Overall real-host and human visual acceptance remain outstanding.

Post-commit verification: source/package commit `ef8ecaf91dedb72c8544e48bf9704d0e35ae4739`; `npm test` rebuilt and passed 49/49, and `node test/browser.cjs` passed again. Log: session scratch `perf-postcommit-tests.log`. Unrelated untracked `.pi/` and redesign archive were preserved.

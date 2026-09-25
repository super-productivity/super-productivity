# Judging Sync Severity

Triage rules — how to decide whether a sync bug is real and how bad it is.
AGENTS.md points here from _Required reading per task_; the rules below were
moved out of that file verbatim to keep it skimmable. Each one is here because
getting it wrong already produced a confidently wrong conclusion. Statistics are
dated where cited — re-measure before relying on them.

1. **`master` ships to real users. "It's only on master" never downgrades severity.** Every master
   push auto-publishes to the Play **internal track** (`.github/workflows/build-android.yml`,
   `tracks: internal` + `status: completed` → testers' phones auto-update within minutes, on their
   real data). `ghcr.io/super-productivity/supersync:latest` **is** master and has no
   release-tagged build at all — it is the default in `packages/super-sync-server/docker-compose.yml`,
   so self-hosters on `docker compose pull` run master HEAD. Snap `edge` is also published from
   every master push. Only desktop/web/F-Droid/Play-production/Snap-stable are release-gated.
2. **Never infer "shipped" from dates or the latest tag — prove it.** Use
   `git merge-base --is-ancestor <commit> v<tag>` / `git tag --contains <commit>`. Tags are cut from
   a point in time, and sync features routinely land just after: **#8874's disjoint-field merge
   landed ~24h after v18.14.0 was tagged and is in no release**, so whole-entity-LWW field loss
   (rename dies when another device marks the task done, #9095) is live in **every shipped version**.
3. **"Restores released behavior" ≠ safe. The released behavior can be the bug.** #9061 froze the
   disjoint merge on exactly that reasoning and silently re-armed shipped data loss (#9095).
   A freeze/revert needs the same "what breaks for users?" analysis as a feature.
4. **Users do report sync bugs — in non-technical words. There is no `sync` label.** Keyword-grepping
   `sync`/`op-log`/`conflict` undercounts by ~50×. Search what users actually write: _lost,
   disappeared, gone, missing, duplicate, reverted, old version, overwritten, reset, not syncing_
   (#7892 "all data deleted overnight"; #8107 user rebuilt lost projects from memory; #7549 done
   tasks resurrecting). ~53 user-reported sync/data-loss issues from 44 authors in 90 days ≈ one
   every 2 days (measured 2026-07). And silent data loss is structurally under-reported — absence of reports is never
   evidence of absence.
5. **Audit-generated findings are low-precision, not low-yield — verify them, don't dismiss them.**
   ~89% of sync fixes since v18.14.0 repaired code present in the release, yet ~97% of the self-filed
   sync issues carried no reproduction (both measured 2026-07). So both failure modes are live: **do not close an unreproduced
   finding as speculation** (#8960/#9073/#8751/#9040 had no repro and were all real and shipped), and
   **do not fix one blind** — the _fix_ must carry a test that fails without it, and you must confirm
   the fix actually fires on a real op (#9045 shipped an `entityIds` security check that **never fired**;
   #9025 was self-retracted as "not a live data-loss bug"). The reproduction gates the _fix_, not belief.

# Web nutrition entry and metric trends — 2026-10-06

Implementation status: **IMPLEMENTED_NOT_REVIEWED**. This report records scoped independent checks and deployment evidence; it does not mark the migration plan accepted.

## Scope and preserved work

The user requested a homepage entry to full nutrition, period trends for individual metrics, a commit before editing, push, and deployment. The pre-existing Web work was committed first as `205045a` (45 files); no existing skeleton or dirty files were reset. Remote main `7a781995e3aee62e82fe45dd0db691a7e6be622f` was then merged without conflicts, retaining the Next 16.3.6 security update.

Product commits in the working branch are `7f2b538`, `1304a6e`, and `a1ad968`. The independently frozen release starts from the current deployed Web source `c366c6818887fb400d541dc679fc5c5b936392b0` and includes only this task's three commits, ending at `5fa673c23c8886a097477e01cf200d5279f98348`. The snapshot's unrelated voice and daily-summary work is preserved in Git, but is not included in this deployment. `product.diff` is the full 17-file release diff against that deployed baseline.

## Resulting behavior

- The homepage has a prominent **全量营养** entry beside **照护趋势** above today's four statistics.
- Clicking milk, sleep, diaper, or food statistics opens the matching daily trend. Both 7-day and 30-day windows are available. Charts load only when opened, and have refresh/retry controls.
- Full nutrition exposes milk plus all 38 supported nutrient metrics. Each of the six core nutrient cards links to its own trend. The chart includes units, existing age-specific reference values, and expandable daily details.
- Days without a recorded source remain gaps and do not become numeric zero. A food-only day does not count as zero milk. Homepage milk uses recorded quantities; nutrition milk retains the existing explicitly labelled breastfeeding estimate.
- Scope changes invalidate old responses. Server authorization still derives from the verified session and rejects other tenants' babies and mismatched expected actors. Future multi-day endpoints are rejected.
- Deliberate cancellation of the previous period request does not show an error toast.

## Validation

- `npm run typecheck`: PASS, including the final cancellation fix. One unrelated nullable test assertion was repaired separately in `d1ce05e` before feature validation.
- Eight targeted suites: **53 passed, 0 failed, 0 skipped**, covering daily aggregation, complete nutrient projection, source-aware empty values, account/baby scope, multipart identity, and engine calculations. See `unit-tests.log`.
- Local standalone webpack build: PASS at `8d19144`, before the final one-line cancellation fix. Final Linux standalone build: PASS at `5fa673c`, Next **16.3.6**; all **670** frozen source input hashes matched. See `builds.json` for both identities and artifact hashes.
- Real isolated HTTP: **41 observations passed** against the frozen production-compatible Go backend `8b9edd3be223c2e784bf3ba617d7f11eac27323a`. Two fresh `test_` accounts, separate test families/babies, feeding/sleep/diaper/food/supplement writes, 7/30-day trends, all 38 daily nutrients, unauthorized cross-tenant reads, and expected-user mismatch were exercised. PostgreSQL/Redis were unique owner-labelled containers on loopback random ports. External provider keys were virtual, and no production configuration was loaded.
- Real Chromium browser validation: **12 checks PASS**, mobile 430px and desktop 1440px. Homepage entry, all four statistics, period switches, six core nutrient shortcuts, all 39 choices (milk plus 38 nutrients), gap display, and actual recovery after one synthetic 503 were exercised. The Service Worker was blocked only in this test context so that the outage could be intercepted; successful requests used the actual backend. Screenshots were visually inspected and are in `screenshots/`.
- Final isolated environment cleanup: PASS. All owner-labelled containers were removed, tracked API/Web processes stopped, ports released, temporary credentials deleted, and the local SSH tunnel closed. The HTTP report retains `PASS_HTTP_UI_PENDING` because browser execution is separate; `browser-acceptance.json` supplies the completed browser result.
- Activation controller: seven temporary-file/fake-systemd scenarios PASS: successful switch, exact service-added static copy, modified-artifact rejection before service mutation, changed static-copy rejection and rollback, runtime-copy failure with old build restored, missing source retaining old data, and failed staging retaining old data.
- Independent Luna/Max review found an empty-source trend issue and two release-controller issues. All were fixed and rechecked; the final cancellation suppression was also reviewed. A formal plan acceptance has not been recorded.

The HTTP tests use actual authorization and persistence. Browser interception is limited to one synthetic 503 response for the visible retry control; successful reads, authentication, and all record writes use the real isolated backend. Failed build/script attempts are retained instead of being hidden or converted to success. Playwright corrections concerned its cookie argument format, accessible-name matching, and distinguishing Next's empty route announcer from the application's error paragraph. The env guard was corrected to match files read under `NODE_ENV=production`; tracked `.env.test` is not loaded in this mode.

## Deployment

**Deployed** source `5fa673c23c8886a097477e01cf200d5279f98348`, build ID `SEwv3xzJ7OJ9tdoPoqiea`, tested artifact SHA `a78a1955b06ca8ad2a6d00cbba5527ac3f92e7da14ec1b60e9fec3ef02036794`. The complete SHA was recomputed and matched before the switch. See `deployment-receipt.json`.

The first switch correctly triggered rollback because the existing systemd `ExecStartPre` adds an exact second copy at `standalone/.next/static/static`. Original code and assets were unchanged. The check now accepts that additional directory only when its complete digest equals the tested static directory and every original file still matches. The frozen candidate was recovered into a separate directory, retaining the entire failed tree. The first retry preflight refused it before any service mutation because two empty tracked upload `.gitkeep` placeholders had also been excluded with production uploads; those exact empty source files were restored, and the complete artifact hash then matched. Both rejected attempts are retained as evidence.

Final local smoke: five pages returned 200; both protected APIs returned 401 without a session. Web PID is `1956540`; API PID `1699845` and notification-worker PID `1699928`, their restart counts, and configuration metadata are identical before/after. The user's existing notification source edit was preserved. Production runtime directories were copied with digest checks; the old `.next` remains in `/home/ubuntu/growdesk/web-nutrition-releases/20261006-retry/rollback`.

No schema migrations, backend binary changes, real-family test data, real notifications, or service configuration changes were part of this release. Main was pushed to `e6e4bba` before deployment, together with the work branch and frozen release branch. Final evidence is committed separately.

Public read-only smoke: **9 checks PASS**, including the five public pages, two unauthenticated API denials, and byte-for-byte SHA checks of the homepage and nutrition JavaScript bundles against the deployed artifact. See `public-smoke.json`. No production session or household record was used.

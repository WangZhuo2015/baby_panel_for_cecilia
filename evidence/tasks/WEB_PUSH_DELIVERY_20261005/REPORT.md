# WEB_PUSH_DELIVERY_20261005

Status: **IMPLEMENTED_NOT_REVIEWED**

本地已修复测试接口破坏订阅密钥、错误模拟成功、页面误判已绑定，以及家庭照护记录缺少推送任务的问题。Web 54 项定向测试、12 组受控页面回归和生产构建通过；后端 21 组真实 API/数据库/worker 隔离回归通过。代码已合回原目录，保留用户原有未提交改动。原网页目录的全量类型检查仍被保留的日报测试空值类型错误阻塞，详见下方集成检查。尚未部署，也未证明用户设备收到系统通知。

## Scope and baseline

User symptom: Web notifications are enabled but no system push arrives. The exact browser/device and whether a manual test or an automatic reminder was affected were not supplied.

- Web repository: `baby_panel_for_cecilia`, baseline `8ed8e5c9f1a81a36191cdfba654af9e56aff4993`.
- Implementation worktree: `/private/tmp/growdesk-web-push-20261005`, branch `codex/web-push-delivery-20261005`.
- Existing voice, daily-summary and LLM-profile edits in the original checkout are excluded and preserved.
- Requirements: GrowDesk plan 02 section 7.3 and plan 04 section 6.3. Test accounts and database resources must be isolated. Production configuration and household data are not used.

## Reproduced failure

The original `POST /api/push/test` GrowDesk branch overwrites the stored device token with the endpoint URL, dropping `p256dh` and `auth`. The normal Go subscription route stores the full JSON subscription. Thus clicking the test button can invalidate subsequent background delivery. The Web Push library requires both keys to encrypt notification payloads ([library documentation](https://github.com/web-push-libs/web-push#api-reference)).

That branch also returns HTTP 200 and simulated success for missing VAPID configuration and gateway errors. It ignores failed registration responses. The notification page treats HTTP 200 as a successful send and marks a local subscription as enabled before the server confirms its binding.

The baseline feedback command was:

```sh
node_modules/.bin/tsx --env-file=.env.test --test tests/unit/growdesk-push-test-route.test.ts
```

It failed **5/5** cases, including an endpoint that was not JSON and `200 !== 503`/`200 !== 502` failures. See `before.log`. These route tests control the session transport and external push gateway; they do not prove real authorization, PostgreSQL persistence or device delivery.

## Changes

- The test route validates the full subscription and preserves it as JSON when registering the current device.
- A successful registration is required before sending. Missing configuration, upstream outages, expired subscriptions, authorization rejection and timeout return actionable errors. Simulated success is removed.
- Mutating test requests check the same-origin boundary. A direct test send accepts only supported push-service hosts and uses a bounded transport timeout.
- The shared subscription parser forwards its validated canonical URL, preventing WHATWG/legacy `url.parse` discrepancies. Independent review reproduced the pre-fix incorrect `localhost` target using a controlled transport stub, then verified the canonical target after the fix.
- Manual test sends retain Edge WNS compatibility through `*.notify.windows.com` on HTTPS/443; deceptive suffixes and other ports are rejected ([Microsoft domain documentation](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/firewall-allowlist-config)). The baseline Go worker also lacked WNS support; the backend card below adds the matching allowlist entry.
- The test payload uses generic text without the account's display name.

The page requires a confirmed server binding before displaying “已绑定”, keeps actionable errors visible and checks a non-simulated positive gateway acceptance count. Rebinding reuses an existing subscription with the same VAPID key; a changed key or a provider-confirmed expired endpoint follows explicit removal/recreation. Service-worker activation and native subscription operations have an eight-second wait limit. HTTP operations have a ten-second abort limit. Cleanup failure or timeout preserves the expired-subscription error code so the page becomes unbound and releases its busy state. A late native result cannot resume uploading or creating a replacement after timeout.

## Validation

- Final focused tests: **54/54 passed**, no skips (`final-unit-tests.log`): ten test-route cases, six native bridge cases, eighteen client cases and twenty notification projection/read-state cases. The original test route failed **5/5** targeted cases. The second client regression baseline passed fourteen existing cases but failed all four new stalled-native-operation cases (`native-timeout-red.log`), then passed eighteen after repair.
- The new family notification projection regressed **2/3** cases before its repair (`family-parity-before.log`); after repair it and the existing parity/read-state tests pass **20/20** (`family-parity-after.log`). A current server event replaces only the matching derived duplicate, retaining its UUID and read state; historical events and legacy fallback remain visible.
- Actual `/notifications` page in owned loopback Next + Chromium: **12/12 synthetic scenarios passed** (`browser-after.json`). The original page failed to display a binding failure (`browser-before.json`). API, permissions, service workers and subscriptions are controlled fixtures; public network requests are blocked. These cases validate page behavior rather than real login or delivery to a physical device.
- `tsc --noEmit --incremental false`: passed against the final source (`final-typecheck.log`).
- Integration check in the original dirty Web checkout: full TypeScript exits 2 at the preserved, previously untracked `tests/api/daily-summary-full-journey.test.ts:115` (`JSON.parse(archived.content)`, where content is `string | null`). Its SHA-256 exactly matches the pre-task snapshot; this file and the generated Prisma types were not changed by this card. See `original-integration-typecheck.log` and `integration-report.json`. The isolated push worktree typecheck/build pass does not clear this original-checkout gate.
- Real HTTP/Go/PostgreSQL checks: committed route **5/10 passed** (expected exit 1, `backend-c9e672bde99b/persistence-report.json`); final repaired route **10/10 passed** (exit 0, `backend-0167a521c0c8/persistence-report.json`). Real registration, session exchange, Bearer validation, tenant data, device persistence and record writes were exercised. Only the external push gateway was intercepted. The BFF executes actual route handlers in an owned Node HTTP shim; this does not prove Next deployment. The final report's route SHA-256 matches the delivered route.
- Every infrastructure run cleaned its private cluster, API/Redis children and credential manifests. Two initial infrastructure startup failures also cleaned all owned resources; one was caused by an invalid test-only bucket name and was repaired without weakening the configuration guard. No raw infrastructure logs or credentials are retained.
- Independent scoped review closed the canonical-URL/WNS findings in the test route and the four stalled native API findings in the client. This is scoped regression review, not whole-system acceptance.
- Optimized Next webpack production build: **passed**, exit 0, all **80/80** static pages generated (`final-build.log`). It ran in a clean environment with a virtual local JWT secret, the isolated Web database path and a closed loopback backend URL. No deployment command was run.

## Delivery

The delivery consists of four existing Web source files, a client helper, three focused test files, three isolated review runners and this evidence directory. `CHANGES.patch` contains the scoped source/evidence diff. Dependency links, environment files, generated Next declarations and build outputs are excluded. The original checkout's seven existing voice/daily-summary/profile files were checked by SHA-256 before and after copying the scoped delivery (`integration-report.json`). No files are staged or committed.

## Backend family-record repair and unverified layers

The baseline Go backend has a real Web Push adapter in `internal/backend/native_push.go`; it must not be described as entirely simulated. Both the REST care transaction and `publishRecordChange` lacked family notification jobs. The observed notification producer `enqueueNativeResultNotification` handles AI task completion for the task's user. Web `notifyFamilyMembers` returns zero in GrowDesk mode. In the initial real PostgreSQL probe, an authorized caregiver had a complete subscription and a new family feeding record committed with `familyChangeDelta=1`, but `notificationDelta=0` and `pushTaskDelta=0`. This baseline failure led to the separate local backend card `FAMILY_RECORD_PUSH_20261005`; its implementation and real-worker results are reported in the [backend delivery report](/Users/wangzhuo/Documents/GitHub/growdesk-server/evidence/tasks/FAMILY_RECORD_PUSH_20261005/REPORT.md). The observation check in this Web report is not a successful family delivery test. The final backend run (`backend-e8c705a15195`) passes 21/21 isolated scenarios with 233 actual HTTP assertions, 63 native worker executions and 23 encrypted push requests to an owned loopback receiver; every payload was actually decrypted. Its 155 frozen source inputs match the delivered implementation. These results are local transport and authorization proof, not public-gateway/device acceptance.

The backend repair requires the additive native migration and a running native worker in the deployed environment. Timed daily-summary/vaccine reminders are outside this family-record card. No production configuration, production task queue, deployed revision, actual APNs/FCM/Safari acceptance, or system notification on the user's device was verified. No deployment, commit or push was performed. A local pass cannot establish that the user's live issue has been resolved.

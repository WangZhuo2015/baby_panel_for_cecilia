# Round 12 notification parity diagnosis

Evidence: `golden/golden-report.json`, fixture SHA-256 `096d61d4d5f4ede9688c6315a0da3be07ddccab071c79a3d5a10f10c632d51d8`, tested build `GNId9ARuUvlQkMZrSCyR2` (`35df18cdb5e3ef5c157379bd34d00e4d86f6f1c5302c95202a5dc158fd6c27b0`). Both endpoints returned HTTP 200. Legacy returned 16 items; GrowDesk mode returned 30.

## Observed semantic differences

- Legacy: 15 family activities (10 feeding, then sleep, diaper, food, supplement, growth) plus one data-release item. It emitted no vaccine or daily reminders.
- GrowDesk: nine derived vaccine reminders, one data-release item, and 20 feeding activities. The sleep, diaper, food, supplement, and growth activities are absent from the final array.
- Recent activity is therefore present in GrowDesk mode, but only as feeding. This is not the earlier timestamp fixture bug: every emitted activity has the corrected `createdAt=1789776000000` and `time=12小时前`.
- All 205 feedings share the same `createdAt`. Legacy's per-kind `take: 10` selected IDs `...100` through `...109`; GrowDesk fetched the complete list and its final global slice selected IDs `...304` through `...285`. Equal-time selection/order is not equivalent.
- The nine GrowDesk vaccine items are actual extras. Legacy queries only stored incomplete `VaccineRecord` rows. The fixture has none, so legacy emits no vaccine reminder. GrowDesk derives overdue reminders from the reference schedule and an absent selection defaults to enabled. Several titles also duplicate the dose, for example `乙肝疫苗 (第1剂) 第1剂`.
- Daily reminders agree by meaning: both emit none because this fixture has feeding, overlapping sleep, and food records for the family day.
- The data-release detail and date agree, but identity/presentation do not: legacy uses database ID, fixed title `数据版本更新`, and omits `createdAt`; GrowDesk uses the `asOf` date as ID, the source dataset title, and `createdAt=now`.
- Family notification presentation differs even before considering selected records: GrowDesk appends `-created` to IDs; uses `test_golden_parent` instead of `家长 (test_golden_parent)`; says `记录了喂奶记录` instead of `记录了喂奶`; and leaves canonical feeding types as `bottle`/`formula` rather than legacy `瓶喂母乳`/`配方奶`.
- Food, growth, and supplement DTOs in this report do not expose `recordedById`; exact legacy actor attribution for those domains cannot be reconstructed in the Web adapter alone. Food detail fields are available (`foodNames`, `portion`, `abnormalNotes`) but the adapter currently summarizes item count and `reaction`, so it would still differ once no longer crowded out.

## Root cause and minimum repair

1. Match legacy family collection before the global top-20: sort each domain by `createdAt desc` with an explicit deterministic tie-break, cap feeding/sleep/diaper/food at 10 and growth/supplement at 5, concatenate in legacy order (supplement before growth), then stable-sort by `createdAt desc` and take 20. This prevents a large feeding history from erasing every other domain. To make the golden tie case exact, use record ID ascending for equal `createdAt`, which selects `...100` through `...109`.
2. Map legacy output presentation in the adapter: legacy IDs without `-created`, domain-specific titles, Chinese feeding type labels, relation-aware actor labels, and the existing legacy detail formats. Extend canonical DTOs with `recordedByUserId` (and supplement product/name fields where absent) rather than inventing an actor in Web.
3. For strict compatibility, generate vaccine notifications only from explicitly stored legacy-equivalent incomplete vaccine records. Schedule-derived reminders are new behavior and should be gated outside the compatibility response. If retained as a product extension, they cannot pass exact legacy parity; at minimum remove the duplicated dose suffix.
4. Emit the legacy data-release shape: stable data-release record ID, title `📊 数据版本更新`, and no synthetic `createdAt`.

The dominant 136-field positional diff is a consequence of the nine leading vaccine extras and different family selection, not 136 independent defects.

# ADR 0005: Record Snapshots and Undo Rollback Architecture

- Status: accepted
- Date: 2026-09-01

## Context

With write and delete capabilities exposed to external conversational AI models (such as Gemini Spark Custom Connected App) and multi-user caregivers, the risk of accidental record deletion or erroneous batch modifications increases significantly.

Permanent (hard) deletes without a safety buffer make it impossible to restore data when an AI misinterprets user intent or when a user clicks delete by mistake.

We evaluated two potential designs:
1. **Schema-wide Soft Deletes (`deletedAt` on all 10+ domain tables)**:
   - High migration surface area; requires updating all existing aggregation queries and index definitions across the entire codebase to filter `deletedAt: null`.
2. **Unified Snapshot Event Table (`RecordSnapshot`)**:
   - Stores pre-destruction JSON payloads with entity metadata (`babyId`, `entityType`, `entityId`, `source`, `payloadJson`, `restored`).
   - Completely non-invasive to existing read/write queries while providing full auditability and undo/rollback capabilities.

## Decision

We introduce an event-driven snapshot architecture centered around `RecordSnapshot`:

1. **Pre-destruction Snapshot Capture**:
   - Before executing any `delete` (or destructive update) in the Service or MCP tool layers (`feeding`, `sleep`, `diaper`, `food`, `growth`, `medical_report`, `vaccine`, `food_plan`), a full JSON snapshot of the target entity is saved to `RecordSnapshot`.
2. **Natural Language Undo & Rollback**:
   - MCP tools (`record_health_measurement` / `record_baby_events`) and Web APIs support an `undoAction` / `restoreSnapshot` operation.
   - Caregivers can say "撤销刚才的删除" in Gemini Spark or web chat, and the system restores the most recent snapshot back to the primary table atomically.
3. **Multi-tenant Tenancy Enforcement**:
   - All snapshot queries and restorations are strictly bounded to `babyId` belonging to the authenticated User/Family principal.

## Consequences

- **Pros**:
  - Safe, zero data-loss buffer against AI hallucinations or accidental deletions.
  - No schema modification needed on existing high-frequency domain tables.
  - Seamless conversational undo experience in Gemini Spark.
- **Trade-offs**:
  - Small additional storage footprint for deleted record JSON payloads.
  - Restoration logic requires entity-specific deserializers (handled centrally in `lib/records/snapshot.ts`).

/**
 * Record Snapshot & Undo / Rollback Service
 * Provides automatic pre-deletion snapshots and atomic rollback for AI agents & caregivers.
 */

import { prisma } from "@/lib/prisma";

export interface SnapshotContext {
  userId?: string | null;
  babyId: string;
  source?: "mcp" | "web_chat" | "ui_manual";
  sourceAgent?: string | null;
}

/**
 * Creates a pre-destructive snapshot before deleting or overwriting a record.
 */
export async function captureRecordSnapshot(params: {
  ctx: SnapshotContext;
  action: "delete" | "update" | "batch_overwrite";
  entityType: "feeding" | "sleep" | "diaper" | "food" | "growth" | "medical_report" | "vaccine" | "food_plan" | "supplement";
  entityId: string;
  payload: Record<string, any>;
}) {
  return prisma.recordSnapshot.create({
    data: {
      babyId: params.ctx.babyId,
      userId: params.ctx.userId || null,
      source: params.ctx.source || "mcp",
      sourceAgent: params.ctx.sourceAgent || null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      payloadJson: JSON.stringify(params.payload),
      restored: false,
    },
  });
}

/**
 * Restores a specific snapshot back to its primary database table.
 */
export async function restoreSnapshot(ctx: SnapshotContext, snapshotId: string) {
  const snapshot = await prisma.recordSnapshot.findUnique({
    where: { id: snapshotId },
  });

  if (!snapshot || snapshot.babyId !== ctx.babyId) {
    throw new Error("未找到对应的数据快照或无权访问");
  }

  if (snapshot.restored) {
    throw new Error("该快照记录此前已被恢复，无需重复恢复");
  }

  const payload = JSON.parse(snapshot.payloadJson);
  let restoredEntity: any = null;

  switch (snapshot.entityType) {
    case "feeding": {
      restoredEntity = await prisma.feedingRecord.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          formulaProductId: payload.formulaProductId || null,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          clientId: payload.clientId || null,
          timestamp: payload.timestamp,
          type: payload.type,
          amountMl: payload.amountMl,
          leftMinutes: payload.leftMinutes,
          rightMinutes: payload.rightMinutes,
          spitUp: Boolean(payload.spitUp),
          notes: payload.notes || null,
        },
      });
      break;
    }

    case "sleep": {
      restoredEntity = await prisma.sleepRecord.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          clientId: payload.clientId || null,
          startTime: payload.startTime,
          endTime: payload.endTime,
          type: payload.type || "day",
          nightWakingCount: payload.nightWakingCount,
          notes: payload.notes || null,
        },
      });
      break;
    }

    case "diaper": {
      restoredEntity = await prisma.diaperRecord.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          clientId: payload.clientId || null,
          timestamp: payload.timestamp,
          type: payload.type,
          poopColor: payload.poopColor || null,
          poopConsistency: payload.poopConsistency || null,
          notes: payload.notes || null,
        },
      });
      break;
    }

    case "food": {
      restoredEntity = await prisma.foodLogRecord.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          clientId: payload.clientId || null,
          date: payload.date,
          time: payload.time || null,
          foods: payload.foods || JSON.stringify([]),
          portion: payload.portion || null,
          acceptance: payload.acceptance,
          babyState: payload.babyState || null,
          hasAbnormal: Boolean(payload.hasAbnormal),
          abnormalNotes: payload.abnormalNotes || null,
        },
      });
      break;
    }

    case "growth": {
      restoredEntity = await prisma.growthMeasurement.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          clientId: payload.clientId || null,
          date: payload.date,
          ageInMonths: payload.ageInMonths,
          ageLabel: payload.ageLabel || "",
          weightKg: payload.weightKg,
          heightCm: payload.heightCm,
          headCircumferenceCm: payload.headCircumferenceCm,
          percentile: payload.percentile,
          imageUrl: payload.imageUrl || null,
        },
      });
      break;
    }

    case "medical_report": {
      restoredEntity = await prisma.medicalReport.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          title: payload.title,
          category: payload.category,
          date: payload.date,
          hospital: payload.hospital || null,
          doctorNotes: payload.doctorNotes || null,
          aiSummary: payload.aiSummary || null,
          itemsJson: payload.itemsJson || "[]",
          imageUrl: payload.imageUrl || null,
        },
      });
      break;
    }

    case "vaccine": {
      restoredEntity = await prisma.vaccineRecord.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          name: payload.name,
          dose: payload.dose,
          scheduledDate: payload.scheduledDate,
          completedDate: payload.completedDate,
          isCompleted: Boolean(payload.isCompleted),
        },
      });
      break;
    }

    case "food_plan": {
      restoredEntity = await prisma.foodPlan.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          name: payload.name,
          date: payload.date,
          ingredients: payload.ingredients || "[]",
          steps: payload.steps || "[]",
          nutrition: payload.nutrition || "",
          tags: payload.tags || "[]",
        },
      });
      break;
    }

    case "supplement": {
      restoredEntity = await prisma.supplementRecord.create({
        data: {
          id: payload.id || undefined,
          babyId: ctx.babyId,
          productId: payload.productId,
          recordedById: ctx.userId || payload.recordedById || null,
          source: payload.source || ctx.source || "ui_manual",
          sourceAgent: payload.sourceAgent || ctx.sourceAgent || null,
          date: payload.date,
          time: payload.time,
          dose: payload.dose,
          unitName: payload.unitName || null,
          notes: payload.notes || null,
        },
      });
      break;
    }

    default:
      throw new Error(`不支持的快照恢复类型: ${snapshot.entityType}`);
  }

  // Mark snapshot as restored
  await prisma.recordSnapshot.update({
    where: { id: snapshot.id },
    data: { restored: true, restoredAt: new Date() },
  });

  return {
    snapshotId: snapshot.id,
    entityType: snapshot.entityType,
    restoredId: restoredEntity?.id,
    restoredEntity,
  };
}

/**
 * Restores the most recently deleted record for this baby (Undo operation)
 */
export async function restoreLastDeletedRecord(ctx: SnapshotContext, entityType?: string) {
  const lastSnapshot = await prisma.recordSnapshot.findFirst({
    where: {
      babyId: ctx.babyId,
      action: "delete",
      restored: false,
      ...(entityType ? { entityType } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!lastSnapshot) {
    throw new Error("未找到可供撤销恢复的删除记录");
  }

  return restoreSnapshot(ctx, lastSnapshot.id);
}

/**
 * Lists recent snapshots for baby
 */
export async function listRecentSnapshots(babyId: string, limit = 10) {
  return prisma.recordSnapshot.findMany({
    where: { babyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

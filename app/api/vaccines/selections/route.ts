import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { getLocalDateStr } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const selections = await prisma.vaccineSelection.findMany({
      where: { babyId: babyResult.baby.id },
      orderBy: [{ vaccineId: "asc" }, { doseNumber: "asc" }],
    });

    return NextResponse.json(selections);
  } catch (error) {
    console.error("GET /api/vaccines/selections error:", error);
    return NextResponse.json(
      { error: "Failed to fetch vaccine selections" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { babyId: reqBabyId, vaccineId, doseNumber, selected, completed } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    if (typeof vaccineId !== "string" || vaccineId.trim() === "") {
      return NextResponse.json(
        { error: "vaccineId 必填" },
        { status: 400 }
      );
    }
    let dose = 1;
    if (doseNumber !== undefined && doseNumber !== null) {
      if (!Number.isInteger(doseNumber) || doseNumber < 1 || doseNumber > 12) {
        return NextResponse.json(
          { error: "doseNumber 必须为 1-12 之间的整数" },
          { status: 400 }
        );
      }
      dose = doseNumber;
    }
    if (typeof selected !== "boolean" && typeof completed !== "boolean") {
      return NextResponse.json(
        { error: "selected 或 completed 必须为布尔值" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const selection = await tx.vaccineSelection.upsert({
        where: {
          babyId_vaccineId_doseNumber: {
            babyId: baby.id,
            vaccineId: vaccineId.trim(),
            doseNumber: dose,
          },
        },
        update: {
          selected: selected !== undefined ? selected : undefined,
          completed: completed !== undefined ? completed : undefined,
        },
        create: {
          babyId: baby.id,
          vaccineId: vaccineId.trim(),
          doseNumber: dose,
          selected: selected ?? true,
          completed: completed ?? false,
        },
      });

      if (completed === true) {
        const vaccine = await tx.vaccine.findUnique({ where: { vaccineId: vaccineId.trim() } });
        const vName = vaccine?.name || vaccineId.trim();
        const doseStr = `第${dose}剂`;
        const todayStr = getLocalDateStr();

        const existingRecord = await tx.vaccineRecord.findFirst({
          where: {
            babyId: baby.id,
            name: vName,
            dose: doseStr,
          },
        });

        if (existingRecord) {
          await tx.vaccineRecord.update({
            where: { id: existingRecord.id },
            data: { isCompleted: true, completedDate: existingRecord.completedDate || todayStr },
          });
        } else {
          await tx.vaccineRecord.create({
            data: {
              babyId: baby.id,
              name: vName,
              dose: doseStr,
              scheduledDate: todayStr,
              completedDate: todayStr,
              isCompleted: true,
            },
          });
        }
      } else if (completed === false) {
        const vaccine = await tx.vaccine.findUnique({ where: { vaccineId: vaccineId.trim() } });
        const vName = vaccine?.name || vaccineId.trim();
        const doseStr = `第${dose}剂`;
        await tx.vaccineRecord.deleteMany({
          where: {
            babyId: baby.id,
            name: vName,
            dose: doseStr,
          },
        });
      }

      return selection;
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("PUT /api/vaccines/selections error:", error);
    return NextResponse.json(
      { error: "Failed to save vaccine selection" },
      { status: 500 }
    );
  }
}

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import path from "path";
import { fileURLToPath } from "url";
import { mockBaby } from "../data/mockBaby";
import { mockGrowthHistory } from "../data/mockGrowthData";
import { mockFoodItems, mockFoodPlans, mockFoodLogHistory } from "../data/mockFoodData";
import { mockMilestones, mockActivities } from "../data/mockDevelopment";
import { mockBooks } from "../data/mockBooks";
import { mockVaccines } from "../data/mockVaccines";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "..", "prisma", "dev.db");
const DATABASE_URL = process.env.DATABASE_URL || `file:${dbPath}`;

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // Baby
  await prisma.baby.create({
    data: {
      id: mockBaby.id,
      nickname: mockBaby.nickname,
      gender: mockBaby.gender,
      birthDate: mockBaby.birthDate,
    },
  });
  console.log("✅ Baby");

  // Growth measurements
  for (const m of mockGrowthHistory) {
    await prisma.growthMeasurement.create({
      data: {
        id: m.id,
        date: m.date,
        ageLabel: m.ageLabel,
        weightKg: m.weightKg,
        heightCm: m.heightCm,
        headCircumferenceCm: m.headCircumferenceCm,
        percentile: m.percentile,
      },
    });
  }
  console.log("✅ Growth measurements");

  // Food items
  for (const item of mockFoodItems) {
    await prisma.foodItem.create({
      data: {
        id: item.id,
        name: item.name,
        icon: item.icon,
        firstAddedDate: item.firstAddedDate,
        acceptance: item.acceptance,
        status: item.status,
        category: item.category,
      },
    });
  }
  console.log("✅ Food items");

  // Food plans
  for (const plan of mockFoodPlans) {
    await prisma.foodPlan.create({
      data: {
        id: plan.id,
        date: plan.date,
        name: plan.name,
        tags: JSON.stringify(plan.tags),
        nutrition: plan.nutrition,
        ingredients: JSON.stringify(plan.ingredients),
        steps: JSON.stringify(plan.steps),
      },
    });
  }
  console.log("✅ Food plans");

  // Food log
  for (const log of mockFoodLogHistory) {
    await prisma.foodLogRecord.create({
      data: {
        id: log.id,
        date: log.date,
        time: log.time,
        foods: JSON.stringify(log.foods),
        portion: log.portion,
        acceptance: log.acceptance,
        babyState: log.babyState,
        hasAbnormal: log.hasAbnormal,
        abnormalNotes: log.abnormalNotes,
      },
    });
  }
  console.log("✅ Food logs");

  // Development milestones
  for (const m of mockMilestones) {
    await prisma.developmentMilestone.create({
      data: {
        id: m.id,
        category: m.category,
        month: m.month,
        title: m.title,
        description: m.description,
        status: m.status,
      },
    });
  }
  console.log("✅ Development milestones");

  // Activities
  for (const a of mockActivities) {
    await prisma.activityRecommendation.create({
      data: {
        id: a.id,
        title: a.title,
        tag: a.tag,
        materials: JSON.stringify(a.materials),
        steps: JSON.stringify(a.steps),
      },
    });
  }
  console.log("✅ Activities");

  // Books
  for (const book of mockBooks) {
    await prisma.book.create({
      data: {
        id: book.id,
        title: book.title,
        author: book.author,
        rating: book.rating,
        readCount: book.readCount,
        isFavorite: book.isFavorite,
        coverColor: book.coverColor,
        ageRange: book.ageRange,
      },
    });
  }
  console.log("✅ Books");

  // Vaccines
  for (const v of mockVaccines) {
    await prisma.vaccineRecord.create({
      data: {
        id: v.id,
        name: v.name,
        dose: v.dose,
        scheduledDate: v.scheduledDate,
        completedDate: v.completedDate,
        isCompleted: v.isCompleted,
        countdownDays: v.countdownDays,
      },
    });
  }
  console.log("✅ Vaccines");

  console.log("🎉 Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

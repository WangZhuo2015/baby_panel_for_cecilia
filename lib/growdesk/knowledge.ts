import fs from "node:fs";
import path from "node:path";

let cachedFoods: any[] | null = null;
export function getFoodsData(): any[] {
  if (!cachedFoods) {
    try {
      const p = path.resolve(process.cwd(), "data/04_foods.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedFoods = raw.foodItems || [];
      }
    } catch {
      cachedFoods = [];
    }
  }
  return cachedFoods || [];
}

let cachedMilestones: any[] | null = null;
let cachedWarningSigns: any[] | null = null;
export function getMilestonesData(): any[] {
  if (!cachedMilestones) {
    try {
      const p = path.resolve(process.cwd(), "data/03_milestones.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedMilestones = raw.milestones || [];
        cachedWarningSigns = raw.developmentRedFlags || [];
      }
    } catch {
      cachedMilestones = [];
      cachedWarningSigns = [];
    }
  }
  return cachedMilestones || [];
}

export function getWarningSignsData(): any[] {
  if (!cachedWarningSigns) {
    getMilestonesData();
  }
  return cachedWarningSigns || [];
}

let cachedBooks: any[] | null = null;
export function getBooksData(): any[] {
  if (!cachedBooks) {
    try {
      const p = path.resolve(process.cwd(), "data/05_books.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedBooks = raw.books || [];
      }
    } catch {
      cachedBooks = [];
    }
  }
  return cachedBooks || [];
}

let cachedActivities: any[] | null = null;
export function getActivitiesData(): any[] {
  if (!cachedActivities) {
    try {
      const p = path.resolve(process.cwd(), "data/06_activities.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedActivities = raw.activities || [];
      }
    } catch {
      cachedActivities = [];
    }
  }
  return cachedActivities || [];
}

let cachedVaccines: { entries: any[]; vaccines: any[] } | null = null;
export function getVaccinesData(): { entries: any[]; vaccines: any[] } {
  if (!cachedVaccines) {
    try {
      const p = path.resolve(process.cwd(), "data/02_vaccines.json");
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        cachedVaccines = {
          entries: raw.vaccineSchedule || [],
          vaccines: raw.vaccines || [],
        };
      }
    } catch {
      cachedVaccines = { entries: [], vaccines: [] };
    }
  }
  return cachedVaccines || { entries: [], vaccines: [] };
}

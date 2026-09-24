"use client";

// The retained form bodies use the original PR #24 hook name. There is only
// one implementation: #22's expected-user, multipart and A-to-B-to-A epoch guards.
export { useScopedNutritionRequest as useNutritionFetch } from "./useScopedNutritionRequest";

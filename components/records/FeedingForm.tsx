"use client";

import { useNutritionScopeKey } from "@/lib/hooks/useScopedNutritionRequest";
import { FeedingForm as FeedingFormFields, type FeedingFormProps } from "./FeedingFormFields";

export type { FeedingFormProps } from "./FeedingFormFields";

/** Reset private draft fields as a unit when the selected account or baby changes. */
export function FeedingForm(props: FeedingFormProps) {
  const scopeKey = useNutritionScopeKey(props.initialData?.babyId);
  return <FeedingFormFields key={scopeKey} {...props} />;
}

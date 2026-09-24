"use client";

import { useNutritionScopeKey } from "@/lib/hooks/useScopedNutritionRequest";
import {
  QuickFormulaManageModal as QuickFormulaManageModalContent,
  type QuickFormulaManageModalProps,
} from "./QuickFormulaManageModalContent";

export type { QuickFormulaManageModalProps } from "./QuickFormulaManageModalContent";

/** Closing or changing identity discards the previous catalog and private form state. */
export function QuickFormulaManageModal(props: QuickFormulaManageModalProps) {
  const scopeKey = useNutritionScopeKey(props.babyId);
  return <QuickFormulaManageModalContent key={`${scopeKey}:${props.isOpen}`} {...props} />;
}

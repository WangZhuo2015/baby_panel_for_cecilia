/**
 * 全局共享业务常量（单一可信源）
 */

/** FamilyMember.relation 允许值，与 prisma/schema.prisma 注释保持同步 */
export const RELATION_WHITELIST = [
  "parent",
  "mother",
  "father",
  "grandparent",
  "caregiver",
  "other",
] as const;

export type RelationValue = (typeof RELATION_WHITELIST)[number];

/** 非白名单值归一化为默认值 */
export function normalizeRelation(raw: unknown): RelationValue {
  return RELATION_WHITELIST.includes(raw as RelationValue)
    ? (raw as RelationValue)
    : "parent";
}

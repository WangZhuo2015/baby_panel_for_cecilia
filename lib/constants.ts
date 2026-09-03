/**
 * 全局共享业务常量（单一可信源）
 */

/** FamilyMember.relation 允许值，与 prisma/schema.prisma 注释保持同步 */
export const RELATION_WHITELIST = [
  "mother",
  "father",
  "grandfather",
  "grandmother",
  "maternal_grandfather",
  "maternal_grandmother",
  "caregiver",
  "other",
  "parent",
  "grandparent",
] as const;

export type RelationValue = (typeof RELATION_WHITELIST)[number];

export const RELATION_LABELS: Record<string, string> = {
  mother: "妈妈",
  father: "爸爸",
  grandfather: "爷爷",
  grandmother: "奶奶",
  maternal_grandfather: "姥爷",
  maternal_grandmother: "姥姥",
  caregiver: "看护/育儿嫂",
  other: "其他",
  parent: "家长",
  grandparent: "长辈",
};

export const RELATION_SELECTOR_OPTIONS = [
  { id: "mother", label: "妈妈" },
  { id: "father", label: "爸爸" },
  { id: "grandfather", label: "爷爷" },
  { id: "grandmother", label: "奶奶" },
  { id: "maternal_grandmother", label: "姥姥" },
  { id: "maternal_grandfather", label: "姥爷" },
  { id: "caregiver", label: "育儿嫂/看护" },
  { id: "other", label: "其他" },
] as const;

/** 非白名单值归一化为默认值 */
export function normalizeRelation(raw: unknown): RelationValue {
  return RELATION_WHITELIST.includes(raw as RelationValue)
    ? (raw as RelationValue)
    : "parent";
}


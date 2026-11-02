"use client";

import { useState, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  RefreshCw,
  Sparkles,
  X,
  UtensilsCrossed,
  Check,
  Dices,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteTextarea } from "@/components/ui/CuteTextarea";
import { FormSection } from "@/components/ui/FormSection";
import { HeartRating } from "@/components/ui/HeartRating";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { getLocalDateStr } from "@/lib/date";
import { clampFoodGrams, foodLogLimitMessage, MAX_MEAL_FOODS } from "@/lib/food-log-limits";
import {
  COMMON_FOOD_CATEGORIES,
  CUSTOM_FOOD_CATEGORIES,
  type CommonFoodCategory,
  type CommonFoodOption,
} from "@/lib/food-options";
import type { FoodLogRecord, FoodMealComponent, FoodCategoryRole } from "@/types";
import foodData from "@/data/04_foods.json";
import { WheelSpinnerColumn, type SpinnerItem } from "./WheelSpinnerColumn";

const FOOD_ICON_OPTIONS = ["🍽️", "🥩", "🐟", "🥚", "🥛", "🍚", "🥕", "🍎", "🥦", "🍠", "🥬", "🌽", "🍌", "🍇", "🍗", "🍤"];
const NONE_WHEEL_ITEM_NAME = "（无 / 本餐不吃）";

const portionOptions = [
  { value: "little" as const, label: "少量" },
  { value: "half" as const, label: "半碗" },
  { value: "most" as const, label: "大部分" },
  { value: "all" as const, label: "全部" },
];

const stateOptions = [
  { value: "happy" as const, emoji: "😊", label: "开心" },
  { value: "neutral" as const, emoji: "😐", label: "一般" },
  { value: "rejected" as const, emoji: "😣", label: "拒绝" },
];

export const ROLE_CONFIG: Record<
  "staple" | "protein" | "vegetable" | "optional",
  {
    role: FoodCategoryRole;
    label: string;
    sublabel: string;
    icon: string;
    badgeClass: string;
    activeBorder: string;
    defaultGrams: number;
    gramOptions: number[];
  }
> = {
  staple: {
    role: "staple",
    label: "主食 · 谷薯类",
    sublabel: "强化米粉 / 米粥 / 面条 (提供基础能量与铁源)",
    icon: "🍚",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
    activeBorder: "border-amber-400 bg-amber-50/50",
    defaultGrams: 20,
    gramOptions: [15, 20, 25, 30],
  },
  protein: {
    role: "protein",
    label: "肉蛋水产 · 优质蛋白",
    sublabel: "红肉泥 / 禽肉 / 蛋黄 / 鱼虾 (补铁防贫血与生长发育)",
    icon: "🥩",
    badgeClass: "bg-rose-100 text-rose-900 border-rose-300",
    activeBorder: "border-rose-400 bg-rose-50/50",
    defaultGrams: 25,
    gramOptions: [15, 20, 25, 35],
  },
  vegetable: {
    role: "vegetable",
    label: "蔬菜菌藻 · 维生素纤维",
    sublabel: "西兰花 / 胡萝卜 / 菠菜 (提供微量元素促进铁吸收)",
    icon: "🥦",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
    activeBorder: "border-emerald-400 bg-emerald-50/50",
    defaultGrams: 30,
    gramOptions: [20, 30, 40, 50],
  },
  optional: {
    role: "optional",
    label: "辅食油与加餐 · 优质脂肪水果",
    sublabel: "核桃油 / 亚麻籽油 / 鲜果泥 (提供必需脂肪酸与维C)",
    icon: "🥑",
    badgeClass: "bg-sky-100 text-sky-900 border-sky-300",
    activeBorder: "border-sky-400 bg-sky-50/50",
    defaultGrams: 2,
    gramOptions: [2, 5, 15, 25],
  },
};

/** 不建议作为婴儿日常轮盘主打项的特殊食材 */
const EXCLUDED_FOOD_IDS = new Set([
  "food_high_mercury_fish",
  "food_whole_nuts",
  "food_honey",
  "food_added_sugar",
  "food_salt_added",
  "food_jelly",
  "food_raw_milk",
  "food_cow_milk_drink",
]);

export function inferFoodRole(food: { name: string; category?: string; foodGroup?: string }): "staple" | "protein" | "vegetable" | "optional" {
  const name = food.name || "";
  const cat = (food.category || "").toLowerCase();
  const grp = (food.foodGroup || "").toLowerCase();

  if (name.includes("牛油果") || cat === "oil" || grp === "oil" || cat === "fruit" || grp === "fruit") {
    return "optional";
  }
  if (cat === "grain" || grp === "grain" || grp === "tuber" || /(米粉|米糊|粥|面|麦|米|粮|土豆|红薯|山药|谷物)/.test(name)) {
    return "staple";
  }
  if (
    cat === "protein" ||
    ["meat", "poultry", "organ_meat", "fish", "shellfish", "egg", "legume"].includes(grp) ||
    /(肉|鸡|鸭|猪|羊|鱼|虾|蛋|肝|豆腐|豆|鳕|鲑)/.test(name) ||
    name.includes("牛肉")
  ) {
    return "protein";
  }
  if (cat === "vegetable" || grp === "vegetable" || /(菜|西兰花|西蓝花|胡萝卜|南瓜|番茄|西红柿|黄瓜|茄|笋|菇|木耳)/.test(name)) {
    return "vegetable";
  }
  return "optional";
}

const QUICK_PRESETS = [
  {
    title: "🥣 经典高铁补铁餐",
    desc: "米粉 20g + 牛肉 25g + 西蓝花 30g",
    stapleName: "强化铁婴儿谷物",
    stapleGrams: 20,
    proteinName: "牛肉",
    proteinGrams: 25,
    vegName: "西兰花",
    vegGrams: 30,
  },
  {
    title: "🐟 深海鱼健脑餐",
    desc: "大米粥 25g + 三文鱼 20g + 胡萝卜 30g + 核桃油 2g",
    stapleName: "大米粥",
    stapleGrams: 25,
    proteinName: "三文鱼",
    proteinGrams: 20,
    vegName: "胡萝卜",
    vegGrams: 30,
    optional: [{ role: "optional" as const, name: "小皮特级初榨有机核桃油", grams: 2, icon: "🥑" }],
  },
  {
    title: "🥚 营养温和初尝餐",
    desc: "米粉 20g + 鸡蛋 15g + 南瓜 25g",
    stapleName: "强化铁婴儿谷物",
    stapleGrams: 20,
    proteinName: "鸡蛋",
    proteinGrams: 15,
    vegName: "南瓜",
    vegGrams: 25,
  },
];

export function resolveFoodFormFamilyId(input: {
  selectedBabyId?: string | null;
  baby?: { id?: string; familyId?: string } | null;
  family?: { id?: string } | null;
  families?: Array<{ id?: string }>;
}): string | null {
  const { selectedBabyId, baby, family, families = [] } = input;
  if (!selectedBabyId || baby?.id !== selectedBabyId || !baby.familyId) return null;
  if (family?.id === baby.familyId) return family.id;
  return families.some((candidate) => candidate.id === baby.familyId) ? baby.familyId : null;
}

export interface FoodLogFormProps {
  mode?: "create" | "edit";
  initialData?: Partial<FoodLogRecord> | any;
  onSubmit: (data: {
    date: string;
    time: string;
    foods: string[];
    components?: FoodMealComponent[];
    totalGrams?: number;
    portion: FoodLogRecord["portion"];
    acceptance: number;
    babyState: FoodLogRecord["babyState"];
    hasAbnormal: boolean;
    abnormalNotes?: string;
  }) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

export function FoodLogForm({
  mode = "create",
  initialData,
  onSubmit,
  onCancel,
  saving = false,
}: FoodLogFormProps) {
  const isEdit = mode === "edit";
  const { showToast } = useToast();

  const foodItems = useBabyStore((s) => s.foodItems) ?? [];
  const fetchFoodItems = useBabyStore((s) => s.fetchFoodItems);
  const family = useBabyStore((s) => s.family);
  const families = useBabyStore((s) => s.families);
  const baby = useBabyStore((s) => s.baby);
  const selectedBabyId = useBabyStore((s) => s.selectedBabyId);
  const fetchUser = useBabyStore((s) => s.fetchUser);
  const familyId = resolveFoodFormFamilyId({ selectedBabyId, baby, family, families });
  const [familyLoading, setFamilyLoading] = useState(!familyId);
  const [familyLoadError, setFamilyLoadError] = useState<string | null>(null);
  const [familyRetry, setFamilyRetry] = useState(0);

  useEffect(() => {
    if (familyId) {
      setFamilyLoading(false);
      setFamilyLoadError(null);
      return;
    }
    let cancelled = false;
    setFamilyLoading(true);
    setFamilyLoadError(null);
    void fetchUser()
      .then(() => {
        if (cancelled) return;
        const state = useBabyStore.getState();
        const resolved = resolveFoodFormFamilyId(state);
        if (!resolved) setFamilyLoadError("未能加载当前宝宝所属家庭，请重试");
      })
      .catch(() => {
        if (!cancelled) setFamilyLoadError("家庭信息加载失败，请重试");
      })
      .finally(() => {
        if (!cancelled) setFamilyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, fetchUser, familyRetry]);

  useEffect(() => {
    fetchFoodItems("tried");
  }, [fetchFoodItems, familyId]);

  // Set of tried food names
  const triedFoodNames = useMemo(() => {
    const set = new Set<string>();
    for (const item of foodItems) {
      if (item.status === "tried" && item.name) {
        set.add(item.name.trim());
      }
    }
    return set;
  }, [foodItems]);

  // Form base state
  const [date, setDate] = useState<string>(() => {
    return initialData?.date || getLocalDateStr();
  });

  const [time, setTime] = useState<string>(() => {
    return initialData?.time || new Date().toTimeString().slice(0, 5);
  });

  const [portion, setPortion] = useState<FoodLogRecord["portion"]>(() => {
    return initialData?.portion || "most";
  });

  const [acceptance, setAcceptance] = useState<number>(() => {
    return typeof initialData?.acceptance === "number" ? initialData.acceptance : 3;
  });

  const [babyState, setBabyState] = useState<FoodLogRecord["babyState"]>(() => {
    return initialData?.babyState || "happy";
  });

  const [hasAbnormal, setHasAbnormal] = useState<boolean>(() => {
    return Boolean(initialData?.hasAbnormal);
  });

  const [abnormalNotes, setAbnormalNotes] = useState<string>(() => {
    return initialData?.abnormalNotes || "";
  });

  // Build full categorized library for the 3 spin wheels + optional
  const { stapleList, proteinList, vegetableList, optionalList } = useMemo(() => {
    const staples: SpinnerItem[] = [{ id: "none", name: NONE_WHEEL_ITEM_NAME, icon: "⚪" }];
    const proteins: SpinnerItem[] = [{ id: "none", name: NONE_WHEEL_ITEM_NAME, icon: "⚪" }];
    const vegetables: SpinnerItem[] = [{ id: "none", name: NONE_WHEEL_ITEM_NAME, icon: "⚪" }];
    const optionals: SpinnerItem[] = [];

    const seenStaple = new Set<string>();
    const seenProtein = new Set<string>();
    const seenVeg = new Set<string>();
    const seenOpt = new Set<string>();

    // 1. Ingest safe standard library items from 04_foods.json
    for (const f of foodData.foodItems) {
      if (EXCLUDED_FOOD_IDS.has(f.id)) continue;
      const role = inferFoodRole(f);
      const tried = triedFoodNames.has(f.name);
      const item: SpinnerItem = {
        id: f.id,
        name: f.name,
        icon: f.icon || "🍽️",
        tried,
      };

      if (role === "staple" && !seenStaple.has(f.name)) {
        seenStaple.add(f.name);
        staples.push(item);
      } else if (role === "protein" && !seenProtein.has(f.name)) {
        seenProtein.add(f.name);
        proteins.push(item);
      } else if (role === "vegetable" && !seenVeg.has(f.name)) {
        seenVeg.add(f.name);
        vegetables.push(item);
      } else if (role === "optional" && !seenOpt.has(f.name)) {
        seenOpt.add(f.name);
        optionals.push(item);
      }
    }

    // 2. Ingest family-custom foods
    for (const f of foodItems) {
      if (!f.name) continue;
      const role = inferFoodRole(f);
      const tried = f.status === "tried" || triedFoodNames.has(f.name);
      const item: SpinnerItem = {
        id: f.id || f.foodId || f.name,
        name: f.name,
        icon: f.icon || "🍽️",
        tried,
      };

      if (role === "staple" && !seenStaple.has(f.name)) {
        seenStaple.add(f.name);
        staples.push(item);
      } else if (role === "protein" && !seenProtein.has(f.name)) {
        seenProtein.add(f.name);
        proteins.push(item);
      } else if (role === "vegetable" && !seenVeg.has(f.name)) {
        seenVeg.add(f.name);
        vegetables.push(item);
      } else if (role === "optional" && !seenOpt.has(f.name)) {
        seenOpt.add(f.name);
        optionals.push(item);
      }
    }

    // 3. Add curated common options to the same wheels. New options without
    // catalog records use a UI-only id and are not marked as tried.
    for (const category of COMMON_FOOD_CATEGORIES) {
      for (const food of category.foods) {
        const target = category.role === "staple"
          ? staples
          : category.role === "protein"
            ? proteins
            : category.role === "vegetable"
              ? vegetables
              : optionals;
        const seen = category.role === "staple"
          ? seenStaple
          : category.role === "protein"
            ? seenProtein
            : category.role === "vegetable"
              ? seenVeg
              : seenOpt;
        if (seen.has(food.name)) continue;
        seen.add(food.name);
        target.push({
          id: food.foodId || `common_option_${category.id}_${food.name}`,
          name: food.name,
          icon: food.icon,
          tried: triedFoodNames.has(food.name),
        });
      }
    }

    return {
      stapleList: staples,
      proteinList: proteins,
      vegetableList: vegetables,
      optionalList: optionals,
    };
  }, [foodItems, triedFoodNames]);

  const initialDataComponents: FoodMealComponent[] = isEdit && Array.isArray(initialData?.components)
    ? initialData.components
    : [];
  const [retainedComponents, setRetainedComponents] = useState<FoodMealComponent[]>(() =>
    initialDataComponents.map((component) => ({ ...component }))
  );
  const [extraComponents, setExtraComponents] = useState<FoodMealComponent[]>([]);
  const [legacyFoodNames, setLegacyFoodNames] = useState<string[]>(() => {
    if (!isEdit || !Array.isArray(initialData?.foods)) return [];
    const componentNames = new Set(initialDataComponents.map((component) => component.name));
    return initialData.foods.filter((name: unknown): name is string =>
      typeof name === "string" && name.trim().length > 0 && !componentNames.has(name)
    );
  });

  const initialFoodNameForRole = (role: "staple" | "protein" | "vegetable") => {
    const component = initialDataComponents.find((item) => item.role === role);
    if (component) return component.name;
    if (!Array.isArray(initialData?.foods)) return null;
    return initialData.foods.find((name: unknown) =>
      typeof name === "string" && inferFoodRole({ name }) === role
    ) || null;
  };

  const initialWheelName = (role: "staple" | "protein" | "vegetable", items: SpinnerItem[]) => {
    if (isEdit) return initialFoodNameForRole(role) || NONE_WHEEL_ITEM_NAME;
    return items[1]?.name || NONE_WHEEL_ITEM_NAME;
  };

  const wheelIndexForName = (name: string, items: SpinnerItem[]) => {
    const index = items.findIndex((item) => item.name === name);
    return index > 0 ? index : 0;
  };

  const initialGrams = (role: "staple" | "protein" | "vegetable", fallback: number) => {
    const component = initialDataComponents.find((item) => item.role === role);
    return typeof component?.grams === "number" ? component.grams : fallback;
  };

  // In edit mode the wheels only point at an existing or candidate item. They
  // never add defaults to the saved meal unless the user explicitly adds one.
  const [stapleSelectionName, setStapleSelectionName] = useState<string>(() => initialWheelName("staple", stapleList));
  const stapleIndex = wheelIndexForName(stapleSelectionName, stapleList);
  const setStapleIndex = (index: number) => setStapleSelectionName(stapleList[index]?.name || NONE_WHEEL_ITEM_NAME);
  const [stapleGrams, setStapleGrams] = useState<number>(() => initialGrams("staple", 20));
  const [proteinSelectionName, setProteinSelectionName] = useState<string>(() => initialWheelName("protein", proteinList));
  const proteinIndex = wheelIndexForName(proteinSelectionName, proteinList);
  const setProteinIndex = (index: number) => setProteinSelectionName(proteinList[index]?.name || NONE_WHEEL_ITEM_NAME);
  const [proteinGrams, setProteinGrams] = useState<number>(() => initialGrams("protein", 25));
  const [vegSelectionName, setVegSelectionName] = useState<string>(() => initialWheelName("vegetable", vegetableList));
  const vegIndex = wheelIndexForName(vegSelectionName, vegetableList);
  const setVegIndex = (index: number) => setVegSelectionName(vegetableList[index]?.name || NONE_WHEEL_ITEM_NAME);
  const [vegGrams, setVegGrams] = useState<number>(() => initialGrams("vegetable", 30));

  const [activeCommonCategoryId, setActiveCommonCategoryId] = useState("seafood");
  const [showOptionalSection, setShowOptionalSection] = useState<boolean>(() =>
    initialDataComponents.some((component) =>
      component.role === "optional" || component.role === "fruit" || component.role === "oil"
    ) ||
    (Array.isArray(initialData?.foods) && initialData.foods.some((name: unknown) =>
      typeof name === "string" && inferFoodRole({ name }) === "optional"
    ))
  );

  // Spin animation state
  const [isSpinning, setIsSpinning] = useState(false);

  const handleSpin = () => {
    if (isSpinning) return;
    setIsSpinning(true);

    let step = 0;
    const totalSteps = 8;
    const interval = setInterval(() => {
      step++;
      // Spin to random items (skip index 0 "none" so spinner lands on an actual balanced meal)
      const maxStaple = stapleList.length > 1 ? stapleList.length - 1 : 0;
      const maxProtein = proteinList.length > 1 ? proteinList.length - 1 : 0;
      const maxVeg = vegetableList.length > 1 ? vegetableList.length - 1 : 0;

      const randStaple = maxStaple >= 1 ? Math.floor(Math.random() * maxStaple) + 1 : 0;
      const randProtein = maxProtein >= 1 ? Math.floor(Math.random() * maxProtein) + 1 : 0;
      const randVeg = maxVeg >= 1 ? Math.floor(Math.random() * maxVeg) + 1 : 0;

      setStapleIndex(randStaple);
      setProteinIndex(randProtein);
      setVegIndex(randVeg);

      if (step >= totalSteps) {
        clearInterval(interval);
        setIsSpinning(false);
        const s = stapleList[randStaple]?.name || "主食";
        const p = proteinList[randProtein]?.name || "蛋白";
        const v = vegetableList[randVeg]?.name || "蔬菜";
        showToast(`🎲 随机搭配：${s} + ${p} + ${v}！`);
      }
    }, 75);
  };

  const handleApplyPreset = (preset: typeof QUICK_PRESETS[0]) => {
    const sIdx = stapleList.findIndex((item) => item.name === preset.stapleName);
    if (sIdx >= 0) {
      setStapleIndex(sIdx);
      setStapleGrams(preset.stapleGrams);
    }
    const pIdx = proteinList.findIndex((item) => item.name === preset.proteinName);
    if (pIdx >= 0) {
      setProteinIndex(pIdx);
      setProteinGrams(preset.proteinGrams);
    }
    const vIdx = vegetableList.findIndex((item) => item.name === preset.vegName);
    if (vIdx >= 0) {
      setVegIndex(vIdx);
      setVegGrams(preset.vegGrams);
    }
    if (preset.optional) {
      setExtraComponents((prev) => [
        ...prev.filter((component) => component.role !== "optional"),
        ...preset.optional!,
      ]);
      setShowOptionalSection(true);
    }
    showToast(`已填入「${preset.title}」✨`);
  };

  const componentFromWheel = (
    role: "staple" | "protein" | "vegetable",
    item: SpinnerItem,
    grams: number
  ): FoodMealComponent => ({
    role,
    name: item.name,
    ...(item.id.startsWith("common_option_") ? {} : { foodId: item.id }),
    icon: item.icon,
    grams,
  });

  const selectedWheelComponents = [
    stapleIndex > 0 && stapleList[stapleIndex]
      ? componentFromWheel("staple", stapleList[stapleIndex], stapleGrams)
      : null,
    proteinIndex > 0 && proteinList[proteinIndex]
      ? componentFromWheel("protein", proteinList[proteinIndex], proteinGrams)
      : null,
    vegIndex > 0 && vegetableList[vegIndex]
      ? componentFromWheel("vegetable", vegetableList[vegIndex], vegGrams)
      : null,
  ].filter((component): component is FoodMealComponent => component !== null);

  const activeComponents = useMemo<FoodMealComponent[]>(() => {
    const list = [...retainedComponents];
    const seenNames = new Set(list.map((component) => component.name));
    const appendIfNew = (component: FoodMealComponent) => {
      if (seenNames.has(component.name)) return;
      seenNames.add(component.name);
      list.push(component);
    };

    // Keep edit mode exact until the user explicitly adds or changes an item.
    if (!isEdit) {
      for (const component of selectedWheelComponents) appendIfNew(component);
    }
    for (const component of extraComponents) appendIfNew(component);
    return list;
  }, [
    isEdit,
    retainedComponents,
    extraComponents,
    selectedWheelComponents,
  ]);

  const selectedOptionals = activeComponents.filter((component) =>
    component.role === "optional" || component.role === "fruit" || component.role === "oil"
  );
  const activeCommonCategory = COMMON_FOOD_CATEGORIES.find((category) => category.id === activeCommonCategoryId)
    ?? COMMON_FOOD_CATEGORIES[0];

  const totalGrams = useMemo(() => {
    return activeComponents.reduce((sum, c) => sum + (c.grams || 0), 0);
  }, [activeComponents]);

  const hasStaple = activeComponents.some((component) => component.role === "staple");
  const hasProtein = activeComponents.some((component) => component.role === "protein");
  const hasVeg = activeComponents.some((component) => component.role === "vegetable");

  const isFoodSelected = (name: string) =>
    activeComponents.some((component) => component.name === name) || legacyFoodNames.includes(name);

  const removeFoodByName = (name: string) => {
    setRetainedComponents((prev) => prev.filter((component) => component.name !== name));
    setExtraComponents((prev) => prev.filter((component) => component.name !== name));
    setLegacyFoodNames((prev) => prev.filter((foodName) => foodName !== name));
    if (!isEdit) {
      if (stapleList[stapleIndex]?.name === name) setStapleIndex(0);
      if (proteinList[proteinIndex]?.name === name) setProteinIndex(0);
      if (vegetableList[vegIndex]?.name === name) setVegIndex(0);
    }
  };

  const addFoodComponent = (component: FoodMealComponent) => {
    setLegacyFoodNames((prev) => prev.filter((name) => name !== component.name));
    setExtraComponents((prev) =>
      prev.some((item) => item.name === component.name) ? prev : [...prev, component]
    );
  };

  const buildCommonComponent = (
    category: CommonFoodCategory,
    food: CommonFoodOption
  ): FoodMealComponent => {
    const catalogFood = foodData.foodItems.find((item) => item.name === food.name);
    const familyFood = foodItems.find((item) => item.name === food.name);
    const foodId = food.foodId || catalogFood?.id || familyFood?.foodId || familyFood?.id;
    return {
      role: category.role,
      name: food.name,
      ...(foodId ? { foodId } : {}),
      icon: food.icon || catalogFood?.icon || familyFood?.icon || "🍽️",
      grams: food.grams ?? category.defaultGrams,
    };
  };

  const handleToggleCommonFood = (
    category: CommonFoodCategory,
    food: CommonFoodOption
  ) => {
    if (isFoodSelected(food.name)) {
      removeFoodByName(food.name);
      return;
    }
    addFoodComponent(buildCommonComponent(category, food));
  };

  const handleToggleOptional = (item: SpinnerItem) => {
    if (isFoodSelected(item.name)) {
      removeFoodByName(item.name);
      return;
    }
    const familyFood = foodItems.find((food) => food.name === item.name);
    const foodId = item.id.startsWith("common_option_")
      ? undefined
      : familyFood?.foodId || familyFood?.id || item.id;
    addFoodComponent({
      role: "optional",
      name: item.name,
      ...(foodId ? { foodId } : {}),
      icon: item.icon,
      grams: item.name.includes("油") ? 2 : 20,
    });
  };

  const handleUpdateComponentGrams = (name: string, grams: number) => {
    const safeGrams = clampFoodGrams(grams);
    setRetainedComponents((prev) =>
      prev.map((component) => component.name === name ? { ...component, grams: safeGrams } : component)
    );
    setExtraComponents((prev) =>
      prev.map((component) => component.name === name ? { ...component, grams: safeGrams } : component)
    );
    if (stapleList[stapleIndex]?.name === name) setStapleGrams(safeGrams);
    if (proteinList[proteinIndex]?.name === name) setProteinGrams(safeGrams);
    if (vegetableList[vegIndex]?.name === name) setVegGrams(safeGrams);
  };

  const handleAddWheelItem = (role: "staple" | "protein" | "vegetable") => {
    const list = role === "staple" ? stapleList : role === "protein" ? proteinList : vegetableList;
    const index = role === "staple" ? stapleIndex : role === "protein" ? proteinIndex : vegIndex;
    const grams = role === "staple" ? stapleGrams : role === "protein" ? proteinGrams : vegGrams;
    const item = list[index];
    if (!item || index === 0) return;

    const component = componentFromWheel(role, item, grams);
    setLegacyFoodNames((prev) => prev.filter((name) => name !== item.name));
    const alreadyRetained = retainedComponents.some((existing) => existing.name === item.name);
    if (alreadyRetained) {
      setRetainedComponents((prev) => prev.map((existing) =>
        existing.name === item.name ? { ...existing, grams } : existing
      ));
      return;
    }
    setExtraComponents((prev) => {
      const exists = prev.some((existing) => existing.name === item.name);
      return exists
        ? prev.map((existing) => existing.name === item.name ? { ...existing, grams } : existing)
        : [...prev, component];
    });
  };

  // Add custom food modal
  const [showAddFood, setShowAddFood] = useState(false);
  const [newFoodName, setNewFoodName] = useState("");
  const [newFoodIcon, setNewFoodIcon] = useState("🍽️");
  const [newFoodCategory, setNewFoodCategory] = useState("grain");
  const selectedCustomCategory = CUSTOM_FOOD_CATEGORIES.find((category) => category.id === newFoodCategory)
    ?? CUSTOM_FOOD_CATEGORIES[0];
  const [addingFood, setAddingFood] = useState(false);

  const handleAddCustomFood = async () => {
    const name = newFoodName.trim();
    if (!name) {
      showToast("请输入食材名称");
      return;
    }
    if (!familyId) {
      showToast("请先选择家庭");
      return;
    }
    setAddingFood(true);
    try {
      const res = await fetch("/api/food/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          name,
          icon: newFoodIcon,
          category: selectedCustomCategory.apiCategory,
          status: "tried",
          firstAddedDate: getLocalDateStr(),
        }),
      });
      if (!res.ok) throw new Error("创建失败");
      const created = await res.json();
      if (resolveFoodFormFamilyId(useBabyStore.getState()) !== familyId) return;

      const defaultGrams = selectedCustomCategory.apiCategory === "oil"
        ? 2
        : selectedCustomCategory.role === "staple"
          ? 20
          : selectedCustomCategory.role === "protein"
            ? 25
            : selectedCustomCategory.role === "vegetable"
              ? 30
              : 15;
      addFoodComponent({
        role: selectedCustomCategory.role,
        name: created.name || name,
        ...(created.foodId || created.id ? { foodId: created.foodId || created.id } : {}),
        icon: created.icon || newFoodIcon,
        grams: defaultGrams,
      });

      setShowAddFood(false);
      setNewFoodName("");
      showToast(`已添加「${created.name}」到食材库 ✅`);
      await fetchFoodItems("tried", true);
    } catch {
      showToast("添加失败，请重试");
    } finally {
      setAddingFood(false);
    }
  };

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (activeComponents.length === 0 && legacyFoodNames.length === 0) {
      showToast("请至少为宝宝选择一种辅食食材");
      return;
    }

    let autoPortion = portion;
    if (!isEdit && totalGrams > 0) {
      if (totalGrams <= 35) autoPortion = "little";
      else if (totalGrams <= 60) autoPortion = "half";
      else if (totalGrams <= 95) autoPortion = "most";
      else autoPortion = "all";
    }

    const selectedFoodNames = [...legacyFoodNames];
    for (const component of activeComponents) {
      if (!selectedFoodNames.includes(component.name)) selectedFoodNames.push(component.name);
    }
    const hasComponentPayload = activeComponents.length > 0 ||
      (Array.isArray(initialData?.components) && initialData.components.length > 0);
    const sameAsInitialComponents = activeComponents.length === initialDataComponents.length &&
      activeComponents.every((component, index) =>
        JSON.stringify(component) === JSON.stringify(initialDataComponents[index])
      );
    const persistedTotalGrams = totalGrams > 0
      ? totalGrams
      : isEdit && sameAsInitialComponents && typeof initialData?.totalGrams === "number"
        ? initialData.totalGrams
        : totalGrams;

    const payload = {
      date,
      time,
      foods: selectedFoodNames,
      ...(hasComponentPayload ? { components: activeComponents, totalGrams: persistedTotalGrams } : {}),
      portion: autoPortion,
      acceptance,
      babyState,
      hasAbnormal,
      abnormalNotes: hasAbnormal ? abnormalNotes.trim() : undefined,
    };
    const limitMessage = foodLogLimitMessage({ ...payload, notes: initialData?.notes });
    if (limitMessage) {
      showToast(limitMessage);
      return;
    }
    await onSubmit(payload);
  };

  return (
    <div className="space-y-4">
      {/* Voice entry (Create mode only) */}
      {!isEdit && <VoiceConfirmEntry contextType="food" />}

      {/* Date and time */}
      <FormSection title="记录时间">
        <div className="flex gap-3">
          <div className="flex-1">
            <CuteInput
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <CuteInput
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
      </FormSection>

      {/* 3-Column Wheel Spinners */}
      <FormSection title="🥣 辅食黄金餐盘 (三大滚轮组合)">
        <div className="flex items-center justify-between -mt-1 mb-2.5 gap-2">
          <p className="text-[11px] text-text-muted">
            {isEdit
              ? "编辑时先滚动选择候选食材，再点下方按钮加入；已记录食材会保留。"
              : "滚轮设置基础搭配；常吃菜可按分类多选，每种食材都能单独调克数。"}
          </p>
          {!isEdit && (
            <button
              type="button"
              onClick={handleSpin}
              disabled={isSpinning}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-500 via-rose-500 to-emerald-500 text-white shadow-xs hover:shadow-md transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
              title="随机转一转"
            >
              <Dices size={14} className={isSpinning ? "animate-spin" : ""} />
              <span>{isSpinning ? "滚动中..." : "🎲 随机转一转"}</span>
            </button>
          )}
        </div>

        {/* Quick Presets (仅新建模式显示) */}
        {!isEdit && (
          <div className="mb-3 bg-gradient-to-r from-amber-50/70 to-orange-50/70 dark:from-amber-950/20 dark:to-orange-950/20 p-2.5 rounded-2xl border border-amber-200/50">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 mb-1.5">
              <Sparkles size={13} className="text-amber-500" />
              <span>一键搭配推荐:</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {QUICK_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className="text-left p-2 rounded-xl bg-white/90 dark:bg-card border border-amber-100/80 hover:border-amber-400 hover:shadow-xs transition-all text-xs btn-press"
                >
                  <div className="font-bold text-text-primary text-[11px] truncate">{preset.title}</div>
                  <div className="text-[10px] text-text-muted truncate mt-0.5">{preset.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 三大滚轮：主食 + 肉类 + 蔬菜 */}
        <div className="grid grid-cols-3 gap-2">
          {/* 1. 主食谷薯 */}
          <WheelSpinnerColumn
            role="staple"
            title="主食 · 谷薯"
            sublabel="米粉/米粥/面条"
            icon="🍚"
            items={stapleList}
            selectedIndex={stapleIndex}
            onSelectIndex={setStapleIndex}
            grams={stapleGrams}
            onUpdateGrams={setStapleGrams}
            gramOptions={ROLE_CONFIG.staple.gramOptions}
            colorTheme={{
              accent: "border-amber-400 text-amber-600",
              border: "border-amber-200 dark:border-amber-900/40",
              bg: "bg-amber-50/40 dark:bg-amber-950/20",
              badge: "bg-amber-100 text-amber-800",
            }}
            isSpinning={isSpinning}
          />

          {/* 2. 肉蛋优质蛋白 */}
          <WheelSpinnerColumn
            role="protein"
            title="肉蛋 · 蛋白"
            sublabel="红肉/禽肉/鱼虾蛋"
            icon="🥩"
            items={proteinList}
            selectedIndex={proteinIndex}
            onSelectIndex={setProteinIndex}
            grams={proteinGrams}
            onUpdateGrams={setProteinGrams}
            gramOptions={ROLE_CONFIG.protein.gramOptions}
            colorTheme={{
              accent: "border-rose-400 text-rose-600",
              border: "border-rose-200 dark:border-rose-900/40",
              bg: "bg-rose-50/40 dark:bg-rose-950/20",
              badge: "bg-rose-100 text-rose-800",
            }}
            isSpinning={isSpinning}
          />

          {/* 3. 蔬菜菌藻 */}
          <WheelSpinnerColumn
            role="vegetable"
            title="蔬菜 · 菌藻"
            sublabel="西兰花/菠菜/胡萝卜"
            icon="🥦"
            items={vegetableList}
            selectedIndex={vegIndex}
            onSelectIndex={setVegIndex}
            grams={vegGrams}
            onUpdateGrams={setVegGrams}
            gramOptions={ROLE_CONFIG.vegetable.gramOptions}
            colorTheme={{
              accent: "border-emerald-400 text-emerald-600",
              border: "border-emerald-200 dark:border-emerald-900/40",
              bg: "bg-emerald-50/40 dark:bg-emerald-950/20",
              badge: "bg-emerald-100 text-emerald-800",
            }}
            isSpinning={isSpinning}
          />
        </div>

        {isEdit && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {([
              { role: "staple" as const, label: "加入主食", item: stapleList[stapleIndex] },
              { role: "protein" as const, label: "加入蛋白", item: proteinList[proteinIndex] },
              { role: "vegetable" as const, label: "加入蔬菜", item: vegetableList[vegIndex] },
            ]).map(({ role, label, item }) => (
              <button
                key={role}
                type="button"
                onClick={() => handleAddWheelItem(role)}
                disabled={!item || item.id === "none"}
                aria-label={`${label}：${item?.name || "无"}`}
                className="rounded-xl border border-primary/20 bg-primary/5 px-2 py-1.5 text-[10px] font-bold text-primary disabled:opacity-40"
              >
                + {label}
              </button>
            ))}
          </div>
        )}

        {/* 常吃菜分类，点击只选择本餐，不会写入“已尝试”食材库 */}
        <div className="mt-3 rounded-2xl border border-primary/15 bg-card p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-text-primary">🍽️ 常吃菜分类（可跨类多选）</div>
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              已选 {activeComponents.length + legacyFoodNames.length}/{MAX_MEAL_FOODS} 样
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5" aria-label="常吃菜分类">
            {COMMON_FOOD_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-label={`常吃菜分类：${category.label}`}
                aria-pressed={activeCommonCategoryId === category.id}
                onClick={() => setActiveCommonCategoryId(category.id)}
                className={`rounded-xl px-1.5 py-1.5 text-[10px] font-bold transition-colors ${
                  activeCommonCategoryId === category.id
                    ? "bg-primary text-white shadow-xs"
                    : "bg-gray-100 dark:bg-gray-800 text-text-secondary"
                }`}
              >
                <span className="mr-0.5">{category.icon}</span>{category.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5" aria-label={`${activeCommonCategory.label}常见食材`}>
            {activeCommonCategory.foods.map((food) => {
              const selected = isFoodSelected(food.name);
              return (
                <button
                  key={food.name}
                  type="button"
                  aria-label={`选择${food.name}`}
                  aria-pressed={selected}
                  onClick={() => handleToggleCommonFood(activeCommonCategory, food)}
                  className={`btn-press rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                    selected
                      ? "bg-primary text-white font-bold shadow-xs"
                      : "bg-gray-100 dark:bg-gray-800 text-text-secondary hover:bg-gray-200"
                  }`}
                >
                  {food.icon} {food.name}
                  {selected && <Check size={11} className="inline ml-1" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 本餐完整选择列表：包括初始未知食材，每一项独立克数 */}
        <div className="mt-2 rounded-2xl border border-divider/60 bg-card p-3 space-y-2">
          <div className="text-xs font-bold text-text-primary">本餐食材与克数</div>
          {activeComponents.length === 0 && legacyFoodNames.length === 0 ? (
            <p className="text-[11px] text-text-muted">还没有选择食材。</p>
          ) : (
            <div className="space-y-1.5">
              {activeComponents.map((component, index) => (
                <div
                  key={`${component.role}:${component.name}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-divider/40 bg-bg/60 px-2 py-1.5"
                >
                  <div className="min-w-0 truncate text-xs font-bold text-text-primary">
                    <span className="mr-1">{component.icon || "🍽️"}</span>{component.name}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={300}
                      value={component.grams ?? ""}
                      aria-label={`${component.name}克数`}
                      onChange={(event) => handleUpdateComponentGrams(component.name, Number(event.target.value))}
                      className="w-14 rounded-lg border border-divider bg-card py-1 text-center text-xs font-bold"
                    />
                    <span className="text-[10px] text-text-muted">g</span>
                    <button
                      type="button"
                      aria-label={`移除${component.name}`}
                      onClick={() => removeFoodByName(component.name)}
                      className="rounded-full p-1 text-text-muted hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {legacyFoodNames.map((name, index) => (
                <div
                  key={`legacy:${name}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-amber-200/60 bg-amber-50/50 px-2 py-1.5"
                >
                  <div className="min-w-0 truncate text-xs font-bold text-text-primary">🥣 {name}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-[10px] text-text-muted">旧记录</span>
                    <button
                      type="button"
                      aria-label={`移除${name}`}
                      onClick={() => setLegacyFoodNames((prev) => prev.filter((foodName) => foodName !== name))}
                      className="rounded-full p-1 text-text-muted hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 食材库已尝试的油脂与水果 (保留原入口) */}
        <div className="mt-3 bg-card rounded-2xl border border-divider/60 p-3">
          <button
            type="button"
            onClick={() => setShowOptionalSection((prev) => !prev)}
            className="w-full flex items-center justify-between text-xs font-bold text-text-primary"
          >
            <div className="flex items-center gap-1.5">
              <span>🥑 食材库水果与油脂 (可选)</span>
              {selectedOptionals.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800">
                  已加 {selectedOptionals.length} 样
                </span>
              )}
            </div>
            {showOptionalSection ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showOptionalSection && (
            <div className="mt-2.5 pt-2 border-t border-divider/40 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {optionalList.map((opt) => {
                  const isSelected = isFoodSelected(opt.name);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-label={`选择${opt.name}`}
                      aria-pressed={isSelected}
                      onClick={() => handleToggleOptional(opt)}
                      className={`btn-press px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        isSelected
                          ? "bg-sky-500 text-white font-bold shadow-xs"
                          : "bg-gray-100 dark:bg-gray-800 text-text-secondary hover:bg-gray-200"
                      }`}
                    >
                      {opt.icon} {opt.name}
                      {isSelected && <Check size={11} className="inline ml-1" />}
                    </button>
                  );
                })}
              </div>

            </div>
          )}
        </div>

        {/* 自定义食材按钮与家庭状态 */}
        <div className="mt-2.5 flex items-center justify-between">
          <button
            type="button"
            disabled={familyLoading || !familyId}
            onClick={() => setShowAddFood(true)}
            className="btn-press px-3 py-1.5 rounded-full text-xs font-medium bg-card text-primary border border-dashed border-primary/40 hover:bg-primary-light/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {familyLoading ? "加载家庭..." : "+ 自定义食材"}
          </button>
        </div>

        {familyLoadError && !familyLoading && !familyId && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs text-amber-800">{familyLoadError}</p>
            <button
              type="button"
              onClick={() => setFamilyRetry((value) => value + 1)}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary"
            >
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        )}

        {showAddFood && (
          <div className="mt-3 bg-card rounded-2xl border border-primary-soft p-3.5 space-y-3 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-primary">
                添加自定义食材到【{selectedCustomCategory.label}】
              </span>
              <button
                type="button"
                onClick={() => setShowAddFood(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {CUSTOM_FOOD_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-label={`自定义食材分类：${category.label}`}
                  aria-pressed={newFoodCategory === category.id}
                  onClick={() => {
                    setNewFoodCategory(category.id);
                    setNewFoodIcon(category.icon);
                  }}
                  className={`py-1.5 rounded-xl text-[10px] font-bold transition-all ${
                    newFoodCategory === category.id
                      ? "bg-primary text-white shadow-xs"
                      : "bg-gray-100 dark:bg-gray-800 text-text-secondary"
                  }`}
                >
                  {category.icon} {category.label}
                </button>
              ))}
            </div>

            <CuteInput
              placeholder="输入食材名称，如：山药、猪肝、三文鱼…"
              value={newFoodName}
              onChange={(e) => setNewFoodName(e.target.value)}
              autoFocus
            />
            <div>
              <p className="text-xs text-text-secondary mb-1.5 pl-1">选择图标</p>
              <div className="flex flex-wrap gap-1.5">
                {FOOD_ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setNewFoodIcon(icon)}
                    className={`w-8 h-8 rounded-xl text-base flex items-center justify-center transition-all ${
                      newFoodIcon === icon
                        ? "bg-primary/15 ring-2 ring-primary"
                        : "bg-primary-light/40 hover:bg-primary-light"
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <CuteButton size="sm" fullWidth onClick={handleAddCustomFood} disabled={addingFood}>
                {addingFood ? "添加中..." : "确认添加"}
              </CuteButton>
              <CuteButton
                size="sm"
                variant="secondary"
                fullWidth
                onClick={() => setShowAddFood(false)}
              >
                取消
              </CuteButton>
            </div>
          </div>
        )}
      </FormSection>

      {/* 📊 餐盘汇总与营养平衡提示 */}
      {activeComponents.length > 0 && (
        <div className="bg-card p-3.5 rounded-2xl border border-primary/20 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-text-primary">
            <span className="flex items-center gap-1.5">
              <UtensilsCrossed size={14} className="text-primary" />
              <span>本餐总摄入约:</span>
              <span className="text-base text-primary font-extrabold">{totalGrams}g</span>
            </span>
            <span className="text-[11px] text-text-muted">已选 {activeComponents.length} 种食材</span>
          </div>

          {/* 营养配比状态条 */}
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
              <div
                style={{
                  width: `${totalGrams > 0 ? (activeComponents.filter((c) => c.role === "staple").reduce((s, c) => s + (c.grams || 0), 0) / totalGrams) * 100 : 0}%`,
                }}
                className="bg-amber-400 h-full transition-all"
                title="主食"
              />
              <div
                style={{
                  width: `${totalGrams > 0 ? (activeComponents.filter((c) => c.role === "protein").reduce((s, c) => s + (c.grams || 0), 0) / totalGrams) * 100 : 0}%`,
                }}
                className="bg-rose-400 h-full transition-all"
                title="优质蛋白"
              />
              <div
                style={{
                  width: `${totalGrams > 0 ? (activeComponents.filter((c) => c.role === "vegetable").reduce((s, c) => s + (c.grams || 0), 0) / totalGrams) * 100 : 0}%`,
                }}
                className="bg-emerald-400 h-full transition-all"
                title="蔬菜"
              />
              <div
                style={{
                  width: `${totalGrams > 0 ? (activeComponents.filter((c) => c.role === "optional" || c.role === "fruit" || c.role === "oil").reduce((s, c) => s + (c.grams || 0), 0) / totalGrams) * 100 : 0}%`,
                }}
                className="bg-sky-400 h-full transition-all"
                title="油脂水果"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-text-muted px-0.5">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> 主食碳水
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" /> 优质蛋白
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> 蔬菜菌藻
              </span>
            </div>
          </div>

          {/* 智能温和育儿提示 */}
          <div className="pt-1 text-[11px]">
            {hasStaple && hasProtein && hasVeg ? (
              <p className="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded-xl">
                ✨ 黄金搭配！本餐主食碳水、优质蛋白与蔬菜搭配均衡，营养满满。
              </p>
            ) : !hasProtein ? (
              <p className="text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-xl">
                💡 提示：本餐未包含肉蛋蛋白，下一餐记得安排红肉泥或鱼禽，保证铁与蛋白质摄入。
              </p>
            ) : !hasVeg ? (
              <p className="text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 p-2 rounded-xl">
                💡 提示：本餐可搭配绿叶菜或胡萝卜，补充维生素C与膳食纤维，还能促进铁吸收。
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Portion */}
      <FormSection title="整体进食胃口">
        <div className="grid grid-cols-2 gap-2">
          {portionOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPortion(opt.value)}
              className={`btn-press py-2.5 rounded-2xl text-xs font-medium transition-all ${
                portion === opt.value
                  ? "bg-primary text-white shadow-button font-bold"
                  : "bg-card text-text-secondary border border-divider hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FormSection>

      {/* Acceptance rating */}
      <FormSection title="宝宝喜欢程度">
        <div className="flex justify-center py-1">
          <HeartRating value={acceptance} onChange={setAcceptance} size={28} />
        </div>
      </FormSection>

      {/* Baby state */}
      <FormSection title="进食情绪状态">
        <div className="flex gap-3">
          {stateOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setBabyState(opt.value)}
              className={`btn-press flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl transition-all ${
                babyState === opt.value
                  ? "bg-primary text-white shadow-button font-bold"
                  : "bg-card text-text-secondary border border-divider hover:bg-gray-50"
              }`}
            >
              <span className="text-2xl">{opt.emoji}</span>
              <span className="text-xs">{opt.label}</span>
            </button>
          ))}
        </div>
      </FormSection>

      {/* Abnormal toggle */}
      <FormSection title="是否有明显过敏 / 异常反应">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setHasAbnormal(false)}
            className={`btn-press flex-1 py-2.5 rounded-2xl text-xs font-medium transition-all ${
              !hasAbnormal
                ? "bg-primary text-white shadow-button font-bold"
                : "bg-card text-text-secondary border border-divider hover:bg-gray-50"
            }`}
          >
            正常无异常 ✨
          </button>
          <button
            type="button"
            onClick={() => setHasAbnormal(true)}
            className={`btn-press flex-1 py-2.5 rounded-2xl text-xs font-medium transition-all ${
              hasAbnormal
                ? "bg-red-500 text-white shadow-button font-bold"
                : "bg-card text-text-secondary border border-divider hover:bg-gray-50"
            }`}
          >
            有异常 / 泛红 🚨
          </button>
        </div>

        {hasAbnormal && (
          <div className="mt-3">
            <CuteTextarea
              placeholder="请详细描述异常情况，如嘴周泛红、起疹子、腹泻等..."
              value={abnormalNotes}
              onChange={(e) => setAbnormalNotes(e.target.value)}
              rows={2}
            />
          </div>
        )}
      </FormSection>

      {/* Buttons */}
      <div className="pt-2 flex gap-3">
        {isEdit && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-full border border-primary-soft text-text-secondary text-sm font-medium btn-press hover:bg-gray-50"
          >
            取消
          </button>
        )}
        <CuteButton
          fullWidth={!isEdit}
          size="lg"
          onClick={() => handleFormSubmit()}
          disabled={saving}
          className={`flex items-center justify-center gap-2 ${isEdit ? "flex-1" : ""}`}
        >
          <CheckCircle2 size={18} />
          {saving ? "保存中..." : isEdit ? "保存修改" : "保存辅食记录"}
        </CuteButton>
      </div>
    </div>
  );
}

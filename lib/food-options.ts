import type { FoodCategoryRole } from "@/types";

export interface CommonFoodOption {
  name: string;
  icon: string;
  grams?: number;
  foodId?: string;
}

export interface CommonFoodCategory {
  id: string;
  label: string;
  icon: string;
  apiCategory: string;
  role: FoodCategoryRole;
  defaultGrams: number;
  foods: CommonFoodOption[];
}

export const COMMON_FOOD_CATEGORIES: CommonFoodCategory[] = [
  {
    id: "grain",
    label: "谷物主食",
    icon: "🌾",
    apiCategory: "grain",
    role: "staple",
    defaultGrams: 20,
    foods: [
      { name: "强化铁婴儿谷物", icon: "🥣", foodId: "food_iron_cereal" },
      { name: "大米粥", icon: "🍚", foodId: "food_rice_porridge" },
      { name: "燕麦", icon: "🌾", foodId: "food_oats" },
      { name: "软面条", icon: "🍜", foodId: "food_noodles" },
      { name: "小米粥", icon: "🥣" },
      { name: "玉米糊", icon: "🌽" },
    ],
  },
  {
    id: "tubers",
    label: "薯类根茎",
    icon: "🥔",
    apiCategory: "vegetable",
    role: "staple",
    defaultGrams: 20,
    foods: [
      { name: "土豆", icon: "🥔", foodId: "food_potato" },
      { name: "红薯", icon: "🍠", foodId: "food_sweet_potato" },
      { name: "山药", icon: "🥔" },
    ],
  },
  {
    id: "meat",
    label: "肉禽类",
    icon: "🥩",
    apiCategory: "protein",
    role: "protein",
    defaultGrams: 25,
    foods: [
      { name: "牛肉", icon: "🥩", foodId: "food_beef" },
      { name: "猪肉", icon: "🥩", foodId: "food_pork" },
      { name: "羊肉", icon: "🥩" },
      { name: "鸡肉", icon: "🍗", foodId: "food_chicken" },
      { name: "鸭肉", icon: "🍗" },
      { name: "猪肝", icon: "🥩" },
    ],
  },
  {
    id: "seafood",
    label: "鱼虾海鲜",
    icon: "🐟",
    apiCategory: "protein",
    role: "protein",
    defaultGrams: 20,
    foods: [
      { name: "鳕鱼", icon: "🐟" },
      { name: "三文鱼", icon: "🐟", foodId: "food_salmon" },
      { name: "鲈鱼", icon: "🐟" },
      { name: "黄花鱼", icon: "🐟" },
      { name: "虾", icon: "🍤", foodId: "food_shrimp" },
      { name: "扇贝", icon: "🦪" },
    ],
  },
  {
    id: "egg_legume",
    label: "蛋豆制品",
    icon: "🥚",
    apiCategory: "protein",
    role: "protein",
    defaultGrams: 15,
    foods: [
      { name: "鸡蛋", icon: "🥚", foodId: "food_egg" },
      { name: "豆腐", icon: "🧈", foodId: "food_tofu" },
      { name: "豌豆", icon: "🫛" },
      { name: "鹰嘴豆", icon: "🫘" },
    ],
  },
  {
    id: "vegetable",
    label: "蔬菜菌菇",
    icon: "🥦",
    apiCategory: "vegetable",
    role: "vegetable",
    defaultGrams: 30,
    foods: [
      { name: "西兰花", icon: "🥦", foodId: "food_broccoli" },
      { name: "胡萝卜", icon: "🥕", foodId: "food_carrot" },
      { name: "南瓜", icon: "🎃", foodId: "food_pumpkin" },
      { name: "菠菜", icon: "🥬", foodId: "food_spinach" },
      { name: "番茄", icon: "🍅", foodId: "food_tomato" },
      { name: "香菇", icon: "🍄" },
    ],
  },
  {
    id: "fruit",
    label: "水果",
    icon: "🍎",
    apiCategory: "fruit",
    role: "optional",
    defaultGrams: 15,
    foods: [
      { name: "香蕉", icon: "🍌", foodId: "food_banana" },
      { name: "苹果", icon: "🍎", foodId: "food_apple" },
      { name: "梨", icon: "🍐", foodId: "food_pear" },
      { name: "牛油果", icon: "🥑", foodId: "food_avocado" },
      { name: "蓝莓", icon: "🫐" },
    ],
  },
  {
    id: "dairy",
    label: "乳制品",
    icon: "🥛",
    apiCategory: "dairy",
    role: "optional",
    defaultGrams: 15,
    foods: [{ name: "原味巴氏杀菌酸奶", icon: "🥛", foodId: "food_yogurt_plain" }],
  },
  {
    id: "oil",
    label: "辅食油",
    icon: "🫒",
    apiCategory: "oil",
    role: "optional",
    defaultGrams: 2,
    foods: [
      { name: "核桃油", icon: "🫒" },
      { name: "亚麻籽油", icon: "🫒" },
      { name: "橄榄油", icon: "🫒" },
    ],
  },
];

export const CUSTOM_FOOD_CATEGORIES = [
  ...COMMON_FOOD_CATEGORIES.map(({ id, label, icon, apiCategory, role }) => ({
    id,
    label,
    icon,
    apiCategory,
    role,
  })),
  { id: "other", label: "其他", icon: "🍽️", apiCategory: "other", role: "optional" as const },
];

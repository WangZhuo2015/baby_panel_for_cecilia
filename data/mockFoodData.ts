import type { FoodItem, FoodPlan, FoodLogRecord } from '../types';

export const mockFoodItems: FoodItem[] = [
  { id: 'f1', name: '高铁米粉', icon: '🌾', firstAddedDate: '2025-06-01', acceptance: 5, status: 'tried', category: '谷物' },
  { id: 'f2', name: '南瓜', icon: '🎃', firstAddedDate: '2025-06-15', acceptance: 4, status: 'tried', category: '蔬菜' },
  { id: 'f3', name: '西兰花', icon: '🥦', firstAddedDate: '2025-06-20', acceptance: 3, status: 'tried', category: '蔬菜' },
  { id: 'f4', name: '牛肉', icon: '🥩', firstAddedDate: '2025-07-10', acceptance: 4, status: 'tried', category: '肉类' },
  { id: 'f5', name: '鸡蛋黄', icon: '🥚', firstAddedDate: undefined, acceptance: 0, status: 'to_try', category: '蛋类' },
  { id: 'f6', name: '胡萝卜', icon: '🥕', firstAddedDate: undefined, acceptance: 0, status: 'to_try', category: '蔬菜' },
  { id: 'f7', name: '苹果', icon: '🍎', firstAddedDate: undefined, acceptance: 0, status: 'to_try', category: '水果' },
  { id: 'f8', name: '牛油果', icon: '🥑', firstAddedDate: undefined, acceptance: 0, status: 'to_try', category: '水果' },
];

export const mockFoodPlans: FoodPlan[] = [
  {
    id: 'fp1',
    date: '2025-07-12',
    name: '牛肉南瓜米糊',
    tags: ['已尝试', '今日新食材'],
    nutrition: '富含铁 + 维生素A',
    ingredients: ['高铁米粉', '牛肉', '南瓜泥'],
    steps: [
      '米粉加适量温水搅拌',
      '牛肉蒸熟切碎',
      '南瓜蒸熟压泥',
      '混合所有食材',
    ],
  },
  {
    id: 'fp2',
    date: '2025-07-13',
    name: '西兰花鸡肉粥',
    tags: ['已尝试'],
    nutrition: '富含蛋白质 + 维生素C',
    ingredients: ['大米粥', '鸡胸肉', '西兰花'],
    steps: [
      '大米煮成软粥',
      '鸡胸肉蒸熟切末',
      '西兰花焯水切碎',
      '混合搅拌均匀',
    ],
  },
];

export const mockFoodLogHistory: FoodLogRecord[] = [
  {
    id: 'fl1',
    date: '2025-07-12',
    time: '05:00',
    foods: ['高铁米粉', '南瓜'],
    portion: 'most',
    acceptance: 4,
    babyState: 'happy',
    hasAbnormal: false,
  },
];

export const mockWeeklyDates = Array.from({ length: 7 }, (_, i) => {
  const today = new Date();
  const date = new Date(today);
  date.setDate(today.getDate() + i - 3);
  return {
    date: date.toISOString().split('T')[0],
    day: date.getDate(),
    weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
    isToday: i === 3,
  };
});

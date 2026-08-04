import type { DailySummary, TimelineEntry, WeatherData } from '../types';

export const mockDailySummary: DailySummary = {
  totalFeedingMl: 720,
  totalSleepMinutes: 680,
  diaperCount: 6,
  foodCount: 1,
};

export const mockTimeline: TimelineEntry[] = [
  {
    id: 't1',
    time: '08:30',
    type: 'feeding',
    title: '喂奶',
    detail: '配方奶 120ml',
    icon: '🍼',
  },
  {
    id: 't2',
    time: '07:45',
    type: 'diaper',
    title: '尿布',
    detail: '尿 + 便',
    icon: '👶',
  },
  {
    id: 't3',
    time: '06:30',
    type: 'sleep',
    title: '睡觉',
    detail: '夜间睡眠 8h30m',
    icon: '😴',
  },
  {
    id: 't4',
    time: '05:00',
    type: 'food',
    title: '辅食',
    detail: '牛肉南瓜米糊',
    icon: '🥣',
  },
];

export const mockWeather: WeatherData = {
  city: '杭州',
  temperature: 26,
  condition: '多云',
  uv: 3,
  rainProbability: 10,
  humidity: 62,
  airQuality: '良',
  outdoorAdvice: '适合上午外出',
  hourlyForecast: [
    { time: '09:00', temperature: 24, condition: '☁️' },
    { time: '10:00', temperature: 26, condition: '⛅' },
    { time: '11:00', temperature: 28, condition: '⛅' },
    { time: '12:00', temperature: 29, condition: '☀️' },
    { time: '13:00', temperature: 30, condition: '☀️' },
    { time: '14:00', temperature: 30, condition: '☀️' },
    { time: '15:00', temperature: 29, condition: '⛅' },
    { time: '16:00', temperature: 27, condition: '☁️' },
  ],
};

export const mockAiTips = [
  '小糖果最近睡眠时间比较规律，今天白天可以多安排一些地面自由活动哦～',
  '宝宝最近奶量稳定，继续保持当前喂养节奏就很棒啦！',
  '今天天气不错，上午带宝宝出去晒晒太阳有助于维生素D合成哦～',
];

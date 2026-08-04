import type { GrowthMeasurement } from '../types';

export const mockGrowthHistory: GrowthMeasurement[] = [
  { id: 'g1', date: '2025-01-15', ageInMonths: 0.5, ageLabel: '0月15天', weightKg: 3.4, heightCm: 50.5, headCircumferenceCm: 34.2, percentile: 45 },
  { id: 'g2', date: '2025-02-15', ageInMonths: 1.5, ageLabel: '1月15天', weightKg: 4.1, heightCm: 53.8, headCircumferenceCm: 36.1, percentile: 48 },
  { id: 'g3', date: '2025-03-15', ageInMonths: 2.5, ageLabel: '2月15天', weightKg: 4.8, heightCm: 56.2, headCircumferenceCm: 37.5, percentile: 50 },
  { id: 'g4', date: '2025-04-15', ageInMonths: 3.5, ageLabel: '3月15天', weightKg: 5.5, heightCm: 58.9, headCircumferenceCm: 38.8, percentile: 52 },
  { id: 'g5', date: '2025-05-15', ageInMonths: 4.5, ageLabel: '4月15天', weightKg: 6.1, heightCm: 61.3, headCircumferenceCm: 39.9, percentile: 55 },
  { id: 'g6', date: '2025-06-15', ageInMonths: 5.5, ageLabel: '5月15天', weightKg: 6.7, heightCm: 63.8, headCircumferenceCm: 41.0, percentile: 56 },
  { id: 'g7', date: '2025-07-12', ageInMonths: 6.4, ageLabel: '6月12天', weightKg: 7.35, heightCm: 67.2, headCircumferenceCm: 42.1, percentile: 58 },
];

// WHO percentile reference data for girls (simplified mock)
export const whoPercentiles = {
  weight: {
    P97: [2.8, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.7, 8.1, 8.5, 8.9],
    P85: [2.6, 3.9, 4.7, 5.3, 5.8, 6.3, 6.7, 7.1, 7.4, 7.8, 8.1],
    P50: [2.2, 3.3, 4.0, 4.5, 5.0, 5.4, 5.8, 6.1, 6.4, 6.7, 7.0],
    P15: [1.9, 2.8, 3.4, 3.8, 4.2, 4.5, 4.8, 5.1, 5.4, 5.6, 5.9],
    P3:  [1.6, 2.4, 2.9, 3.3, 3.6, 3.9, 4.2, 4.4, 4.7, 4.9, 5.1],
  },
};

export const monthLabels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

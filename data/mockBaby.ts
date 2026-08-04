import type { Baby } from '../types';

export const mockBaby: Baby = {
  id: 'baby-001',
  nickname: '小糖果',
  gender: 'female',
  birthDate: '2024-12-31',
  avatarUrl: undefined,
};

// Utility: calculate age in months and days
export function calculateAge(birthDate: string): { months: number; days: number; label: string } {
  const birth = new Date(birthDate);
  const now = new Date();

  let months = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    months--;
  }

  const birthDay = new Date(now.getFullYear(), now.getMonth(), birth.getDate());
  let days: number;

  if (now >= birthDay) {
    days = now.getDate() - birth.getDate();
  } else {
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days = prevMonth.getDate() - birth.getDate() + now.getDate();
  }

  return {
    months,
    days,
    label: `${months}月${days}天`,
  };
}

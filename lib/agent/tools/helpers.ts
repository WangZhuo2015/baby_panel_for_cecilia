export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function hhmmToIso(time: string, date: string): string {
  const ms = new Date(`${date}T${time}:00+08:00`).getTime();
  if (Number.isNaN(ms)) throw new Error(`无效时间 ${time}`);
  return new Date(ms).toISOString();
}
export function optionalNumber(raw: unknown, min: number, max: number, label: string): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < min || n > max) throw new Error(`${label} 必须在 ${min}-${max} 之间`);
  return n;
}

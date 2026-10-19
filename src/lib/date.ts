// 日付まわり（端末の時刻＝日本時間を前提にする）

/** ミリ秒 → "YYYY-MM-DD"（端末のローカル日付） */
export function localDay(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 試験日までの残り日数（当日は0） */
export function daysUntil(examDate: string, now: number): number {
  const [y, m, d] = examDate.split("-").map(Number);
  const exam = new Date(y, m - 1, d).getTime();
  const [ty, tm, td] = localDay(now).split("-").map(Number);
  const today = new Date(ty, tm - 1, td).getTime();
  return Math.round((exam - today) / 86400000);
}

/** 今日まで（または昨日まで）続いている連続学習日数 */
export function streakDays(days: Iterable<string>, now: number): number {
  const set = new Set(days);
  let count = 0;
  let cursor = new Date(now);
  if (!set.has(localDay(cursor.getTime()))) cursor = new Date(cursor.getTime() - 86400000);
  while (set.has(localDay(cursor.getTime()))) {
    count++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1, 12);
  }
  return count;
}

/** "YYYY-MM-DD" → "12/19（土）" */
export function formatDayJa(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${w}）`;
}

/** ミリ秒 → "10/19 14:05" */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 次の復習までの長さを「10分後」「3日後」のように表す */
export function formatInterval(fromTs: number, toTs: number): string {
  const min = Math.max(0, Math.round((toTs - fromTs) / 60000));
  if (min < 60) return `${Math.max(1, min)}分後`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間後`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}日後`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}か月後` : `${(d / 365).toFixed(1)}年後`;
}

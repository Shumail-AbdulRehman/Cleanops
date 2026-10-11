// Pure time, date and duration formatting for the staff app. No React.
import { formatClockTime } from "../utils/format";

export type FormatLanguage = "en" | "ur";
type Instant = string | Date;

const NBSP = /[  ]/g;
const pad = (n: number) => String(n).padStart(2, "0");

const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const UR_DAYS = ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"];
const UR_MONTHS = ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"];

/** "9:30 AM", plain spaces, Latin digits. */
export const clock = (value: Instant, timeZone?: string): string => formatClockTime(value, timeZone).replace(NBSP, " ");

/** "9:30 AM – 11:00 AM"; one shared AM/PM is said once: "12:30 – 1:30 PM". */
export const timeRange = (start: Instant, end: Instant, timeZone?: string): string => {
  const a = clock(start, timeZone);
  const b = clock(end, timeZone);
  const suffixA = a.slice(-2);
  if (suffixA === b.slice(-2)) return `${a.slice(0, -3)} – ${b}`;
  return `${a} – ${b}`;
};

/** "YYYY-MM-DD" in the given zone. */
export const localDate = (value: Instant, timeZone?: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const parseYmd = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

/** English "Tue, 10 Nov"; Urdu "منگل، 10 نومبر". */
export const shortDay = (value: Instant, timeZone?: string, language: FormatLanguage = "en"): string => {
  const { m, d, weekday } = parseYmd(localDate(value, timeZone));
  return language === "ur"
    ? `${UR_DAYS[weekday]}، ${d} ${UR_MONTHS[m - 1]}`
    : `${EN_DAYS[weekday].slice(0, 3)}, ${d} ${EN_MONTHS[m - 1].slice(0, 3)}`;
};

const addDays = (ymd: string, days: number) => {
  const { y, m, d } = parseYmd(ymd);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** "Today", "Yesterday", else the weekday name; every word goes through `t`. */
export const dayLabel = (dateYmd: string, todayYmd: string, _language: FormatLanguage, t: (key: string) => string): string => {
  if (dateYmd === todayYmd) return t("Today");
  if (dateYmd === addDays(todayYmd, -1)) return t("Yesterday");
  return t(EN_DAYS[parseYmd(dateYmd).weekday]);
};

/** "9 Nov" or "9 نومبر". */
export const dayMonth = (dateYmd: string, language: FormatLanguage): string => {
  const { m, d } = parseYmd(dateYmd);
  return language === "ur" ? `${d} ${UR_MONTHS[m - 1]}` : `${d} ${EN_MONTHS[m - 1].slice(0, 3)}`;
};

/** "November 2026" or "نومبر 2026". */
export const monthTitle = (yearMonth: string, language: FormatLanguage): string => {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${(language === "ur" ? UR_MONTHS : EN_MONTHS)[m - 1]} ${y}`;
};

/** addMonths('2026-11', -1) is "2026-10". */
export const addMonths = (yearMonth: string, delta: number): string => {
  const [y, m] = yearMonth.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
};

/** Negative, zero or positive like a sort comparator. */
export const compareMonths = (a: string, b: string): number => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return ay * 12 + am - (by * 12 + bm);
};

/** "8h 4m" or "8 گھنٹے 4 منٹ"; zero parts are dropped, 0 gives "0m". */
export const duration = (minutes: number, language: FormatLanguage): string => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hUnit = language === "ur" ? " گھنٹے" : "h";
  const mUnit = language === "ur" ? " منٹ" : "m";
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}${hUnit}`);
  if (m > 0 || h === 0) parts.push(`${m}${mUnit}`);
  return parts.join(" ");
};

/** "4:32": minutes unpadded, seconds padded. */
export const countdown = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
};

/** Whole minutes from start to end (negative if end is earlier). */
export const minutesBetween = (start: Instant, end: Instant): number =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);

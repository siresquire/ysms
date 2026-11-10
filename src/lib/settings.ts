import { z } from "zod";

/**
 * Report and assessment settings.
 *
 * Resolution order (later wins):
 *   built-in defaults for the section kind  ->  school overrides  ->  section overrides
 *
 * So a school can set its colour once for everyone, while Primary and JHS keep
 * their own grading scales, weights and head's title.
 */

export const sectionKinds = ["kg", "primary", "jhs"] as const;
export type SectionKind = (typeof sectionKinds)[number];

const gradeBand = z.object({
  /** Lowest total (out of 100) that earns this grade. */
  min: z.number().min(0).max(100),
  grade: z.string().min(1),
  remark: z.string(),
});
export type GradeBand = z.infer<typeof gradeBand>;

export const sectionSettingsSchema = z.object({
  assessment: z
    .object({
      /** Raw marks teachers type in, e.g. class score out of 30 or 100. */
      classScoreMax: z.number().positive(),
      examScoreMax: z.number().positive(),
      /** Percentage weights on the report, e.g. 30/70 or 50/50. */
      classScoreWeight: z.number().min(0).max(100),
      examScoreWeight: z.number().min(0).max(100),
    })
    .refine((a) => a.classScoreWeight + a.examScoreWeight === 100, {
      message: "Class score and exam weights must add up to 100",
    }),
  gradingScale: z.array(gradeBand).min(1),
  positions: z.object({
    show: z.boolean(),
    /** "level" ranks across all streams of a class (e.g. all of JHS 2). */
    scope: z.enum(["level", "stream", "both"]),
    showSubjectPositions: z.boolean(),
  }),
  report: z.object({
    title: z.string(),
    headTitle: z.string(),
    showAttendance: z.boolean(),
    showConduct: z.boolean(),
    showAttitude: z.boolean(),
    showInterest: z.boolean(),
  }),
  theme: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
});
export type SectionSettings = z.infer<typeof sectionSettingsSchema>;

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
/** What schools and sections store: only the values they changed. */
export type SettingsOverrides = DeepPartial<SectionSettings>;

/** BECE-style 1–9 scale commonly used on JHS reports. */
const jhsScale: GradeBand[] = [
  { min: 90, grade: "1", remark: "Highest" },
  { min: 80, grade: "2", remark: "Higher" },
  { min: 70, grade: "3", remark: "High" },
  { min: 60, grade: "4", remark: "High Average" },
  { min: 55, grade: "5", remark: "Average" },
  { min: 50, grade: "6", remark: "Low Average" },
  { min: 40, grade: "7", remark: "Low" },
  { min: 35, grade: "8", remark: "Lower" },
  { min: 0, grade: "9", remark: "Lowest" },
];

/** Standards-based curriculum proficiency levels used in primary. */
const primaryScale: GradeBand[] = [
  { min: 80, grade: "HP", remark: "Highly Proficient" },
  { min: 68, grade: "P", remark: "Proficient" },
  { min: 54, grade: "AP", remark: "Approaching Proficiency" },
  { min: 40, grade: "D", remark: "Developing" },
  { min: 0, grade: "B", remark: "Beginning" },
];

const base: SectionSettings = {
  assessment: { classScoreMax: 100, examScoreMax: 100, classScoreWeight: 30, examScoreWeight: 70 },
  gradingScale: primaryScale,
  positions: { show: true, scope: "both", showSubjectPositions: true },
  report: {
    title: "Terminal Report",
    headTitle: "Headteacher",
    showAttendance: true,
    showConduct: true,
    showAttitude: true,
    showInterest: true,
  },
  theme: { primaryColor: "#1d4ed8" },
};

export const builtInDefaults: Record<SectionKind, SectionSettings> = {
  kg: { ...base, positions: { show: false, scope: "stream", showSubjectPositions: false } },
  primary: base,
  jhs: { ...base, gradingScale: jhsScale },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge where arrays (e.g. grading scales) are replaced, not combined. */
function merge<T>(target: T, source: unknown): T {
  if (!isPlainObject(source) || !isPlainObject(target)) return (source ?? target) as T;
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? merge(out[key], value) : value;
  }
  return out as T;
}

export function resolveSettings(
  kind: SectionKind,
  schoolOverrides: SettingsOverrides | null | undefined,
  sectionOverrides: SettingsOverrides | null | undefined,
): SectionSettings {
  const merged = merge(merge(builtInDefaults[kind], schoolOverrides), sectionOverrides);
  return sectionSettingsSchema.parse(merged);
}

/** Weighted total out of 100 from raw class and exam marks. */
export function weightedTotal(
  a: SectionSettings["assessment"],
  classScore: number | null,
  examScore: number | null,
): number {
  const cs = ((classScore ?? 0) / a.classScoreMax) * a.classScoreWeight;
  const ex = ((examScore ?? 0) / a.examScoreMax) * a.examScoreWeight;
  return Math.round((cs + ex) * 100) / 100;
}

export function gradeFor(total: number, scale: GradeBand[]): GradeBand {
  const sorted = [...scale].sort((x, y) => y.min - x.min);
  return sorted.find((b) => total >= b.min) ?? sorted[sorted.length - 1];
}

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

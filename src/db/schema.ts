import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SettingsOverrides } from "@/lib/settings";
import { sectionKinds } from "@/lib/settings";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const sectionKind = pgEnum("section_kind", sectionKinds);
export const gender = pgEnum("gender", ["male", "female"]);
export const studentStatus = pgEnum("student_status", ["active", "withdrawn", "graduated"]);

/* ───────────────────────── School structure ───────────────────────── */

export const schools = pgTable("schools", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  motto: text("motto"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  /** Small image stored inline (data URL) so no separate file storage is needed. */
  crest: text("crest"),
  /** Overrides shared by every section, e.g. theme colour. */
  settings: jsonb("settings").$type<SettingsOverrides>().notNull().default({}),
  createdAt: createdAt(),
});

/** Primary and JHS (and optionally KG) run with their own head, grading and report setup. */
export const sections = pgTable(
  "sections",
  {
    id: id(),
    schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    kind: sectionKind("kind").notNull(),
    /** Name printed on reports, e.g. "Bright Future JHS". */
    displayName: text("display_name").notNull(),
    headName: text("head_name"),
    headSignature: text("head_signature"),
    /** Replaces the school crest on this section's reports when set. */
    crest: text("crest"),
    settings: jsonb("settings").$type<SettingsOverrides>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sections_school_kind_uq").on(t.schoolId, t.kind)],
);

/** E.g. "Basic 4" or "JHS 2". `nextLevelId` drives promotion; null means graduating. */
export const classLevels = pgTable(
  "class_levels",
  {
    id: id(),
    sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Order across the whole school (KG 1 = 1 … JHS 3 = 11), used for sorting. */
    sortOrder: smallint("sort_order").notNull(),
    nextLevelId: uuid("next_level_id").references((): AnyPgColumn => classLevels.id, {
      onDelete: "set null",
    }),
  },
  (t) => [uniqueIndex("class_levels_section_name_uq").on(t.sectionId, t.name)],
);

/** A stream such as "A" in JHS 2A. Single-stream classes have one stream. */
export const streams = pgTable(
  "streams",
  {
    id: id(),
    classLevelId: uuid("class_level_id")
      .notNull()
      .references(() => classLevels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("streams_level_name_uq").on(t.classLevelId, t.name)],
);

export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    sortOrder: smallint("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("subjects_section_name_uq").on(t.sectionId, t.name)],
);

/* ───────────────────────── Calendar ───────────────────────── */

export const academicYears = pgTable(
  "academic_years",
  {
    id: id(),
    schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    /** E.g. "2026/2027". */
    name: text("name").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [uniqueIndex("academic_years_school_name_uq").on(t.schoolId, t.name)],
);

export const terms = pgTable(
  "terms",
  {
    id: id(),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    number: smallint("number").notNull(),
    vacationDate: date("vacation_date"),
    reopeningDate: date("reopening_date"),
    /** Days school was in session, printed as "Attendance: 58 out of 62". */
    daysInSession: smallint("days_in_session"),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [
    uniqueIndex("terms_year_number_uq").on(t.academicYearId, t.number),
    check("terms_number_ck", sql`${t.number} between 1 and 3`),
  ],
);

/* ───────────────────────── Learners ───────────────────────── */

export const students = pgTable(
  "students",
  {
    id: id(),
    schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    admissionNo: text("admission_no").notNull(),
    surname: text("surname").notNull(),
    otherNames: text("other_names").notNull(),
    gender: gender("gender").notNull(),
    dateOfBirth: date("date_of_birth"),
    status: studentStatus("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("students_school_admission_uq").on(t.schoolId, t.admissionNo)],
);

/**
 * Which stream a student is in for a given year. Promotion creates next year's
 * rows; the student record itself is never re-entered.
 */
export const enrolments = pgTable(
  "enrolments",
  {
    id: id(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    streamId: uuid("stream_id").notNull().references(() => streams.id, { onDelete: "restrict" }),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("enrolments_student_year_uq").on(t.studentId, t.academicYearId),
    index("enrolments_stream_year_idx").on(t.streamId, t.academicYearId),
  ],
);

/* ───────────────────────── Assessment ───────────────────────── */

/** Raw marks as typed by the subject teacher; weighting happens at report time. */
export const scores = pgTable(
  "scores",
  {
    id: id(),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolments.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    classScore: numeric("class_score", { precision: 5, scale: 2, mode: "number" }),
    examScore: numeric("exam_score", { precision: 5, scale: 2, mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scores_enrolment_subject_term_uq").on(t.enrolmentId, t.subjectId, t.termId),
    index("scores_term_subject_idx").on(t.termId, t.subjectId),
    check("scores_class_nonneg_ck", sql`${t.classScore} >= 0`),
    check("scores_exam_nonneg_ck", sql`${t.examScore} >= 0`),
  ],
);

/** The non-score parts of a learner's report for one term. */
export const termReports = pgTable(
  "term_reports",
  {
    id: id(),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolments.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    daysPresent: integer("days_present"),
    conduct: text("conduct"),
    attitude: text("attitude"),
    interest: text("interest"),
    classTeacherRemark: text("class_teacher_remark"),
    headRemark: text("head_remark"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("term_reports_enrolment_term_uq").on(t.enrolmentId, t.termId)],
);

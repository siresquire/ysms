import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { academicYears, classLevels, schools, sections, terms } from "@/db/schema";
import { gradeFor, resolveSettings, type SectionSettings } from "@/lib/settings";

export type SubjectResult = {
  subjectId: string;
  subjectName: string;
  classScore: number | null;
  examScore: number | null;
  total: number;
  grade: string;
  remark: string;
  /** Position among everyone in the class level, across all streams. */
  levelPosition: number;
  streamPosition: number;
};

export type StudentResult = {
  enrolmentId: string;
  studentId: string;
  admissionNo: string;
  name: string;
  streamId: string;
  streamName: string;
  subjects: SubjectResult[];
  grandTotal: number;
  average: number;
  levelPosition: number;
  streamPosition: number;
  /** True when any subject is missing a class or exam score. */
  incomplete: boolean;
};

export type LevelResults = {
  levelName: string;
  settings: SectionSettings;
  levelSize: number;
  streamSizes: Record<string, number>;
  students: StudentResult[];
};

type Row = {
  enrolment_id: string;
  student_id: string;
  admission_no: string;
  surname: string;
  other_names: string;
  stream_id: string;
  stream_name: string;
  subject_id: string;
  subject_name: string;
  class_score: string | null;
  exam_score: string | null;
  total: string;
  missing: boolean;
  subject_level_pos: number;
  subject_stream_pos: number;
  grand_total: string;
  incomplete: boolean;
  level_pos: number;
  stream_pos: number;
};

/**
 * Results for every learner in a class level (e.g. all of JHS 2: 2A, 2B, 2C)
 * for one term, with positions both across the level and within each stream.
 * Ties share a position: 1st, 2nd, 2nd, 4th.
 */
export async function getLevelResults(levelId: string, termId: string): Promise<LevelResults> {
  const [ctx] = await db
    .select({
      levelName: classLevels.name,
      sectionId: sections.id,
      kind: sections.kind,
      sectionSettings: sections.settings,
      schoolSettings: schools.settings,
      academicYearId: terms.academicYearId,
      yearSchoolId: academicYears.schoolId,
      schoolId: schools.id,
    })
    .from(classLevels)
    .innerJoin(sections, eq(sections.id, classLevels.sectionId))
    .innerJoin(schools, eq(schools.id, sections.schoolId))
    .innerJoin(terms, eq(terms.id, termId))
    .innerJoin(academicYears, eq(academicYears.id, terms.academicYearId))
    .where(eq(classLevels.id, levelId));

  if (!ctx) throw new Error("Class level or term not found");
  if (ctx.yearSchoolId !== ctx.schoolId) throw new Error("Term belongs to a different school");

  const settings = resolveSettings(ctx.kind, ctx.schoolSettings, ctx.sectionSettings);
  const a = settings.assessment;

  const rows = (await db.execute(sql`
    with roster as (
      select e.id as enrolment_id, e.stream_id, st.name as stream_name,
             s.id as student_id, s.admission_no, s.surname, s.other_names
      from enrolments e
      join streams st on st.id = e.stream_id
      join students s on s.id = e.student_id
      where st.class_level_id = ${levelId}
        and e.academic_year_id = ${ctx.academicYearId}
    ),
    subj as (
      select id as subject_id, name as subject_name, sort_order
      from subjects
      where section_id = ${ctx.sectionId} and is_active
    ),
    cell as (
      select r.*, sb.subject_id, sb.subject_name, sb.sort_order,
             sc.class_score, sc.exam_score,
             round(
               coalesce(sc.class_score, 0) / ${a.classScoreMax}::numeric * ${a.classScoreWeight}::numeric
             + coalesce(sc.exam_score, 0) / ${a.examScoreMax}::numeric * ${a.examScoreWeight}::numeric
             , 2) as total,
             (sc.class_score is null or sc.exam_score is null) as missing
      from roster r
      cross join subj sb
      left join scores sc
        on sc.enrolment_id = r.enrolment_id
       and sc.subject_id = sb.subject_id
       and sc.term_id = ${termId}
    ),
    overall as (
      select enrolment_id,
             sum(total) as grand_total,
             bool_or(missing) as incomplete
      from cell
      group by enrolment_id
    ),
    overall_ranked as (
      select o.*, c.stream_id,
             rank() over (order by o.grand_total desc)::int as level_pos,
             rank() over (partition by c.stream_id order by o.grand_total desc)::int as stream_pos
      from overall o
      join (select distinct enrolment_id, stream_id from roster) c using (enrolment_id)
    )
    select c.enrolment_id, c.student_id, c.admission_no, c.surname, c.other_names,
           c.stream_id, c.stream_name, c.subject_id, c.subject_name,
           c.class_score, c.exam_score, c.total, c.missing,
           rank() over (partition by c.subject_id order by c.total desc)::int as subject_level_pos,
           rank() over (partition by c.subject_id, c.stream_id order by c.total desc)::int as subject_stream_pos,
           o.grand_total, o.incomplete, o.level_pos, o.stream_pos
    from cell c
    join overall_ranked o using (enrolment_id)
    order by o.level_pos, c.surname, c.other_names, c.sort_order, c.subject_name
  `)) as unknown as Row[];

  const byStudent = new Map<string, StudentResult>();
  for (const r of rows) {
    let s = byStudent.get(r.enrolment_id);
    if (!s) {
      s = {
        enrolmentId: r.enrolment_id,
        studentId: r.student_id,
        admissionNo: r.admission_no,
        name: `${r.surname.toUpperCase()} ${r.other_names}`,
        streamId: r.stream_id,
        streamName: r.stream_name,
        subjects: [],
        grandTotal: Number(r.grand_total),
        average: 0,
        levelPosition: r.level_pos,
        streamPosition: r.stream_pos,
        incomplete: r.incomplete,
      };
      byStudent.set(r.enrolment_id, s);
    }
    const total = Number(r.total);
    const band = gradeFor(total, settings.gradingScale);
    s.subjects.push({
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      classScore: r.class_score === null ? null : Number(r.class_score),
      examScore: r.exam_score === null ? null : Number(r.exam_score),
      total,
      grade: band.grade,
      remark: band.remark,
      levelPosition: r.subject_level_pos,
      streamPosition: r.subject_stream_pos,
    });
  }

  const students = [...byStudent.values()];
  const streamSizes: Record<string, number> = {};
  for (const s of students) {
    s.average = s.subjects.length ? Math.round((s.grandTotal / s.subjects.length) * 100) / 100 : 0;
    streamSizes[s.streamId] = (streamSizes[s.streamId] ?? 0) + 1;
  }

  return { levelName: ctx.levelName, settings, levelSize: students.length, streamSizes, students };
}

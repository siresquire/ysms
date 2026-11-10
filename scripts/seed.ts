/**
 * Fills the local database with a demo school: Primary (Basic 1–6) and JHS (1–3),
 * with two streams in Basic 6 and JHS 2, and Term 1 scores for JHS 2.
 *
 *   pnpm db:seed
 *
 * It wipes existing data first, so it refuses to run against anything but localhost.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../src/db/schema";

process.loadEnvFile();
const url = process.env.DATABASE_URL!;
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to seed a non-local database:", url.replace(/:[^:@]+@/, ":***@"));
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// Deterministic randomness so every seed produces the same data.
let seed = 20261110;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

const surnames = ["Mensah", "Owusu", "Boateng", "Asante", "Osei", "Agyeman", "Addo", "Appiah", "Amoah", "Danso", "Tetteh", "Quaye", "Annan", "Ofori", "Sarpong", "Nkrumah", "Abubakar", "Mohammed", "Issah", "Yeboah", "Kumi", "Fosu", "Badu", "Larbi", "Acheampong"];
const boys = ["Kwame", "Kofi", "Kwesi", "Yaw", "Kojo", "Kwabena", "Kwaku", "Fiifi", "Nana", "Ebo", "Ibrahim", "Yakubu", "Elikem", "Selorm", "Delali"];
const girls = ["Ama", "Akosua", "Abena", "Efua", "Adwoa", "Yaa", "Afia", "Esi", "Akua", "Maame", "Fatima", "Zainab", "Dzifa", "Enam", "Sena"];

async function main() {
  await db.execute(sql`truncate schools restart identity cascade`);

  const [school] = await db
    .insert(s.schools)
    .values({
      name: "Bright Future School",
      slug: "bright-future",
      motto: "Knowledge is Light",
      address: "P.O. Box 123, Kumasi",
      phone: "024 000 0000",
      settings: { theme: { primaryColor: "#0f766e" } },
    })
    .returning();

  const [primary, jhs] = await db
    .insert(s.sections)
    .values([
      { schoolId: school.id, kind: "primary", displayName: "Bright Future Primary School", headName: "Mrs. Comfort Adjei", settings: { report: { headTitle: "Headmistress" } } },
      { schoolId: school.id, kind: "jhs", displayName: "Bright Future Junior High School", headName: "Mr. Samuel Boakye", settings: { assessment: { classScoreWeight: 50, examScoreWeight: 50 } } },
    ])
    .returning();

  // Levels, created top-down so each can point at the next one for promotion.
  const levelDefs = [
    ...["Basic 1", "Basic 2", "Basic 3", "Basic 4", "Basic 5", "Basic 6"].map((name) => ({ name, sectionId: primary.id })),
    ...["JHS 1", "JHS 2", "JHS 3"].map((name) => ({ name, sectionId: jhs.id })),
  ];
  const levels: (typeof s.classLevels.$inferSelect)[] = [];
  let next: string | null = null;
  for (let i = levelDefs.length - 1; i >= 0; i--) {
    const [lvl]: (typeof s.classLevels.$inferSelect)[] = await db
      .insert(s.classLevels)
      .values({ ...levelDefs[i], sortOrder: i + 1, nextLevelId: next })
      .returning();
    levels.unshift(lvl);
    next = lvl.id;
  }

  const twoStreams = new Set(["Basic 6", "JHS 2"]);
  const streams = await db
    .insert(s.streams)
    .values(levels.flatMap((l) => (twoStreams.has(l.name) ? ["A", "B"] : ["A"]).map((name) => ({ classLevelId: l.id, name }))))
    .returning();

  const primarySubjects = ["English Language", "Mathematics", "Science", "Our World Our People", "History", "Religious and Moral Education", "Computing", "Creative Arts", "Ghanaian Language", "French"];
  const jhsSubjects = ["English Language", "Mathematics", "Integrated Science", "Social Studies", "Religious and Moral Education", "Computing", "Career Technology", "Creative Arts and Design", "Ghanaian Language", "French"];
  await db.insert(s.subjects).values(primarySubjects.map((name, i) => ({ sectionId: primary.id, name, sortOrder: i })));
  const jhsSubjectRows = await db
    .insert(s.subjects)
    .values(jhsSubjects.map((name, i) => ({ sectionId: jhs.id, name, sortOrder: i })))
    .returning();

  const [year] = await db.insert(s.academicYears).values({ schoolId: school.id, name: "2026/2027", isCurrent: true }).returning();
  const [term1] = await db
    .insert(s.terms)
    .values([
      { academicYearId: year.id, number: 1, isCurrent: true, daysInSession: 62, vacationDate: "2026-12-18", reopeningDate: "2027-01-12" },
      { academicYearId: year.id, number: 2 },
      { academicYearId: year.id, number: 3 },
    ])
    .returning();

  // Students: 12 per stream (20 per stream in JHS 2 so cross-stream ranking has something to show).
  let admission = 1;
  const enrolmentsByStream = new Map<string, string[]>();
  for (const stream of streams) {
    const level = levels.find((l) => l.id === stream.classLevelId)!;
    const count = level.name === "JHS 2" ? 20 : 12;
    const people = Array.from({ length: count }, () => {
      const g = rand() < 0.5 ? "male" : "female";
      return {
        schoolId: school.id,
        admissionNo: `BFS/${String(admission++).padStart(4, "0")}`,
        surname: pick(surnames),
        otherNames: pick(g === "male" ? boys : girls),
        gender: g as "male" | "female",
      };
    });
    const studentRows = await db.insert(s.students).values(people).returning({ id: s.students.id });
    const enrolRows = await db
      .insert(s.enrolments)
      .values(studentRows.map((st) => ({ studentId: st.id, streamId: stream.id, academicYearId: year.id })))
      .returning({ id: s.enrolments.id });
    enrolmentsByStream.set(stream.id, enrolRows.map((e) => e.id));
  }

  // Term 1 scores for JHS 2, both streams.
  const jhs2 = levels.find((l) => l.name === "JHS 2")!;
  const jhs2Streams = streams.filter((st) => st.classLevelId === jhs2.id);
  const scoreRows: (typeof s.scores.$inferInsert)[] = [];
  for (const st of jhs2Streams) {
    for (const enrolmentId of enrolmentsByStream.get(st.id)!) {
      const ability = between(35, 90);
      for (const subj of jhsSubjectRows) {
        scoreRows.push({
          enrolmentId,
          subjectId: subj.id,
          termId: term1.id,
          classScore: Math.min(100, Math.max(0, ability + between(-12, 12))),
          examScore: Math.min(100, Math.max(0, ability + between(-15, 15))),
        });
      }
    }
  }
  // Deliberate tie: the first learner in 2B gets exactly the same marks as the first in 2A.
  const [firstA, firstB] = jhs2Streams.map((st) => enrolmentsByStream.get(st.id)![0]);
  for (const row of scoreRows.filter((r) => r.enrolmentId === firstB)) {
    const twin = scoreRows.find((r) => r.enrolmentId === firstA && r.subjectId === row.subjectId)!;
    row.classScore = twin.classScore;
    row.examScore = twin.examScore;
  }
  // One missing exam mark, to show the "incomplete" flag.
  scoreRows[scoreRows.length - 1].examScore = null;
  await db.insert(s.scores).values(scoreRows);

  const studentCount = [...enrolmentsByStream.values()].reduce((n, xs) => n + xs.length, 0);
  console.log(`Seeded "${school.name}": ${levels.length} levels, ${streams.length} streams, ${studentCount} students, ${scoreRows.length} JHS 2 scores.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());

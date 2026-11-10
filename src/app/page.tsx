import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { academicYears, classLevels, schools, sections, terms } from "@/db/schema";
import { ordinal } from "@/lib/settings";
import { getLevelResults } from "@/server/results";

// Temporary developer page: proves cross-stream ranking against the seeded demo data.
// It will be replaced by the staff dashboard.

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading results…</p>}>
        <Results />
      </Suspense>
    </main>
  );
}

async function Results() {
  await connection();

  const [ctx] = await db
    .select({ school: schools.name, levelId: classLevels.id, termId: terms.id, termNo: terms.number, year: academicYears.name })
    .from(classLevels)
    .innerJoin(sections, eq(sections.id, classLevels.sectionId))
    .innerJoin(schools, eq(schools.id, sections.schoolId))
    .innerJoin(academicYears, and(eq(academicYears.schoolId, schools.id), eq(academicYears.isCurrent, true)))
    .innerJoin(terms, and(eq(terms.academicYearId, academicYears.id), eq(terms.isCurrent, true)))
    .where(eq(classLevels.name, "JHS 2"))
    .limit(1);

  if (!ctx) return <p>No data yet. Run <code>pnpm db:seed</code>.</p>;

  const r = await getLevelResults(ctx.levelId, ctx.termId);
  const streamName = Object.fromEntries(r.students.map((s) => [s.streamId, s.streamName]));
  const { classScoreWeight, examScoreWeight } = r.settings.assessment;

  return (
    <>
      <header className="mb-6">
        <p className="text-sm text-neutral-500">{ctx.school}</p>
        <h1 className="text-2xl font-semibold">
          {r.levelName} results — Term {ctx.termNo}, {ctx.year}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          {r.levelSize} learners across {Object.keys(r.streamSizes).length} streams (
          {Object.entries(r.streamSizes)
            .map(([id, n]) => `${r.levelName}${streamName[id]}: ${n}`)
            .join(", ")}
          ). Weighting: class score {classScoreWeight}% / exam {examScoreWeight}%.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Position (class)</th>
              <th className="px-3 py-2 font-medium">Position (stream)</th>
              <th className="px-3 py-2 font-medium">Learner</th>
              <th className="px-3 py-2 font-medium">Stream</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Average</th>
              <th className="px-3 py-2 font-medium">English (grade, class pos.)</th>
            </tr>
          </thead>
          <tbody>
            {r.students.map((s) => {
              const eng = s.subjects.find((x) => x.subjectName === "English Language");
              return (
                <tr key={s.enrolmentId} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-medium tabular-nums">{ordinal(s.levelPosition)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {ordinal(s.streamPosition)} of {r.streamSizes[s.streamId]}
                  </td>
                  <td className="px-3 py-2">
                    {s.name}
                    {s.incomplete && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        missing scores
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{s.streamName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.grandTotal.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.average.toFixed(2)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {eng && `${eng.total} · ${eng.grade} (${eng.remark}) · ${ordinal(eng.levelPosition)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

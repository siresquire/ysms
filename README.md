# YSMS — School report & promotion system

For Ghanaian basic schools (Primary and JHS). Teachers record class and exam scores,
the system ranks learners (across multiple streams where they exist) and produces
printable terminal reports. Learners are promoted each year without re-entering data.

**Stack:** Next.js 16 (App Router) · PostgreSQL · Drizzle ORM · Tailwind CSS · Zod

## Local setup

Requires Node 24+, pnpm and Docker Desktop.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # start Postgres in Docker (port 5433)
pnpm db:migrate   # create tables
pnpm db:seed      # demo school: Primary + JHS, two streams in JHS 2
pnpm dev          # http://localhost:3000
```

Other scripts: `pnpm db:generate` (new migration after editing the schema),
`pnpm db:studio` (browse the database), `pnpm typecheck`, `pnpm lint`.

## How the data fits together

```
School                 name, crest, motto, school-wide setting overrides
 └─ Section            Primary | JHS | KG — own head, grading scale, weights, report options
     ├─ Subjects
     └─ Class level    Basic 4, JHS 2 … (nextLevel → promotion path; null = graduates)
         └─ Stream     A, B …
Academic year → Terms
Student → Enrolment (one per academic year, in a stream) → Scores (per subject per term)
                                                         → Term report (attendance, remarks)
```

- **Settings** resolve as built-in defaults for the section kind → school overrides →
  section overrides (`src/lib/settings.ts`). Schools store only what they change.
- **Positions** are computed in SQL with `RANK()` per class level (all streams) and per
  stream, overall and per subject (`src/server/results.ts`). Ties share a position.
- **Raw marks** are stored as typed; weighting (e.g. 30/70 or 50/50) is applied at report
  time, so changing the weighting never requires re-entering scores.

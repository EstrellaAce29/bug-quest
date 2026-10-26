# Bug Quest

A green DAG can hide missing data. Bug Quest turns a vague testing instruction into precise browser checks, runs them with Kane CLI, and uses OpenAI to propose a minimal code fix. It keeps the fix only after Kane verifies the same check and the original instruction.

[Demo video](https://d3nl4wy7jovhq0.cloudfront.net/public/p66/6849dfc359e35065374c6f0dbf23fcbc6dbe3d382721743fd4be95119d896338.mp4)

Fresh clone starts broken on purpose: run Live mode on /quest to watch Bug Quest catch, auto-fix, and verify the row mismatch.

## How to run

Requires Node.js 20.9+ and npm.

```sh
git clone https://github.com/EstrellaAce29/bug-quest.git
cd bug-quest
npm install
npm run dev
```

Open [Bug Quest](http://localhost:3000/quest) or the [Pipeline Monitor](http://localhost:3000/pipelines).

**Recorded mode** is on by default and replays real Kane results without API credentials.

For **Live mode**, install Chrome and authenticate Kane CLI:

```sh
npm install -g @testmuai/kane-cli@rc
kane-cli login --oauth
cp .env.example .env.local
```

Set `OPENAI_API_KEY` in `.env.local`, then restart the dev server. Optionally set `OPENAI_MODEL`; its default is `gpt-6-luna`. Keep the key server-side: `.env.local` is ignored by Git. Live mode uses OpenAI API usage and Kane credits.

## How it works

**Instruction → precise checks → Kane → auto-fix → verify**

1. Name your agent and enter an instruction on `/quest`.
2. OpenAI expands it into two or three checks with exact expected values. The sensor has zero rows; extract and load should each have 1,000.
3. Kane runs the original instruction, then the precise objectives sequentially. Progress, results and Test Manager links stream into the page.
4. After a precise failure, Bug Quest saves a Git checkpoint and asks OpenAI for a minimal edit to `lib/pipeline.ts` only. It never edits `config/bugs.json`.
5. The candidate must pass TypeScript, regression tests, the same precise Kane check, and the original basic check before it is committed as `auto-fix: ...`. Failed attempts restore the checkpoint; after three failures, the quest escalates to a human with evidence links.

Confirmed silent bugs earn **20 points**; a verified fix earns **15**. Automation errors do not earn discovery points.

## Real Airflow target

Live mode also offers **Real Airflow**: Kane checks the real tennis DAG status while SQL compares extracted matches with the Postgres warehouse. The fixer changes only the tennis DAG, triggers a fresh run through Airflow REST, and requires Kane + SQL and the basic check to pass before committing. Credentials come from `.env.local`.

See [real-pipeline/README.md](real-pipeline/README.md) for Docker setup, the archived Jeff Sackmann CSV (CC BY-NC-SA), login, trigger and checker commands. The verified real fix takes counts from **2,986 extracted / 1,493 loaded** to **2,986 / 2,986**; its evidence is saved in [verification.json](real-pipeline/verification.json). The real DAG is now fixed; the simulated monitor still starts with its original defect.

## Demo pipeline

`/pipelines` simulates one DAG, `enrollment_pipeline`, with six tasks: wait_for_source, extract, validate, transform, load and notify. **Trigger run** simulates execution. This is JSON-backed demo data, not a real Airflow or warehouse integration.

- `data/pipeline-runs.json`: task definitions, source count and durations.
- `/api/pipeline-runs`: simulated run data; the default start time is ten minutes before the request.
- `config/bugs.json`: five fault switches. `rowMismatchBug` starts **true**, producing 1,000 extracted rows but only 500 loaded rows. Other switches simulate false success, a stuck sensor, slow responses and silent errors.

## Verification and history

```sh
npm test
npm run typecheck
npm run build
```

The row-conservation regression intentionally fails on the fresh-clone defect and passes after the repair. Recorded mode retains historical evidence; its totals are a snapshot, not live counters. See [VERIFICATION.md](VERIFICATION.md) for real results and limitations, including an automation timeout in the auto-fix trial.

The submitted version is tagged **`hackday-submission`** at `4e19d25bc236edceab558567186f776f10cdcbe7`. The real auto-fix commit **`e8560fe`** remains in history; the faulty line was restored afterward for the fresh-clone demo.

## License

[MIT](LICENSE) © 2026 Prashansa Chaudhary.

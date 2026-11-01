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

## Real Airflow mode

The real DAG, `tennis_tournament_pipeline`, reads **Jeff Sackmann's ATP 2023 match data**, licensed **CC BY-NC-SA 4.0**, from `data/raw/atp_matches_2023.csv`. The CSV is ignored by Git; get the exact Internet Archive snapshot and checksum from [DATA_SOURCE.md](real-pipeline/DATA_SOURCE.md). The repository MIT license does not cover this dataset.

Requires Docker with Compose, Node.js, psql, Chrome and an authenticated Kane CLI. Set these keys in the ignored `.env.local` file (names only):

- `OPENAI_API_KEY`
- `AIRFLOW_URL`, `AIRFLOW_PORT`, `AIRFLOW_USERNAME`, `AIRFLOW_PASSWORD`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

Start Airflow from the repository root:

```sh
cd real-pipeline
cp .env.example .env
docker compose --env-file ../.env.local up --build -d
```

Open [Airflow at localhost:8081](http://localhost:8081) and sign in using your local credentials. Postgres is exposed on localhost port 5433 (container port 5432). Unpause and trigger `tennis_tournament_pipeline`, then wait for its six tasks to succeed. Run `node scripts/check_real_pipeline.mjs` from the repository root to inspect the warehouse.

Restart the Next.js dev server after configuring `.env.local`. On `/quest`, enable **Live mode**, select **Real Airflow**, name your agent, enter an instruction such as "Check the tennis pipeline ran", and click **Run Quest**. Kane checks the real run status; SQL checks row conservation. The fixer checkpoints Git, edits only the DAG, triggers a new run through Airflow REST, and requires Kane + SQL and the basic check to pass before committing. Failed attempts roll back; after three failures, it escalates.

**Fresh clones start broken on purpose:** the real load task carries the marked half-batch defect. Verified result: **2,986 extracted vs 1,493 loaded → auto-fix → 2,986 extracted = 2,986 loaded**, with all six tasks successful. See [verification.json](real-pipeline/verification.json) for the real Kane evidence. The successful fix commit `df83629` remains in history; a later commit restores the planted bug for the next demo. A fresh end-to-end rerun passed on attempt 1; see [its Kane evidence and code diff](real-pipeline/verification-2026-10-27.json).

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

The intentional-bug test verifies that the simulated demo remains green while loading only half its rows; separate tests cover healthy row conservation and the guarded repair flow. Simulated repair validation requires the full extracted row count before accepting a fix. Recorded mode retains historical evidence; its totals are a snapshot, not live counters. See [VERIFICATION.md](VERIFICATION.md) for real results and limitations, including an automation timeout in the auto-fix trial.

The submitted version is tagged **`hackday-submission`** at `4e19d25bc236edceab558567186f776f10cdcbe7`. The real auto-fix commit **`e8560fe`** remains in history; the faulty line was restored afterward for the fresh-clone demo.

## License

[MIT](LICENSE) © 2026 Prashansa Chaudhary.

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

## Bug Quest Arena

Start with `npm run dev`, then open **http://127.0.0.1:3000/arena** on a shared browser screen. Choose 2–4 player slots and click **Create lobby**. The screen displays a six-character join code and the controller command. Each player opens a separate terminal in this project:

```sh
npm run arena:player -- --code ABC234 --name "Your agent"
```

Replace `ABC234` with the browser's code. Without flags, the controller prompts for the code and agent name. It prompts **Your strategy?** for each of three rounds, sends the coaching to the server, then waits for the browser host. Names are unique and the roster locks when round 1 starts. The host can start once at least two players are joined, all joined players have submitted a strategy, and their controllers are connected. Strategies can be edited for the next round in the terminal; they are locked during play.

The browser is the shared game screen. Every player has an original cartoon SVG robot bug-hunter on the arena stage. Live score events show green **+20** catch and **+15** verified-fix pop-ups, red **−5** false-alarm pop-ups, happy bounces, and miss shakes. Leaderboard positions slide as provisional scores change; confirmed totals are saved only after a successful reset. Reduced-motion preferences disable movement and preserve readable score messages. Each player also receives their own plans, findings, live logs, awards, round score, fault reveal, and game result in their terminal.

Repeat the controller command to reconnect as the same player: its random controller credential is stored in ignored `.arena/` with mode `0600`. It is not an Airflow/model credential. `--session path` selects another local session file; `--url http://localhost:3000` selects the loopback alias. Ctrl+C disconnects that controller and does not stop an active game. Controllers keep their presence alive while waiting at the coaching prompt. A controller that goes offline prevents the host from starting the next round until it reconnects. Rooms, history, and host credentials live in the server process/browser session; after restarting the server, create a new lobby and use its new code. Codes invite players and open a spectator screen (`/arena?code=ABC234`); only the separate browser host credential can start, stop, or recover rounds, and players can submit only their own strategy.

Each round secretly samples one or two faults in the **real** `tennis_tournament_pipeline`: half-batch loading and an Arena-only standings undercount. Every player gets a fresh run with identical fault settings. Coaching expands into 1–3 checks through the Real Airflow expansion module: row conservation, standings totals, duplicate match payloads, or task status. Narrow strategies stay narrow. Data checks use SQL; task checks and verified repairs use Kane plus REST. The three-round reveal lists planted faults, who caught them, and each player's points. Live play runs on the server using Next.js `after`; refreshing or closing the shared screen does not cancel it. Polling reconnects viewers and controllers to server-owned state and ordered events without resending strategies or multiplying awards.

Scoring remains **+20 per distinct planted fault caught**, **+15 per independently verified repair**, **−5 per distinct false claim**. An ordinary passing check is not a false alarm. Repeated checks do not multiply points; infrastructure errors earn no points. If a round fails or the host uses **Stop & reset**, all provisional scores for that round are void and controllers are asked for fresh coaching before retrying. All players must finish and cleanup must succeed before round scores are confirmed. Tied top scores share the win.

Arena repairs are **isolated runtime remediations**: rerun with caught faults disabled, require the targeted SQL invariants and Kane/REST status verification, then award repair points. They do not invoke `/quest`'s source-editing, Git-committing auto-fixer. The next player receives the original sampled faults. Regular runs without Arena configuration retain the original planted half-load and its existing one-line `/quest` repair target. `/quest` and `/pipelines` retain their UI and default behavior.

Both Arena faults are **off after every round**, verified by a clean DAG run and warehouse counts. Errors and host cancellation run cleanup with an independent timeout. If Airflow is unavailable, cleanup cannot be guaranteed: ignored `.arena-recovery.json` remains, the shared quest lock stays held, and new rounds are blocked until the host's **Recover reset** succeeds. After a server restart, recover an interrupted round before using `/quest`. Do not manually trigger other tennis runs during play: the warehouse stores only the latest load. Fault settings are hidden in the Arena UI, not from the local Airflow administration API.

Arena uses the same Airflow, Postgres, Chrome, and Kane prerequisites as Real Airflow mode. Configure its model in ignored `.env.local`, then restart Next.js:

```dotenv
ARENA_MODEL_PROVIDER=openai
# Optional: falls back to OPENAI_MODEL; existing OPENAI_API_KEY applies.
ARENA_MODEL=
```

The provider adapter also supports a local Ollama server for Llama:

```dotenv
ARENA_MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
# Optional: overrides OLLAMA_MODEL.
ARENA_MODEL=
```

Install/pull the selected Ollama model separately. Both adapters request JSON-schema output and validate the plan before execution. Invalid model output stops the round and resets faults. Provider configuration and keys stay server-side. `/quest` continues to use its existing OpenAI configuration.

The original Arena fault-matrix and live-round evidence is in [arena-verification-2026-11-01.json](real-pipeline/arena-verification-2026-11-01.json). The Ollama transport is covered by mocked adapter tests; a local Llama model was not run.

The game UI and terminal controllers were verified with two real terminal players across all three real Airflow rounds, including reconnecting during coaching. Final scores were Moss **135** and Coral **100**; all resets finished at **2,986 extracted = 2,986 loaded = 2,986 wins**. Typecheck and all **45 tests** pass. See [arena-terminal-verification-2026-11-01.json](real-pipeline/arena-terminal-verification-2026-11-01.json) for round scores, live awards, run IDs and the Kane browser reports.

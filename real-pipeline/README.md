# Real tennis pipeline

A separate Apache Airflow project; the Bug Quest simulation and replay are unchanged.
Uses the official [Airflow 3.3.2 Docker Compose setup](https://airflow.apache.org/docs/apache-airflow/3.3.2/docker-compose.yaml), retaining its Apache license header. Local changes build a psycopg-enabled image, disable example DAGs, mount the CSV and staging folder, and publish Postgres on loopback port 5433 and the UI on loopback port 8081.

## Data attribution

ATP match data compiled by **Jeff Sackmann**, licensed **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**. The dataset is separate from this repository's MIT-licensed code. See [DATA_SOURCE.md](DATA_SOURCE.md) for the Internet Archive source, snapshot date and checksum. Place the approved CSV at `data/raw/atp_matches_2023.csv` from the repository root. Raw data is ignored by Git and mounted read-only.

## Start

Requires Docker with Compose, Node.js, and psql. No host Python packages are needed. The Docker image installs psycopg internally.

From the repository root:

```sh
cd real-pipeline
cp .env.example .env
# First fill AIRFLOW_* and PG* in ../.env.local (see ../.env.example).
docker compose --env-file ../.env.local build
docker compose --env-file ../.env.local up airflow-init
docker compose --env-file ../.env.local up -d
```

Airflow UI: **http://localhost:8081** (AIRFLOW_URL / AIRFLOW_PORT). Log in using AIRFLOW_USERNAME and AIRFLOW_PASSWORD from `.env.local`. No Airflow or database password is stored in code. Postgres listens at `127.0.0.1:5433` by default; database/user/password come from PGDATABASE, PGUSER and PGPASSWORD in `.env.local`. The DAG writes only to the separate `warehouse` schema.

## Trigger

In the UI, unpause `tennis_tournament_pipeline` and click Trigger DAG, or run from `real-pipeline/`:

```sh
docker compose --env-file ../.env.local exec airflow-scheduler airflow dags unpause tennis_tournament_pipeline
docker compose --env-file ../.env.local exec airflow-scheduler airflow dags trigger tennis_tournament_pipeline
```

Tasks: extract → validate → transform → load → standings → report. Extract records the full CSV count for each run in `warehouse.run_metadata`. Validation checks required columns and logs null counts. Transform cleans column names and parses tournament dates. Load replaces `warehouse.matches`, retaining original row fields in a JSONB payload. Standings builds `warehouse.player_wins`. Report logs all final counts. Run metadata retains history; matches and standings represent the latest load.

Baseline commit `3486f46` plants one `# PLANTED BUG`: load takes only the first half of the matches while every task succeeds. The end-to-end Live test repaired that line in commit `df8362979fd121e8b878797a172ae3b08be9b636`; the current DAG loads the full batch. The comment marks the original bug location.

## Check

From the repository root after the DAG finishes:

```sh
node scripts/check_real_pipeline.mjs
```

The script queries extracted rows versus loaded matches, and total player wins versus loaded matches. At the faulty baseline: loaded matches = floor(extracted / 2), total wins = loaded matches. After the verified fix: extracted rows = loaded matches = total wins = 2,986. Exit code 2 means an invariant failed; 0 means both pass; 1 means setup/query failure. Standard PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE overrides are supported.

Stop with `docker compose --env-file ../.env.local stop` from `real-pipeline/`; this preserves the database volume.

## Verification status

Verified with Airflow 3.3.2: baseline run `baseline_1793002861764` completed with all six tasks successful. The checker reported 2,986 extracted rows, 1,493 loaded matches and 1,493 total wins, exiting 2 to expose the planted silent loss. The full Real Airflow quest caught that loss, restored the checkpoint after attempt 1 failed its basic UI recheck, and succeeded on attempt 2. Fixed run `bugquest_3e1bd655-aa36-4570-a1d8-24e78e15ee57` has all six tasks successful and 2,986 extracted/loaded/wins. Kane plus SQL and the basic recheck passed before auto-fix commit `df8362979fd121e8b878797a172ae3b08be9b636`. Score: 1 silent bug (+20), 1 verified fix (+15), 35 points. The quest used 6 Kane runs and consumed 193.0611675 Kane credits. A separate sign-in navigation regression passed (code 100; 12 steps; 82.2 seconds; 27.456065 credits) after making the return to the pinned run URL explicit. Full objectives, attempt diffs, summaries and Test Manager links are in [verification.json](verification.json).

## Bug Quest Live mode

Restart the Next.js server after configuring `.env.local`. On `/quest`, enable Live mode and select **Real Airflow**. Start with a completed tennis DAG run. The original instruction runs in Kane; OpenAI expands precise checks, using SQL for row conservation and Kane plus a REST status cross-check for the six tasks. Exact expected counts come from that run's extracted metadata, not a hardcoded count.

A failed precise check starts up to three fix attempts. Only `real-pipeline/dags/tennis_tournament_pipeline.py` may change, and only the accidental half-batch assignment can be repaired. Each attempt uses a Git checkpoint, validates Python syntax, waits for Airflow to reparse the matching source, triggers a fresh run through REST, and verifies both Kane and SQL before committing. Existing changes to the DAG must be committed before using auto-fix. Failures restore the source; an active attempt is marked failed through REST during rollback; source restoration still runs if Airflow is unreachable, and the quest escalates if shutdown cannot be confirmed. Warehouse tables still reflect the last executed attempt, so trigger another run after escalation if you want a fresh snapshot of the restored code.

Airflow passwords go from `.env.local` to Kane as masked secret variables in a private temporary file removed after the browser run. Database passwords are passed only to Postgres clients and the relevant local Airflow containers. The OpenAI key is not passed to Kane, and `.env.local` is never mounted in Airflow containers.

Keep using **Simulated monitor** to exercise the original `/pipelines` target. Recorded replay remains unchanged.

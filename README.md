# Bug Quest

A local Next.js Pipeline Monitor for one simulated DAG: `enrollment_pipeline`.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000/pipelines. The root redirects there.

`Trigger run` starts a simulated run, which progresses through the six tasks over roughly six seconds. Upcoming tasks display `skipped` until scheduled; this is a compact simulation, not an Airflow scheduler. Duration values come from the fixture and represent simulated task times.

## Data and API

- `data/pipeline-runs.json`: source run metadata, source row count, task definitions and durations. The default run start time is calculated on each request as ten minutes before now; the fixture's `startedAt` is not used for that timestamp.
- `GET /api/pipeline-runs`: latest scheduled fixture run.
- `POST /api/pipeline-runs`: start a new simulated run.
- `GET /api/pipeline-runs?startedAt=<ISO timestamp>`: progress a manual run.

Runs are deterministic simulations derived from the fixture and a timestamp. They are not persisted across sessions. There is no real Airflow, database, OpenAI agent or Kane runtime integrated into this monitor.

## Bug switches

Edit `config/bugs.json`, set a switch to `true`, and reload `/pipelines`. Currently `rowMismatchBug` is **on** and all other switches are off. The row-mismatch code has been fixed, so that switch no longer truncates the batch. The API reads the file on every request; the page reads it on reload. Turn switches on individually for the clearest demo.

| Switch | Faulty behavior | Logic to repair |
|---|---|---|
| `falseSuccessBug` | A warehouse write fails, but successful notification masks the failure. | `lib/pipeline.ts`: overall status uses the final task instead of checking every task. |
| `rowMismatchBug` | Previously extracted 1,000 rows but loaded 500. Now fixed even while the switch is on. | `lib/pipeline.ts`: load receives the full source batch. |
| `stuckDeferredBug` | Sensor is deferred for seven hours, but the DAG reports success. | `lib/pipeline.ts`: deferred tasks are omitted from the completion gate and the sensor deadline is ignored. |
| `slowApiBug` | API waits eight seconds; the UI spins past five seconds without a timeout message. | API route: upstream retry delay; `pipeline-monitor.tsx`: the request deadline is incorrectly omitted. |
| `silentErrorBug` | API exception returns HTTP 500, but the UI shows empty tasks without an error banner. | API route: simulated source exception; `pipeline-monitor.tsx`: catch branch discards the error. |

The switches select real execution paths: aggregation, batch truncation, sensor scheduling, request deadlines and exception handling. You can fix the marked logic while keeping a switch enabled and rerun verification.

With the switches off, failed HTTP responses show an error banner with Retry, and a request that exceeds five seconds is aborted with a timeout message. No bug controls or implementation details are exposed in the monitor UI.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

The tests cover dynamic default timestamps, healthy row conservation, manual progression, false success, deferred sensor behavior, and the row-mismatch repair with its switch enabled.

## Quest replay

Open http://localhost:3000/quest. Name an agent, enter an instruction, and press **Run Quest** to replay the recorded investigation with activity messages spaced 1.5 seconds apart. This page does not call OpenAI, execute Kane, or edit pipeline code at runtime. `data/quest-runs.json` contains the actual recorded results and Test Manager links.

The scoreboard awards 20 points when the replay reaches the discovered silent bug, and adds 15 for the passing corrected after-fix run, for 35 points total. Exact Test A after the load repair passed extract/load equality but failed its broader every-task assertion because the sensor legitimately reports zero rows (result code 440). That historical failure remains in the session sources. The After fix row now uses the corrected check that excludes the sensor and verifies 1,000 rows for extract, validate, transform, load, and notify; it passed with result code 100.

The compact **Checks used** section lists the pipeline checks and the session totals from `data/quest-session.json`. That snapshot is imported from completed `run_end` events for this conversation's seven runs, including the original healthy monitor check, quest UI check, and corrected after-fix check. It records 7 runs, 37 assertion records, 1 distinct confirmed application bug, 1 fully verified fix, and 154.81265 credits. The assertion count includes repeated checks and excludes value extractions; it is not a count of unique designed scenarios. The original sensor assertion also appears in the explanatory text because its child-run failure is described in the summary rather than saved as a parent assertion record.

`node scripts/import-quest-session.mjs` refreshes the snapshot on this machine from the explicitly listed session IDs. The importer copies only selected result fields; it does not copy credentials or raw execution context. Expanding the source list on the page shows each run's recorded assertion conditions and Test Manager report.

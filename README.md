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

Edit `config/bugs.json`, set a switch to `true`, and reload `/pipelines`. All switches ship **off**. The API reads the file on every request; the page reads it on reload. Turn switches on individually for the clearest demo.

| Switch | Faulty behavior | Logic to repair |
|---|---|---|
| `falseSuccessBug` | A warehouse write fails, but successful notification masks the failure. | `lib/pipeline.ts`: overall status uses the final task instead of checking every task. |
| `rowMismatchBug` | Extract processes 1,000 rows while load writes only 500. | `lib/pipeline.ts`: the load batch is incorrectly sliced to half its length. |
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

The tests cover healthy row conservation, manual progression, and the three data-fault behaviors. They intentionally confirm that each enabled fault can reproduce its advertised failure.

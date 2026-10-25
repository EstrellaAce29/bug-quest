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

Edit `config/bugs.json`, set a switch to `true`, and reload `/pipelines`. Currently `rowMismatchBug` is **on** and all other switches are off. The live auto-fixer repaired the truncation in commit `e8560fe`, so extract and load now both show 1,000 rows while the switch stays true. The original faulty code is retained in history (`4b8fb76`), and historical evidence remains in the recorded replay. The API reads the file on every request; the page reads it on reload.

| Switch | Faulty behavior | Logic to repair |
|---|---|---|
| `falseSuccessBug` | A warehouse write fails, but successful notification masks the failure. | `lib/pipeline.ts`: overall status uses the final task instead of checking every task. |
| `rowMismatchBug` | Originally loaded 500 of 1,000 rows; repaired by the live auto-fixer while enabled. | `lib/pipeline.ts`: the entire source batch now reaches load. |
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

The tests cover dynamic timestamps, healthy row conservation, manual progression, the planted data faults, live objective validation, result-link filtering, redaction, scoring, sequential execution, cancellation, and stopping after infrastructure failures.

## Quest replay

Open http://localhost:3000/quest. With **Live mode off** (the default), name an agent, enter an instruction, and press **Run Quest** to replay the recorded investigation with activity messages spaced 1.5 seconds apart. This recorded view does not call OpenAI, execute Kane, or edit code. `data/quest-runs.json` contains the actual recorded results and Test Manager links. Its component is unchanged from fallback checkpoint `69510b8`.

The scoreboard awards 20 points when the replay reaches the discovered silent bug, and adds 15 for the passing corrected after-fix run, for 35 points total. Exact Test A after the load repair passed extract/load equality but failed its broader every-task assertion because the sensor legitimately reports zero rows (result code 440). That historical failure remains in the session sources. The After fix row now uses the corrected check that excludes the sensor and verifies 1,000 rows for extract, validate, transform, load, and notify; it passed with result code 100.

The compact **Checks used** section lists the pipeline checks and the session totals from `data/quest-session.json`. That snapshot is imported from completed `run_end` events for this conversation's seven runs, including the original healthy monitor check, quest UI check, and corrected after-fix check. It records 7 runs, 37 assertion records, 1 distinct confirmed application bug, 1 fully verified fix, and 154.81265 credits. The assertion count includes repeated checks and excludes value extractions; it is not a count of unique designed scenarios. The original sensor assertion also appears in the explanatory text because its child-run failure is described in the summary rather than saved as a parent assertion record.

`node scripts/import-quest-session.mjs` refreshes the snapshot on this machine from the explicitly listed session IDs. The importer copies only selected result fields; it does not copy credentials or raw execution context. Expanding the source list on the page shows each run's recorded assertion conditions and Test Manager report.

## Live mode

1. Create `.env.local` in this folder and set `OPENAI_API_KEY` there. `.env.local` is ignored by Git; never use a `NEXT_PUBLIC_` variable for the key. `.env.example` documents the variable names without a real key.
2. Optionally set `OPENAI_MODEL` in that same file. The default is `gpt-6-luna`, using the OpenAI Responses API with structured output. Restart `npm run dev` if an environment change is not picked up.
3. Open `/quest` and turn **Live mode on**. Name the agent, enter an instruction, then press **Run Quest**. This uses OpenAI API usage and Kane credits.

`POST /api/quest` accepts the agent name and instruction. The server expands the instruction into two or three objectives using expected values from the pipeline fixture. The prompt explains the sensor's zero rows, load/extract conservation, and consistency between task and DAG statuses. It does not use the faulty API output as the expected answer.

The server then runs the original instruction verbatim, followed by each expanded objective sequentially, using an argument array with no shell:

```text
kane-cli run "<objective>" --url http://localhost:3000/pipelines --agent --max-steps 15
```

Progress streams into an agent-prefixed terminal log. Live results show the objective, status, result code, summary and Test Manager link. Missing terminal results are errors, not passes. A passing basic check plus a confirmed precise application failure earns 20 points per distinct invariant (row conservation or task status); repeated discoveries of the same invariant count once. Browser/auth/timeout failures earn no discovery points. A code repair committed after both precise and basic rechecks pass earns another 15 points.

The route is local-only, allows one quest at a time, stops each Kane process after five minutes, and cancels work when stopped or disconnected. The initial checks use up to four Kane runs; repairs can add up to two rechecks per attempt, with at most three attempts per failed precise check. Results stay in the current browser view and Kane's own session history; they do not replace the recorded replay or its historical totals.

### Auto-fix transaction

After a precise failure, the server creates a temporary Git checkpoint commit, retained under `refs/bug-quest/checkpoints/`, without moving HEAD or changing the real Git index. It refuses to auto-commit pre-existing edits to `lib/pipeline.ts`; unrelated working files remain untouched.

OpenAI receives only the failing objective, Kane's completion summary, the contents of `lib/pipeline.ts`, and retry feedback. It proposes up to three exact replacements in that file. Edits are bounded, parsed as TypeScript, and checked to prevent new imports/system calls or assignments to bug switches. The candidate must pass TypeScript and regression tests before Kane runs.

The server reruns the exact same precise objective and, if it passes, the original basic instruction. Only after both pass does it commit **only `lib/pipeline.ts`**, with an `auto-fix: <description>` message. It never edits `config/bugs.json`, and verifies that the config's bytes have not changed before keeping the fix.

An unsuccessful attempt restores the original source before the next proposal. Three failed attempts restore the checkpoint source and show **Escalated to human** with each available evidence link. Cancellation also restores an uncommitted candidate. Concurrent manual file/HEAD changes stop the transaction rather than overwriting another person's work. Live results retain the original failed result and add the real code diff, checkpoint, fix commit, precise recheck and basic recheck links.

The key is read only by server code, omitted from Kane's child-process environment, and redacted from outgoing messages. Raw OpenAI errors, raw Kane terminal objects, stderr and credentials are not streamed to the browser.

References: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

Fallback checkpoint: `69510b8`. Separate bug-restoration commit: `4b8fb76`.

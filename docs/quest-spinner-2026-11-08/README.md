# Quest spinner diagnosis and fix

The original browser reproduction used the real `/api/quest` endpoint with the simulated monitor and cancelled before any repair. No unlimited hang was observed in the 37-second reproduction. The request returned HTTP 200 with `application/x-ndjson`; progress reached the DOM. This endpoint uses newline-delimited JSON, not SSE/EventSource.

At 1280×900, Run showed only a generic spinner, while the live-log card began at y=824 and its first line at y=892. OpenAI had generated two checks and the pending step was headless Kane. A separate direct request received its first log at about 170ms and its OpenAI plan at about six seconds. OpenAI and the progress transport were working; progress visibility and the quiet Kane wait made execution appear stuck.

Kane also performs evidence/code-export post-processing before its final result; its own logs showed a code-export polling allowance of five minutes. The old server timeout killed only the immediate CLI process, then still depended on its `close` event to settle. Descendants could retain its pipes, leaving that promise unbounded. This potential indefinite wait is now guarded independently of process exit.

## Changes

- Immediate client-side live-log messages, an immediate server acceptance message, and visible current status next to Run.
- Five-second phase/elapsed-time heartbeats, plus redacted server logs tagged with a quest ID.
- Independent abort-aware deadlines that also reject if an operation ignores cancellation.
- Kane gets a dedicated process group on Unix; cancellation/timeout terminates the group, then escalates to SIGKILL after three seconds. The caller no longer depends on `close` to stop waiting.
- DAG poll requests and delays use the active step's cancellation signal. A timed-out repair restores its checkpoint and reports the timeout without silently retrying three times.
- Cancel beside the form and live-log header; a terminal `done`/`error` event ends the spinner without waiting for connection close.

| Step | Limit |
| --- | --- |
| Connect to quest server | 15s |
| No progress-stream updates | 30s |
| OpenAI objective expansion | 60s |
| OpenAI repair proposal | 90s |
| Kane execution including evidence upload | 180s |
| Warehouse query | 20s |
| Individual Airflow request/authentication | 15s |
| DAG reparse | 120s |
| DAG completion | 300s |

## Verification

All **90 tests** and TypeScript typecheck pass. Regression tests cover uncooperative steps, clear timeout errors despite generic fetch aborts, cancellation, stalled reads, split UTF-8 messages, terminal messages without stream closure, queue stopping, and rollback before surfacing a DAG timeout. Simulated row checks retain the browser deadline rather than incorrectly receiving the shorter SQL deadline.

[Original headless browser reproduction](reproduction.json) · [Before screenshot](before.jpg) · [After screenshot](after.png) · [Post-fix browser fault-injection results](fault-injection.json).

The post-fix headless browser checked the real UI at 1280×900 with only `/api/quest` responses replaced for deliberate faults. Initial log lines and status were visible, cancellation completed in about 110ms, a never-returning connection failed at about 15s, a silent stream failed at about 30s, and a `done` event on an unclosed stream completed in under 30ms. These fault-injection checks did not invoke billable services or mutate a pipeline.

A separate post-fix request to the real Airflow target received the initial acceptance and warehouse-preflight messages in its first chunk, then was cancelled before running a quest. Server logs confirmed cancellation after 177ms of application execution. The diagnostic request did not trigger a DAG or edit pipeline source.

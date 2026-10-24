---
mode: testing
max_steps: 50
timeout: 180
target: chrome
---

# Session: bug-quest-monitor

## Step 1
Open http://localhost:3000/pipelines. Verify Pipeline Monitor and enrollment_pipeline are visible, and Task details lists wait_for_source, extract, validate, transform, load, and notify. Verify extract and load each show 1,000 rows and overall status is Success. Click Trigger run, wait for the run to complete, and verify all six tasks show success and extract and load each still show 1,000 rows.

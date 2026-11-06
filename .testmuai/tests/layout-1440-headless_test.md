---
mode: testing
max_steps: 35
timeout: 360
target: chrome
headless: true
---

# Session: layout-1440-headless

## Step 1
Open http://127.0.0.1:3000/quest at the configured 1440px browser width. Do not start any quest or change data. Verify blue-black background, navy panels, white text, secondary gray text, blue accent links, sans-serif interface font, centered content with no horizontal page overflow, and scoreboard beside the form. Capture the quest screenshot. Open http://127.0.0.1:3000/stage. Verify the stage and leaderboard are side by side, centered and fully within the viewport horizontally, and the +20 +15 -5 scoring legend is straight. Capture the stage screenshot. Open http://127.0.0.1:3000/play. Verify centered dark theme, sans-serif font, side-by-side stage and leaderboard, and straight scoring legend with green positive and red negative values. Capture the play screenshot. Open http://127.0.0.1:3000/pipelines. Verify Pipeline Monitor heading and OBSERVABILITY label are fully visible beside the sidebar with no page horizontal overflow, dark theme and sans-serif font. Capture the pipelines screenshot. Verify all four routes loaded without clipped content.

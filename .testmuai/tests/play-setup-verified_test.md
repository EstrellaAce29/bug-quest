---
mode: testing
max_steps: 25
target: chrome
---

# Session: play-setup-verified

## Step 1
Open http://127.0.0.1:3000/play. Verify Bug Quest is shown. Select 4 players and verify four agent name and coaching strategy fields appear. Select 2 players again. Name the agents Play Rows and Play Wins and enter Compare extracted and loaded row counts and Check standings totals as their respective strategies. Click Create game. Verify Prepare for round 1, both agent names, a leaderboard with zero points, Start round 1, and three round indicators. Verify agent names are disabled and coaching strategies remain editable. Do not start a round or click Recover reset. Store the final page heading as play_heading.

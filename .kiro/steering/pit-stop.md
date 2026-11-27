---
inclusion: manual
description: "Run this when you want to stop for the day. Saves progress so the next session can resume."
---

Pit stop. Follow .kiro/steering/pit-stops.md: 1) finish the current small step, or revert it if it cannot be finished in a few minutes; 2) run `npm test` and `npm run test:browser`, and record any failure; 3) tick completed items in PIT-STOPS.md and in the active spec's tasks.md; 4) add anything useful for the Devpost write-up to docs/kiro-usage-log.md; 5) add a session-log row to PIT-STOPS.md with today's date, what was done, and the exact next step; 6) commit with a message that starts with 'Pit stop N:'; 7) run `gh api user --jq .login` and push only if it prints `kateliyanik`. If it prints anything else, do not push; tell the user to run `gh auth switch --user kateliyanik`.

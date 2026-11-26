---
inclusion: always
---

# Pit-stop workflow

- `PIT-STOPS.md` at the repo root is the single source of truth for progress.
- At the start of every session, read `PIT-STOPS.md`. Report the current pit stop, what is done, and the next unchecked item before doing any work.
- Work one checklist item at a time. After each item: run `npm test`, then tick the item in `PIT-STOPS.md`.
- When the user says "pit stop", or a phase is complete:
  1. Finish the current small step, or revert it if it cannot be finished quickly.
  2. Run `npm test`. Do not stop with failing tests unless the failure is recorded in the session log.
  3. Add a row to the session log: date, what happened, exact next step.
  4. Commit with a message that names the pit stop.
  5. Push after every pit stop (the user's standing choice), but only when `gh api user --jq .login` prints `kateliyanik`. The Mac also has an Operisoft GitHub account; never push this repo as that account.
- Never mark a pit stop that needs a human action (real-phone tests, recording, publishing) as done on the user's behalf.
- Record anything worth mentioning in the Devpost write-up in `docs/kiro-usage-log.md`: specs that changed a design, bugs caught by property tests, hooks that prevented a mistake.

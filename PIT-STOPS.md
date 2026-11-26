# POSSESSED: Pit Stops

This file is the single source of truth for progress. Every work session starts by reading it and ends by updating it.

## How to resume

1. Open the `Kiroween 2026` folder in Kiro (IDE or CLI).
2. Say: **"Resume from PIT-STOPS.md."**
3. Kiro reads this file (the `pit-stops` steering file tells it to), reports where things stand, and continues with the first unchecked item of the current pit stop.

To stop safely at any time: say **"Pit stop"**, or run the **Pit stop** hook from Kiro's hooks panel. Kiro then finishes or reverts the current small step, runs `npm test`, commits, and adds a row to the session log below.

The planning notes in this folder (`Rules.md`, `Kiroween 2026 *.md`) are listed in `.gitignore`, so they stay private when the repo is pushed.

## Deadline

Submission closes **Fri 4 Dec 2026, 2:00 pm PT (Sat 5 Dec, 3:30 am IST)**. Target submitting on **Thu 3 Dec**.

**Kiro credit requests close Tue 1 Dec, 12:00 pm PT (Wed 2 Dec, 1:30 am IST).** Approval takes up to 48 business hours, so request them now. The answer text is in `Kiroween 2026 Winning Plan - Possessed.md`.

## Phase overview

| Phase | Goal | Target date | Status |
|---|---|---|---|
| 1 | Core kit + feasibility test | Thu 26 Nov | Code done, waiting for real-phone test |
| 2 | Kit hardening (shake/tap, touch-first option, reconnect PBT) | Fri 27 Nov | **Done 26 Nov** |
| 3 | App 1: Spirit Board | Fri 27 – Sat 28 Nov | Not started |
| 4 | App 2: Possessed Talk | Sun 29 Nov | Not started |
| 5 | PossessionKit Kiro power, custom MCP server, hooks | Mon 30 Nov | Not started |
| 6 | Kiro Crew app: Poltergeist bot (separate repo) | Tue 1 Dec | Not started |
| 7 | Design polish, accessibility, public deployment | Tue 1 – Wed 2 Dec | Not started |
| 8 | Demo video with a real group, blog post, social post | Wed 2 Dec | Not started |
| 9 | Kiro write-up, Devpost submission | Thu 3 Dec | Not started |

If a phase slips, cut in this order: voice input, LLM features, Crew bot extras. Never cut the second app; Skeleton Crew requires two.

---

## Pit Stop 1: Feasibility gate (YOU ARE HERE)

### Done
- [x] Project structure, MIT licence, `.gitignore` (does not ignore `.kiro`; does ignore private planning notes).
- [x] Room protocol with input validation at the trust boundary (`kit/shared/protocol.js`).
- [x] Crowd aggregation: one phone, one vote; replays and stale inputs ignored (`kit/shared/aggregate.js`).
- [x] Room server: rooms, QR codes, phone replacement, screen reclaim, late-joiner state, rate limits, heartbeats (`kit/server/`).
- [x] Phone page with iPhone motion permission, auto-calibration, wake lock and a touch-pad alternative.
- [x] Feasibility screen with a live pass/fail checklist and a "Copy results" button (`/demo/`).
- [x] Crowd simulator (`npm run sim`).
- [x] 39 tests passing: property-based, integration over real sockets, and a 50-phone load test (`npm test`).
- [x] Kiro spec (`.kiro/specs/possession-kit/`), steering (3 files) and hooks (4 files).
- [x] Smoke test of the running server: all pages, QR code and health check respond; server source is not served.

### Not yet verified
- The pages now run in headless desktop Chrome (`npm run test:browser`, 25 checks), with emulated tilt and touch. They have **not** run on a real iPhone or Android phone. Real sensors, iOS permission prompts, mobile Safari and real Wi-Fi are only tested by the steps below.
- The hook files follow Kiro's `.kiro.hook` JSON format. Check that all four appear in Kiro's hooks panel.

### Your actions
0. Request Kiro credits (see the deadline note above).
1. Start the server: `npm start` (in the `Kiroween 2026` folder).
2. Give it an HTTPS address that phones can reach. iPhones only share tilt over HTTPS:
   `cloudflared tunnel --url http://localhost:8787`
   Copy the `https://….trycloudflare.com` address it prints.
3. Open `https://<that address>/demo/` on the laptop.
4. Scan the QR code with an iPhone and an Android phone. Tap **Possess the screen** on each.
5. Work through the checklist on the screen:
   - both phones move the crowd dot smoothly;
   - use the **Test other controls** buttons (Choice, Tap, Shake) and try each on both phones; shake for real on at least one phone;
   - turn Wi-Fi off on one phone for ~5 seconds, then on; it must rejoin by itself;
   - leave it running for 10 minutes;
   - optional load test: `npm run sim -- --url wss://<address>/ws --room <CODE> --phones 50`.
6. Click **Copy results** on the screen and paste the output under **Result** below, plus anything that felt wrong (lag, drift, jumpy movement, phone sleeping).
7. Tell Kiro "Resume from PIT-STOPS.md". It will read the result and continue.

### Decision rule
- **PASS:** continue to Phase 2.
- **FAIL on tilt only:** switch the main input to touch-drag and shake. Keep the concept. Do not spend more than half a day on sensor fixes.
- **FAIL on networking:** stop and review the server design before building apps.

### Decisions needed from you
- [x] Licence and commit name: Nikhil, GitHub private address `219089655+kateliyanik@users.noreply.github.com`, set for this repo only (not global).
- [x] Public repo: https://github.com/kateliyanik/possessed (MIT licence detected, `.kiro` visible). This repo pushes with the active `gh` account; run `gh auth status` and make sure `kateliyanik` is active before pushing.
- [ ] Hosting choice for the public demo (decide by Phase 7).

### Result
_(fill in after the test)_

---

## Pit Stop 2: Kit hardening
- [x] Shake and tap inputs on the phone, with aggregation (majority, strongest wins). Also multiple choice with rounds; shake reports mean, strongest and room energy.
- [x] Late-joiner state sync from screen to phones. The screen chooses phone controls (`kit/shared/ui.js`); late joiners and reconnects get the current ones; a screen reload resets phones to its controls.
- [x] Touch-only controls as a first-class alternative to tilt (accessibility rule). Touch is offered on the start screen and remembered; shake has a tap-fast alternative.
- [x] Headless Chrome test of the real pages: `npm run test:browser`, 25 checks passing (added; not in the original plan).
- [x] PBT for reconnect sequences (any order of join/leave/rejoin gives one vote per phone). Model-based, over real sockets, 1500 runs (`test/reconnect.test.js`).
- [x] Record any bug PBT catches in `docs/kiro-usage-log.md`. **Caught one:** an older tab that reconnected after a newer tab had zero influence. Fixed with per-connection epochs; regression test added; verified the tests fail without the fix.

## Pit Stop 3: Spirit Board
- [ ] Spec in `.kiro/specs/spirit-board/`.
- [ ] Original spirit-board design (do not use the word "Ouija" anywhere).
- [ ] Planchette physics, letter dwell detection, answer reveal.
- [ ] Phone UI for the app.

## Pit Stop 4: Possessed Talk
- [ ] Spec in `.kiro/specs/possessed-talk/`.
- [ ] Presenter screen with slides, tilt voting, confidence scale, ghost reactions.
- [ ] Anonymous questions, with presenter approval before display.

## Pit Stop 5: Kiro power, MCP, hooks
- [ ] `power/` folder: plugin manifest, generator skill, references.
- [ ] Custom MCP server: `validate_app_manifest`, `simulate_crowd`, `measure_fairness`.
- [ ] Screen-record Kiro scaffolding a third tiny interaction from a spec (for the video).

## Pit Stop 6: Poltergeist (Kiro Crew app)
- [ ] Separate public repo, same GitHub account.
- [ ] Bot that runs nightly crowd simulations and reports latency and fairness regressions.

## Pit Stop 7: Polish and deploy
- [ ] Spooky UI that shows real state: possession meter, contribution balance, reconnects.
- [ ] Public HTTPS deployment; judges can test with two browser tabs.

## Pit Stop 8: Video and posts
- [ ] Book 8–15 people for Wed 2 Dec. Get consent from everyone filmed.
- [ ] Video under 3 minutes, original or licensed audio only.
- [ ] Blog post (mention Kiroween 2026) and social post starting with `#KiroweenHackathon26`. Write both yourself.

## Pit Stop 9: Submit
- [ ] Kiro write-up, from `docs/kiro-usage-log.md`.
- [ ] Devpost form: category, bonus prizes, repo URLs, video, testing instructions.
- [ ] Submit by Thu 3 Dec.

---

## Session log

| Date | What happened | Next step |
|---|---|---|
| 26 Nov 2026 | Phase 1 built in the `Kiroween 2026` folder: protocol, aggregation, server, phone page, feasibility screen, simulator, 39 passing tests, Kiro spec/steering/hooks. Pushed to github.com/kateliyanik/possessed. | Request Kiro credits. Then run the Pit Stop 1 test on real phones and paste the result. |
| 26 Nov 2026 | Pit Stop 2 done (ahead of the real-phone test). Reconnect property test found and shrank a real bug (older reconnecting tab lost its vote); fixed with connection epochs. Added choice/tap/shake, screen-chosen phone controls, touch-first option, headless Chrome test. 62 unit/integration tests + 25 browser checks pass. | Run the Pit Stop 1 real-phone test (now also covers choice/tap/shake). If it passes, start Pit Stop 3 (Spirit Board). Pit Stop 3 can start before the test, but its tilt feel depends on the result. |

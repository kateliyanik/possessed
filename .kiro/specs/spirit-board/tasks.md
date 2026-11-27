# Tasks: Spirit Board

- [x] 1. Kit: agreement measure `coherence()` in the aggregator and screen SDK, with property tests (Req 6.2)
- [x] 2. Pure logic in `spirit.js`
  - [x] 2.1 Board layout: outer and inner rings, capture radii (Req 1.1, 1.2)
  - [x] 2.2 Planchette physics: velocity model, dead zone, speed cap, rim limit, magnetic assist, sub-steps (Req 2.1–2.5)
  - [x] 2.3 Dwell detection with hysteresis (Req 3.1–3.3)
  - [x] 2.4 Answer builder: SPACE rules, YES/NO, GOODBYE, 24-character limit (Req 3.4–3.6)
  - [x] 2.5 Property tests for all of the above
- [x] 3. Screen page
  - [x] 3.1 Original SVG board, planchette and dwell rings (Req 1, 3.2)
  - [x] 3.2 Phases: practice, séance, reveal; question input and presets; host controls (Req 4)
  - [x] 3.3 Phone controls per phase, broadcast on change and on room (Req 5)
  - [x] 3.4 Candles per phone and the agreement meter (Req 6)
  - [x] 3.5 URL tuning parameters (Req 2.6)
- [x] 4. Generated sound: drone, chime, reveal tone; off until the host turns it on (Req 7)
- [x] 5. Browser test for the app (`test/browser/spirit-board.mjs`)
- [ ] 6. Real-room test with 3+ people; tune the parameters (human)

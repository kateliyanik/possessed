# Kiro usage log

Raw notes for the Devpost "How Kiro was used" write-up. Add entries as they happen; edit into prose at Pit Stop 9.

Judges ask about: Kiro IDE/CLI/Web/Crew, custom agents, hooks, spec-driven development vs vibe coding, steering, MCP, property-based testing, and powers. Each entry should name a concrete decision or bug, not just a feature.

## Specs

- **2026-11-26, PossessionKit spec.** Writing Requirement 3.8 ("a player who sends more messages, or reconnects, shall not gain more influence") forced two design decisions before any code: only the latest input per player counts, and sequence numbers are seeded from the clock so they keep increasing across page reloads. Without the requirement, the obvious design (average every message received) would have let one phone outvote the room by sending faster.
- **2026-11-26.** Requirement 3.7 asked for results that are *exactly* independent of arrival order. Floating-point addition is not associative, so the design sums in sorted player-ID order. This made the property test able to use exact equality.

- **2026-11-26, Requirement 3.9 added after a bug.** The reconnect property test found that the original fairness design ("ignore any input whose number is not higher than the last one") wrongly silenced reconnecting tabs. The spec was updated first, then the code. The spec now records why the rule exists.
- **2026-11-26, stale controls after a screen reload.** While writing the browser test plan we noticed that after the screen page reloads, the server still holds the previous state, so phones would keep showing old controls (for example a finished question). Fixed by requiring every app to broadcast its current controls when it gets its room, and written into the architecture steering so both apps follow it. Found by reasoning through the test plan, not by a test failing.

## Browser testing

- `npm run test:browser` drives the real screen and phone pages in headless Chrome through the DevTools protocol, with no extra dependency. It uses Chrome's device-orientation override to emulate a tilting phone and real pointer events for the touch pad. 25 checks: tilt, touch, two-phone mean, choice/tap/shake modes, late joiner, automatic rejoin after a dropped connection, tab replacement, screen reload, bad room code, and no console errors.
- First run: 24 of 25 passed. The failure was a browser warning from calling `navigator.vibrate` without a real tap. Fixed by only vibrating after real user activation.

## Steering

- `product.md`: product rules (no trademark, touch alternative for every motion control, one phone one vote, design must show real state).
- `architecture.md`: layout, protocol and trust-boundary rules.
- `pit-stops.md`: makes every session start by reading `PIT-STOPS.md`, so work can stop and resume across days.

## Hooks

- `protocol-guard`: on edits to `kit/shared/`, checks fairness and validation rules and runs tests.
- `untrusted-text`: on browser code edits, blocks rendering phone-supplied text as HTML.
- `no-trademark`: keeps the trademarked name out of the spirit board app.
- `pit-stop`: manual hook that saves progress, commits and writes the next step.

## Property-based testing

- Aggregation is tested against a simple reference model (mean of each player's last tilt) over random input streams.
- Spam resistance, replay rejection and leave/rejoin are all properties, not examples.
### Bug caught: a reconnecting old tab silently lost its vote (2026-11-26)

**Property:** after any sequence of phones opening tabs, losing the network, reconnecting and sending tilt, every online phone counts exactly once, with the last value it sent (`test/reconnect.test.js`, model-based, real sockets).

**Shrunk counterexample from fast-check (6 steps):**

```
open tab for phone 0
tab 0 loses network
open tab for phone 0        <- the person rescans the QR code
tab 1 tilts to 0
tab 0 reconnects            <- they switch back to the first tab
tab 0 tilts to -0.01        -> crowd x is 0, expected -0.01
```

**Cause:** the phone page numbers its inputs from the time the page loaded, so the older tab's numbers are lower. The screen had already accepted a higher number from the newer tab, so it treated everything from the reconnected older tab as an old replay and dropped it. The phone showed "Connected" and had no influence at all.

**Why it matters:** in a real room people often rescan the QR code, which opens a second tab, and then switch back. That phone would sit in the crowd doing nothing, with no error anywhere.

**Fix:** the server gives each phone connection an increasing number. The screen orders inputs by connection first and message number second, so the newest connection always counts, while replays inside a connection are still rejected. The server also stops relaying input from a connection that has already been replaced.

**What the testing process taught us:** the first version of this test was a plain random array of actions and never found the bug in 80 runs, because most steps targeted tabs in the wrong state. Writing the suspected sequence by hand confirmed the bug. Switching to fast-check *model-based commands* (only valid steps run) and longer runs let it find and shrink the bug by itself. A property test that cannot find a known bug gives no protection against regressions, so we checked that it could before writing the fix.

## MCP, powers, Crew

_(Pit Stops 5 and 6)_

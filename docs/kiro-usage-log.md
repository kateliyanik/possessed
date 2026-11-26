# Kiro usage log

Raw notes for the Devpost "How Kiro was used" write-up. Add entries as they happen; edit into prose at Pit Stop 9.

Judges ask about: Kiro IDE/CLI/Web/Crew, custom agents, hooks, spec-driven development vs vibe coding, steering, MCP, property-based testing, and powers. Each entry should name a concrete decision or bug, not just a feature.

## Specs

- **2026-11-26, PossessionKit spec.** Writing Requirement 3.8 ("a player who sends more messages, or reconnects, shall not gain more influence") forced two design decisions before any code: only the latest input per player counts, and sequence numbers are seeded from the clock so they keep increasing across page reloads. Without the requirement, the obvious design (average every message received) would have let one phone outvote the room by sending faster.
- **2026-11-26.** Requirement 3.7 asked for results that are *exactly* independent of arrival order. Floating-point addition is not associative, so the design sums in sorted player-ID order. This made the property test able to use exact equality.

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
- _Record here any bug a property test catches, with the shrunk counterexample. Judges ask for this._

## MCP, powers, Crew

_(Pit Stops 5 and 6)_

# Design: Spirit Board

## Overview

```
apps/spirit-board/public/
  index.html   screen page: board, question, candles, QR
  board.css
  board.js     screen controller: phases, rendering, PossessionKit screen SDK
  spirit.js    pure logic: board layout, planchette physics, dwell, answer
  sound.js     Web Audio drone and chimes
```

Phones use the generic kit phone page. The screen sets their controls with the kit `ui` state: tilt mode with a prompt during practice and séance, wait mode with the answer during reveal.

## Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Control model | **Velocity** (marble on a tray), not position | With position control the planchette sits at the crowd's mean tilt. With many people the mean is near zero, so the outer ring is almost unreachable. With velocity control, partial agreement still moves the planchette, just slower. This matches the spooky slow drift of a real planchette. |
| Board shape | **Circle**, letters on the outer ring | The kit maps tilt onto a disc, so a circular board matches the input. The outer limit of the planchette sits on the letter ring: push to the rim to land on a letter, tilt sideways to slide around. An arched-rows layout would put letters in the middle of the disc, where every path crosses other letters. It would also look like the trademarked board. |
| Stopping on letters | Gentle **magnetic assist** when slow and near a glyph | Without it, a noisy crowd overshoots small targets. It only acts below a speed limit, so a moving planchette is not trapped. |
| Choosing | **Dwell** 1.2 s with **hysteresis** (must move 1.6× the glyph radius away to re-arm) | Prevents repeated letters from a resting planchette. Double letters are still possible by leaving and returning. |
| Simulation step | Fixed sub-steps of at most 20 ms | Frame rates vary on projectors; fixed steps keep the feel the same and keep the physics stable. |
| Agreement measure | `|mean tilt| / mean(|tilt|)`, computed in the kit | Shows whether the room is cooperating, which is the core of the experience. Belongs in the kit because Possessed Talk can use it too. |
| Tuning | URL parameters `accel`, `friction`, `assist`, `dwell` | The real-room test will decide the values; changing them must not need a code change. |

## Geometry (board units, centre 0,0, board radius 1)

- Outer ring: radius 0.82, A at the top, clockwise. 26 glyphs, about 0.20 apart; capture radius 0.085.
- Inner ring: radius 0.45. YES top, GOODBYE right, NO bottom, SPACE left; capture radius 0.12.
- Rest zone: radius < 0.15.
- Planchette limit: radius 0.84, just outside the letter ring.

## Physics (per sub-step of `dt` seconds)

```
t      = room mean tilt, dead zone 0.08 removed and rescaled
a      = accel · t − friction · v
if speed < 0.25 and a glyph is within 1.6× its capture radius:
  a   += assist · (glyph − p)
v      = v + a · dt, capped at maxSpeed (0.9 board units/s)
p      = p + v · dt
if |p| > 0.84: p is put back on the limit, and the outward part of v is removed
```

Defaults: accel 2.7, friction 3, assist 6, dwell 1200 ms. With every phone fully tilted the planchette crosses the board in about 2 seconds; with a third of the room agreeing, about 7 seconds.

## Phases

```
practice ──Begin──▶ séance ──GOODBYE / YES / NO / 24 chars / End──▶ reveal ──Ask again──▶ practice
    ▲                  │
    └──────Esc─────────┘
```

| Phase | Planchette | Choosing | Phone controls |
|---|---|---|---|
| practice | moves | off | tilt, prompt "Practice: move the planchette together" |
| séance | moves | on | tilt, prompt "<question> · so far: HEL" |
| reveal | stops | off | wait, prompt "The spirits answered: HELLO" |

The screen broadcasts the phone controls whenever they change and in `onRoom` (kit steering rule).

## Testing

- **Property-based** (`test/spirit.test.js`): the planchette never leaves the limit for any tilt sequence and frame timing; speed never exceeds the cap; with no input it comes to rest; a glyph is chosen only after continuous dwell; never chosen twice without leaving; the answer never has leading, trailing or double spaces and never exceeds 24 characters; glyph areas never overlap.
- **Browser** (`test/browser/spirit-board.mjs`): the page loads without errors, an emulated tilting phone moves the planchette to the rim and chooses a letter, the phone shows the letters so far, and the host can end the séance and see the reveal.
- **Real room** (human): tune the four URL parameters with 3+ people.

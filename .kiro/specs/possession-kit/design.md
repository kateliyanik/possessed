# Design: PossessionKit

## Overview

```
 phones (browser)                 room server (Node)               screen (browser)
 ┌──────────────┐  hello/input    ┌────────────────────┐  joined/left  ┌──────────────────┐
 │ phone-sdk.js │ ───────────────▶│ validate (protocol)│──────input───▶│ screen-sdk.js    │
 │ motion.js    │                 │ rooms.js registry  │               │ aggregate.js     │
 │ socket.js    │◀──── state ─────│ relay + rate limit │◀─── state ────│ app rendering    │
 └──────────────┘                 └────────────────────┘               └──────────────────┘
```

The server is a thin, validating relay. The screen is authoritative: it aggregates inputs and broadcasts app state. This keeps app logic in the browser, where apps can be built without touching the server.

## Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Transport | One WebSocket per device via a small Node server (`ws`) | Works on every phone browser; no accounts; runs locally and behind any HTTPS tunnel. WebRTC was rejected: TURN servers and NAT issues add risk in a 9-day build. |
| Where aggregation runs | On the screen | The server stays app-agnostic. Apps choose their own aggregation (mean, vote, majority). |
| Fairness | Latest input per player, increasing `seq`, stale window | Gives one phone one vote regardless of message rate (Requirement 3.8). |
| Order independence | Sum in sorted player-ID order | Floating-point sums depend on order; fixed order makes results exactly reproducible, which property tests can check. |
| Phone identity | Random ID in `localStorage`, `seq` seeded from the clock | Survives reloads and reconnects, so a phone keeps one identity and its sequence keeps increasing. |
| Reconnect | Newer connection replaces older (close 4001), no `left` event | Wi-Fi blips often leave a dead socket the server has not noticed yet. Replacing avoids a ghost duplicate and a flicker on screen. |
| Screen reload | Room code + secret key in `sessionStorage`, reclaim on hello | A refreshed projector tab keeps its room and its phones. |
| Motion | `deviceorientation`, auto-calibrated on first reading, 25° = full deflection | Comfortable range for a phone held flat; iOS permission requested from the join tap. |
| Accessibility | Touch-drag pad with identical input format | Same message type, so apps need no special case. |
| Build | No bundler; native ES modules | Less tooling to break; files served as-is. |

## Messages

Client → server (validated by `parseClientMessage`):

| Type | Sender | Fields |
|---|---|---|
| `hello` | screen | optional `room`, `key` to reclaim |
| `hello` | phone | `room`, `playerId`, `device` |
| `input` | phone | `kind` (`tilt`/`tap`/`shake`), `seq`, `x`,`y` or `v` |
| `stats` | phone | `rtt`, `hz` |
| `state` | screen | `data` (≤1900 bytes) |
| `ping` | any | `c` (client clock) |

Server → client: `welcome`, `joined`, `left`, `input` (with `id`), `stats` (with `id`), `state`, `screen` (online flag), `pong`, `error`.

Close codes: 4000 no hello, 4001 replaced, 4002 screen replaced, 4003 room closed, 4004 no room, 4005 room full, 4008 rate limit, 1009 too large.

## Error handling

- Invalid messages get an `error` reply and are dropped. The connection stays open, except for size and rate abuse.
- Phones retry with exponential backoff (250 ms to 5 s, jittered) and reconnect at once on `online` or when the tab becomes visible.
- Final close codes stop retrying and show a clear message on the phone.

## Testing strategy

- **Property-based (fast-check):** parser never throws; clamping; UTF-8 size; aggregation equals the reference model; order independence; spam resistance; replay rejection; leave/rejoin keeps one vote; influence shares sum to 1; motion mapping bounds and rotation symmetry.
- **Integration (real sockets):** room lifecycle, relay, late-joiner state, replacement, reclaim, role enforcement, bad input, size limit, hello timeout, rate limit, HTTP routes and path safety.
- **Load:** 50 phones through the real server; every phone counted once and the mean is exact.
- **Real devices:** the feasibility screen (Pit Stop 1), which a human runs.

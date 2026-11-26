---
inclusion: always
---

# Architecture rules

## Layout
- `kit/shared/`: pure ES modules used by both the server and browsers. No Node or DOM APIs here.
- `kit/server/`: Node room server (HTTP + WebSocket at `/ws`). It relays and validates; it does not run app logic.
- `kit/client/`: browser SDKs (`socket.js`, `phone-sdk.js`, `screen-sdk.js`, `motion.js`) and the generic phone page.
- `kit/demo/`: the feasibility screen.
- `kit/tools/`: developer tools such as the crowd simulator.
- `apps/<name>/public/`: each app's static files, served at `/apps/<name>/`. Apps import the kit; the kit never imports an app.

## Protocol
- All client messages go through `parseClientMessage` in `kit/shared/protocol.js`. Add a new message type there first, with tests, then use it.
- The screen is authoritative for app state. Phones send inputs; the screen aggregates and broadcasts `state`.
- Inputs carry a per-phone increasing `seq`; the server adds a per-connection epoch `e`. Aggregation orders by (`e`, `seq`) and keeps only the latest input per player. Never compare `seq` alone: an older tab that reconnects has lower `seq` values (see `test/reconnect.test.js`).
- The server only relays input from a player's current connection.
- Phone controls are chosen by the screen: put a `ui` object in broadcast state (`kit/shared/ui.js`). Phones validate it with `parseUi`.
- Every app must broadcast its current `ui` in its `onRoom` callback. After a screen reload the server still holds the old state, and phones would otherwise keep showing stale controls.

## Trust boundary
- Treat every WebSocket message and query parameter as untrusted. Validate type, range and size; clamp numbers.
- Render any text that came from a phone with `textContent`, never `innerHTML`.
- Keep per-connection rate limits and the message size limit in place.
- Static file serving must stay inside its root folder.

## Dependencies
- Runtime dependencies are limited to `ws` and `qrcode`. Ask before adding any other runtime dependency.
- No front-end build step. Browsers load ES modules directly.

## Testing
- `npm test` runs `node --test`.
- Pure logic gets property-based tests with `fast-check`. Server behaviour gets integration tests over real sockets.

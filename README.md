# POSSESSED

**A room of phones becomes one collective controller for a shared screen.**

People scan a QR code. There is no app and no account. Each phone's tilt (or a finger on a touch pad) is combined fairly, one phone one vote, and the whole room moves one thing together.

Built for Kiroween 2026 (Skeleton Crew) with Kiro.

> Status: Pit Stop 1. The kit and the feasibility test are built. The two apps come next.

## Repository layout

| Path | What it is |
|---|---|
| `kit/` | **PossessionKit**, the skeleton: room server, protocol, fair aggregation, phone and screen SDKs |
| `apps/spirit-board/` | App 1: the room moves one planchette across a spirit board *(in progress)* |
| `apps/possessed-talk/` | App 2: an audience steers a presentation *(in progress)* |
| `.kiro/` | Specs, steering and hooks used to build this with Kiro |
| `test/` | Property-based, integration and load tests |

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm start          # http://localhost:8787
npm test           # property-based, integration and load tests
```

Open `http://localhost:8787/demo/` on a laptop or projector.

Phones only share tilt over **HTTPS**. To test with real phones, expose the server with any HTTPS tunnel, for example:

```bash
cloudflared tunnel --url http://localhost:8787
```

Open the `https://…` address it prints, go to `/demo/`, and scan the QR code. Phones without motion sensors, or people who prefer not to tilt, can use the touch pad.

No phones nearby? Open the join link in a second browser tab and use the touch pad, or run the crowd simulator:

```bash
npm run sim -- --room ABCD --phones 50
```

## How fairness works

- Only each phone's latest input counts, so sending faster gives no extra influence.
- Inputs carry increasing sequence numbers; replays and out-of-order messages are ignored.
- Phones that go quiet drop out after 1.5 seconds; phones that disconnect drop out at once.
- The combined result is exactly the same whatever order phones join in.

These rules are checked with property-based tests in `test/aggregate.test.js`.

## License

MIT. See [LICENSE](LICENSE).

# Requirements: PossessionKit

## Introduction

PossessionKit lets a group of people control one shared screen with their phones. A phone joins by scanning a QR code and needs no app or account. The kit handles rooms, connections, input validation and fair aggregation, so an application only decides what the crowd's input means.

## Requirement 1: Rooms

**User story:** As a host, I want to open a screen and get a room code and QR code, so people can join quickly.

1. WHEN a screen connects without a room THE SYSTEM SHALL create a room with a unique 4-letter code and a secret screen key.
2. THE SYSTEM SHALL exclude the letters I and O from room codes.
3. WHEN a screen reconnects with a valid room code and screen key THE SYSTEM SHALL return control of the same room and resend the current list of phones.
4. WHEN a screen reconnects with an unknown room or a wrong key THE SYSTEM SHALL create a new room.
5. WHEN a room's screen has been disconnected for longer than the grace period (default 120 seconds) THE SYSTEM SHALL close the room and disconnect its phones.
6. THE SYSTEM SHALL serve a QR code for a room's join link, built only from the validated room code and host.

## Requirement 2: Phones

**User story:** As a participant, I want to join from my phone's browser and stay connected, so I can take part without setup.

1. WHEN a phone joins a room that does not exist THE SYSTEM SHALL send an error and close the connection with code 4004.
2. WHEN a room has reached its phone limit (default 200) THE SYSTEM SHALL refuse new phones.
3. WHEN a phone joins with a player ID that is already connected THE SYSTEM SHALL close the older connection with code 4001 and keep the newer one, without reporting the player as having left.
4. WHEN a phone's connection drops THE phone client SHALL reconnect automatically with backoff and rejoin as the same player.
5. WHEN a phone joins or leaves THE SYSTEM SHALL notify the room's screen.
6. WHEN a phone joins a room that already has app state THE SYSTEM SHALL send it the latest state.
7. WHERE the device requires permission for motion data THE phone client SHALL request it only after a user tap.
8. WHERE motion data is unavailable or refused THE phone client SHALL offer touch-drag input instead.

## Requirement 3: Inputs and fairness

**User story:** As a participant, I want my input to count exactly as much as everyone else's, so the result belongs to the whole room.

1. THE SYSTEM SHALL accept input kinds `tilt` (x, y in -1..1), `tap`, and `shake` (v in 0..1), each with an increasing sequence number.
2. THE SYSTEM SHALL clamp numeric inputs to their allowed range.
3. THE aggregator SHALL keep only the latest input for each player.
4. THE aggregator SHALL ignore an input whose sequence number is not greater than the player's last accepted input.
5. THE aggregator SHALL ignore inputs older than the stale window (default 1.5 seconds).
6. WHEN a phone leaves THE aggregator SHALL stop counting its input at once.
7. THE aggregated tilt SHALL be the mean of current inputs, SHALL be exactly independent of the order players arrive in, and SHALL stay within -1..1.
8. A player who sends more messages, or reconnects, SHALL NOT gain more influence than a player who sends one message.

## Requirement 4: Trust boundary and abuse limits

1. THE SYSTEM SHALL reject messages larger than 2048 bytes, binary messages, malformed JSON and unknown message types without crashing.
2. THE SYSTEM SHALL require a `hello` message first, and close connections that send none within 10 seconds.
3. THE SYSTEM SHALL rate-limit each connection and drop messages above the limit.
4. THE SYSTEM SHALL only let a screen send `state`, and only let a phone send `input` and `stats`.
5. THE SYSTEM SHALL never serve files outside its static folders, and SHALL NOT serve the server's own source.
6. THE SYSTEM SHALL detect dead connections with heartbeats and remove them.

## Requirement 5: Feasibility evidence

**User story:** As the builder, I want a test screen that shows whether real phones work well enough, so I can decide early whether tilt control is viable.

1. THE feasibility screen SHALL show each phone's device type, round-trip time, input rate and share of influence.
2. THE feasibility screen SHALL show a pass/fail checklist: two or more phones; an iPhone and an Android phone seen; the crowd moved the spirit to the edge; at least one automatic rejoin; 10 minutes with two or more phones; median round-trip time under 150 ms.
3. THE crowd simulator SHALL connect a chosen number of simulated phones to a room and report round-trip percentiles.

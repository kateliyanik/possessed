# Requirements: Spirit Board

## Introduction

Spirit Board is the first app built on PossessionKit. A host asks a question on a shared screen. Everyone in the room tilts their phone, and the combined tilt moves one planchette across an original circular spirit board. When the planchette rests on a letter long enough, the letter is chosen. Letter by letter, the room spells an answer that nobody controlled alone.

Never use the trademarked board name anywhere. Say "spirit board".

## Requirement 1: The board

1. THE board SHALL be an original circular design: the 26 letters A–Z evenly spaced around an outer ring, and YES, NO, SPACE and GOODBYE on an inner ring.
2. THE centre of the board SHALL be a rest zone where nothing is chosen.
3. ALL art and sound SHALL be original (drawn and generated in code). No third-party fonts, images, logos or audio files.

## Requirement 2: Moving the planchette

**User story:** As a participant, I want the planchette to drift where the room pushes it, so it feels like it moves on its own.

1. THE planchette SHALL move like a marble on a tray: the room's mean tilt accelerates it, friction slows it, and its speed is capped.
2. A small tilt (dead zone) SHALL NOT move the planchette, so phones held roughly flat do not cause drift.
3. THE planchette SHALL never leave the board. WHEN it reaches the outer ring THE SYSTEM SHALL hold it on the ring, so pushing to the rim lands on letters and tilting sideways slides it around the ring.
4. WHEN the planchette moves slowly near a glyph THE SYSTEM SHALL pull it gently onto that glyph, so a crowd can stop on a letter.
5. WITH no input THE planchette SHALL come to rest.
6. THE movement settings (acceleration, friction, assist, dwell time) SHALL be adjustable by URL parameters, so they can be tuned after a real-room test without code changes.

## Requirement 3: Choosing letters

1. WHEN the planchette stays within a glyph's area for the dwell time (default 1.2 s) during a séance THE SYSTEM SHALL choose that glyph.
2. THE screen SHALL show dwell progress on the glyph being hovered.
3. AFTER a glyph is chosen THE SYSTEM SHALL NOT choose it again until the planchette has clearly left it (hysteresis), so a resting planchette does not repeat a letter. A double letter needs the room to leave and return.
4. SPACE SHALL add a single space; the answer SHALL never start or end with a space or contain two spaces in a row.
5. WHEN YES or NO is chosen with no letters spelled yet THE SYSTEM SHALL end the séance with that word as the answer. Otherwise the word is added to the answer.
6. WHEN GOODBYE is chosen, or the answer reaches 24 characters, THE SYSTEM SHALL end the séance.

## Requirement 4: Séance flow

**User story:** As a host, I want a simple flow I can run in front of a room, so the demo works without explanation.

1. THE screen SHALL start in a practice phase: the planchette moves but nothing is chosen, so people learn to steer together.
2. THE host SHALL type a question or pick a preset, and start the séance.
3. DURING a séance THE screen SHALL show the question and the letters chosen so far.
4. THE host SHALL be able to end the séance early, and return to practice at any time.
5. WHEN a séance ends THE screen SHALL reveal the answer letter by letter, then offer to ask again.

## Requirement 5: Phones

1. DURING practice and séance, phones SHALL be in tilt mode, showing the question and the letters chosen so far.
2. WHEN the answer is revealed, phones SHALL show it.
3. Phones that join late, and phones after a screen reload, SHALL show the current phase (kit Requirement 6.3).
4. Touch-pad users SHALL steer exactly like tilt users (kit Requirement 6.5).

## Requirement 6: The design shows real state

1. THE screen SHALL show one candle per connected phone. A candle burns brightly while its phone is steering, dims when the phone is idle, and flickers when a phone rejoins.
2. THE screen SHALL show how much the room agrees ("the spirit is listening"): the length of the mean tilt divided by the mean tilt length. It is near 1 when everyone pushes the same way and near 0 when they cancel out.
3. THE screen SHALL show the room code and QR code throughout.

## Requirement 7: Sound

1. THE app SHALL be silent until the host turns sound on (browser autoplay rules).
2. WITH sound on, THE app SHALL play a low drone, a chime when a glyph is chosen, and a deeper tone when the answer is revealed, all generated with Web Audio.

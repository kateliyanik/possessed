import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { UI_LIMITS, UI_MODES, cleanText, parseUi } from '../kit/shared/ui.js';

test('a choice ui keeps option positions', () => {
  const ui = parseUi({ mode: 'choice', prompt: ' Pick\none ', options: ['Yes', '', 42, 'No'], round: 3 });
  assert.deepEqual(ui, { mode: 'choice', prompt: 'Pick one', options: ['Yes', 'Option 2', 'Option 3', 'No'], round: 3 });
});

test('a choice with no options becomes a wait screen', () => {
  assert.equal(parseUi({ mode: 'choice', options: [] }).mode, 'wait');
});

test('unknown modes and non-objects are rejected', () => {
  for (const bad of [null, undefined, 1, 'tilt', [], { mode: 'hack' }, { mode: '__proto__' }]) {
    assert.equal(parseUi(bad), null, JSON.stringify(bad));
  }
});

test('control and bidi-override characters are removed', () => {
  assert.equal(cleanText('a\u202Eb\u0000c\u200Bd', 50), 'a b c d');
});

test('long text is cut without splitting emoji', () => {
  const text = cleanText('👻'.repeat(200), 10);
  assert.equal(Array.from(text).length, 10);
  assert.ok(text.endsWith('…'));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(text), 'no lone surrogates');
});

test('PBT: parseUi never throws and always returns bounded, clean output', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.anything(),
        fc.record({
          mode: fc.oneof(fc.constantFrom(...UI_MODES), fc.string()),
          prompt: fc.oneof(fc.string({ unit: 'binary' }), fc.anything()),
          options: fc.oneof(fc.array(fc.oneof(fc.string({ unit: 'binary' }), fc.anything()), { maxLength: 20 }), fc.anything()),
          round: fc.oneof(fc.integer(), fc.anything()),
        }),
      ),
      (raw) => {
        const ui = parseUi(raw);
        if (ui === null) return;
        assert.deepEqual(Object.keys(ui).sort(), ['mode', 'options', 'prompt', 'round']);
        assert.ok(UI_MODES.includes(ui.mode));
        assert.ok(Array.from(ui.prompt).length <= UI_LIMITS.prompt);
        assert.ok(ui.options.length <= UI_LIMITS.options);
        for (const o of ui.options) {
          assert.equal(typeof o, 'string');
          assert.ok(o.length > 0 && Array.from(o).length <= UI_LIMITS.option);
          assert.ok(!/[\u0000-\u001f\u202a-\u202e]/.test(o));
        }
        assert.ok(Number.isInteger(ui.round) && ui.round >= 0);
        if (ui.mode === 'choice') assert.ok(ui.options.length > 0);
      },
    ),
    { numRuns: 500 },
  );
});

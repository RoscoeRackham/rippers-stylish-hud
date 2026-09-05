import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEndTurnControl, resolveEndingCombatant, END_TURN_SELECTOR } from '../scripts/end-turn-bridge.mjs';

// minimal element stub (nodeType 1 + classList.contains + parentElement)
function el({ classes = [], parent = null } = {}) {
  return { nodeType: 1, parentElement: parent, classList: { contains: (c) => classes.includes(c) } };
}

test('isEndTurnControl matches the action-menu hourglass (.ib-am-end-turn-btn)', () => {
  assert.ok(isEndTurnControl(el({ classes: ['ib-am-end-turn-btn'] })));
});

test('isEndTurnControl matches the party-card variant (.ib-end-turn-btn)', () => {
  assert.ok(isEndTurnControl(el({ classes: ['ib-end-turn-btn'] })));
});

test('isEndTurnControl matches when the click lands on an inner icon (ancestor walk)', () => {
  const btn = el({ classes: ['ib-am-end-turn-btn'] });
  const icon = el({ classes: ['fa-hourglass'], parent: btn });
  assert.equal(isEndTurnControl(icon), btn);
});

test('isEndTurnControl does NOT match other HUD controls', () => {
  assert.equal(isEndTurnControl(el({ classes: ['ib-action-btn'] })), null);
  assert.equal(isEndTurnControl(el({ classes: ['ib-side-tab'] })), null);
  assert.equal(isEndTurnControl(el({ classes: ['ib-list-item'] })), null);
  assert.equal(isEndTurnControl(el({ classes: ['ib-quick-slot'] })), null);
});

test('END_TURN_SELECTOR names exactly the two verified buttons', () => {
  assert.equal(END_TURN_SELECTOR, '.ib-am-end-turn-btn, .ib-end-turn-btn');
});

test('resolveEndingCombatant: GM gets the current combatant', () => {
  const c = { name: 'Vin', actor: { isOwner: true } };
  const game = { user: { isGM: true }, combat: { started: true, combatant: c, combatants: [c] } };
  assert.equal(resolveEndingCombatant(game), c);
});

test('resolveEndingCombatant: no started combat → null', () => {
  assert.equal(resolveEndingCombatant({ user: { isGM: true }, combat: { started: false } }), null);
  assert.equal(resolveEndingCombatant({ user: {}, combat: null }), null);
});

test('resolveEndingCombatant: player with no current → their single owned combatant', () => {
  const c = { name: 'Ana', actor: { isOwner: true } };
  const game = { user: { isGM: false }, combat: { started: true, combatant: null, combatants: { filter: (f) => [c].filter(f) } } };
  assert.equal(resolveEndingCombatant(game), c);
});

test('resolveEndingCombatant: player, current not owned, none owned → null (no hijack)', () => {
  const other = { name: 'Foe', actor: { isOwner: false } };
  const game = { user: { isGM: false }, combat: { started: true, combatant: other, combatants: { filter: (f) => [].filter(f) } } };
  assert.equal(resolveEndingCombatant(game), null);
});

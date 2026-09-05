/* ============================================================================
 * rippers-stylish-hud — SAH → Project FU END-TURN BRIDGE
 * ----------------------------------------------------------------------------
 * WHY: SAH's hourglass ends a turn by advancing Foundry's CORE combat model.
 * Project FU (FUCombat) overrides that model entirely — a turn ends ONLY via the
 * custom `combat.endTurn(combatant)` (records the combatant in the
 * CombatantsTurnTaken flag, clears the active combatant, re-runs setupTurns, THEN
 * nextTurn). FU also clears `combat.combatant` between turns and alternates by
 * faction, not a core turn index. So SAH's generic advance silently no-ops
 * (verified in FoundryVTT-Fabula-Ultima: ui/combat.mjs endTurn/nextTurn,
 * ui/combat-tracker.mjs #onEndTurn, ui/combat-hud.mjs EndTurn, socket.mjs).
 *
 * FIX: intercept the hourglass click in the CAPTURE phase and redirect to FU's
 * own public path `ui.combat.handleEndTurn(combatant)` — the exact method BOTH FU
 * native UIs call. SAH binds its listeners at DOCUMENT level (ui/input-handler.js:
 * document.addEventListener click/mousedown/contextmenu), so a capture-phase
 * document listener runs FIRST by construction and we stop the event before SAH
 * sees it. No SAH fork, no FU change; additive, FU-only, combat-only.
 *
 * SELECTORS (source-verified from the installed module, god 2026-09-05):
 *   .ib-am-end-turn-btn — ACTION MENU end-turn (the red hourglass by the identity
 *                          header — the button Austin clicks)
 *   .ib-end-turn-btn    — PARTY-CARD end-turn (shown only under .ib-card.is-turn)
 * ============================================================================ */

const SYSTEM_ID = 'projectfu';
const END_TURN_SELECTOR = '.ib-am-end-turn-btn, .ib-end-turn-btn';

/** PURE (testable): is this element (or an ancestor) one of SAH's end-turn
 *  buttons? Ancestor walk = closest() equivalent, so a click on the inner icon
 *  still matches. Returns the matched element or null. */
export function isEndTurnControl(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cls = n.classList;
    if (cls && (cls.contains('ib-am-end-turn-btn') || cls.contains('ib-end-turn-btn'))) return n;
  }
  return null;
}

/** PURE (testable): which combatant's turn is ending? FU's active combatant, else
 *  the single combatant this user owns. Never hands a non-GM a turn they don't own.
 *  (Both SAH buttons only appear on the acting combatant's turn, so the FU active
 *  combatant is the correct target for each.) */
export function resolveEndingCombatant(game) {
  const combat = game?.combat;
  if (!combat || !combat.started) return null;
  const cur = combat.combatant;
  if (cur && (game.user?.isGM || cur.actor?.isOwner)) return cur;
  const owned = combat.combatants?.filter?.((c) => c.actor?.isOwner) ?? [];
  if (owned.length === 1) return owned[0];
  return game.user?.isGM ? (cur ?? null) : null;
}

/** Capture-phase click handler. Guarded: FU-only, combat-only, FU HUD present. */
export function onEndTurnClickCapture(event) {
  const game = globalThis.game;
  if (game?.system?.id !== SYSTEM_ID) return;      // FU worlds only
  if (!game?.combat?.started) return;              // during combat only
  if (!isEndTurnControl(event.target)) return;     // one of SAH's end-turn buttons
  const combatant = resolveEndingCombatant(game);
  if (!combatant) return;                          // no valid combatant → let SAH do its thing (it warns)
  if (typeof globalThis.ui?.combat?.handleEndTurn !== 'function') return; // FU combat UI present?
  // Take over from SAH's (no-op) core advance and run FU's real end-turn.
  event.preventDefault();
  event.stopImmediatePropagation();
  globalThis.ui.combat.handleEndTurn(combatant);
}

// Live wiring (harmless in headless tests: no Hooks → skipped). Capture phase on
// document so we beat SAH's document-level delegated listeners.
if (typeof globalThis.Hooks?.once === 'function') {
  globalThis.Hooks.once('ready', () => {
    if (globalThis.game?.system?.id === SYSTEM_ID) {
      document.addEventListener('click', onEndTurnClickCapture, true);
    }
  });
}

export { END_TURN_SELECTOR };

# Rippers Unmasked — Stylish Action HUD (Fabula Ultima bridge)

Registers a **Project FU** (Fabula Ultima) system adapter with the
[Stylish Action HUD](https://foundryvtt.com/packages/stylish-action-hud) (SAH) module,
so SAH knows how to read a Fabula Ultima actor — including this campaign's custom item
types.

## What it does

**Party HUD** tracks (Austin's locked scope):
- **HP / MP / IP** bars (from `system.resources.{hp,mp,ip}`)
- Status **condition icons** (from the actor's active/temporary effects)

Nothing else on the HUD — no Fabula/Ultima Points, no zenit.

**Action menu** categories (only shown when the actor has them):
- **Attacks** — weapons / custom weapons / basic attacks
- **Spells**
- **Skills & Features** — class skills, heroic skills, ordinary class features
- **Arcana** — each Arcanum offers *Pulse* and *Dismiss* (from `rippers-arcana`)
- **Clots** — hoplospheres seated on weapons/armor (sockets)
- **Guises** — bind/activate a guise (routes to the `rippers-guise` API)

## How it works

- Registers via SAH's public adapter API on
  `Hooks.once("stylish-action-hud.apiReady", api => api.registerSystemAdapter("projectfu", …))`.
  The hook shape is copied from the free reference integrations
  (`sf2e-stylish-action-hud-integration`, `swade-StylishActionHud-integration`).
- **No Project FU fork** and **no SAH code redistributed** — this bridge only uses the
  public API and loads harmlessly (no-ops) if SAH is absent.
- Recommends (not requires) `stylish-action-hud`, `rippers-arcana`, `rippers-guise`.

## Requirements

- Foundry VTT **v13**, Fabula Ultima (**projectfu**) system.
- **Stylish Action HUD** installed (a GlitchSmith Patreon module) — needed to actually
  show the HUD; without it this module simply does nothing.

## Testing

`npm test` runs the headless unit tests (`node --test`) over the pure mapping logic —
no SAH or Foundry runtime required. In-game verification (rolls firing, HUD rendering)
is done live in Foundry with SAH active.

*Personal-table module — not for redistribution.*

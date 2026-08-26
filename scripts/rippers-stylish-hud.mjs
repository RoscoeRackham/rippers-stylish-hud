/* =============================================================================
 * rippers-stylish-hud.mjs
 * -----------------------------------------------------------------------------
 * A bridge module that registers a Fabula Ultima (projectfu) SYSTEM ADAPTER with
 * the "Stylish Action HUD" (SAH) module, so the party HUD and action menu know how
 * to read a Project FU actor — INCLUDING our custom item types (Arcana and Guises).
 *
 * CONVENTIONS — aligned to the SAH community-assets hub's ProjectFU adapter
 * (wyrmisis/stylish-action-hud-community-assets, src/projectfu):
 *   - register on `Hooks.once("stylish-action-hud.apiReady", api => …)` via a
 *     `createProjectFUAdapter(BaseSystemAdapter)` factory that EXTENDS SAH's
 *     `api.BaseSystemAdapter` (so super.* fallbacks work), then
 *     `api.registerSystemAdapter("projectfu", Adapter, {priority, source, isCompatible})`
 *     + `api.registerDefaultAttributes` + `api.registerTheme`.
 *   - reuse the Project FU system's own i18n keys (FU.Attack / FU.Spell / FU.Skill /
 *     FU.Inventory) for the core categories; RIPPERS.SAH.* for our own.
 *   - Inventory = `consumable` items; IP cost read from `system.ipCost.value`; fired
 *     with the item's `.roll()`, the same path the community adapter uses.
 * The registration HOOK + adapter method surface were first verified against the
 * FUNCTIONING free integrations (CalielBR/sf2e-stylish-action-hud-integration,
 * swade-StylishActionHud-integration) — both call the same apiReady/registerSystemAdapter.
 * If SAH does not expose `api.BaseSystemAdapter` (older builds), we fall back to a
 * STANDALONE adapter (extends Object) so registration still works. NO Project FU fork,
 * no SAH code redistributed; loads harmlessly if SAH is absent.
 *
 * SCOPE (Austin, LOCKED — 2026-08-25/26):
 *   - Party HUD tracks: HP / MP / IP bars + status-condition icons. Nothing else.
 *   - Action menu: Attacks, Spells, Skills & Features, Inventory, Arcana (Arcanist-
 *     only — shown only for actors that hold an Arcanum item), Guises, then the four
 *     universal FU system actions (Guard / Study / Hinder / Objective). NO Clots
 *     (their effects ride on the host weapon/armor).
 *
 * The mapping logic lives in PURE, exported helpers so it is unit-testable headless
 * (no SAH, no Foundry runtime). The adapter class + registration are thin wrappers.
 * =============================================================================*/

const MODULE_ID = 'rippers-stylish-hud';
const SYSTEM_ID = 'projectfu';

// Custom-item discriminators (verified against the sibling modules' source).
const ARCANUM_FEATURE = 'projectfu.arcanum';     // rippers-arcana: classFeature system.featureType
const GUISE_FEATURE   = 'rippers-guise.guise';   // rippers-guise: classFeature system.featureType

// Blood-register bar colours (register ruling): HP red, MP steel-blue, IP gold.
const DEFAULT_ATTRIBUTES = [
	{ path: 'system.resources.hp', maxPath: 'system.resources.hp.max', label: 'HP', color: '#c8102a', style: 'bar', icon: 'fa-solid fa-heart' },
	{ path: 'system.resources.mp', maxPath: 'system.resources.mp.max', label: 'MP', color: '#2f6fb0', style: 'bar', icon: 'fa-solid fa-droplet' },
	{ path: 'system.resources.ip', maxPath: 'system.resources.ip.max', label: 'IP', color: '#c9a227', style: 'bar', icon: 'fa-solid fa-gear' },
];

// Action id namespacing (executeAction / useItem parse these back).
const ID = {
	item:          (id) => `item:${id}`,
	arcanaPulse:   (id) => `arcana-pulse:${id}`,
	arcanaDismiss: (id) => `arcana-dismiss:${id}`,
	guise:         (id) => `guise:${id}`,
};

// --- tiny helpers (no foundry.utils / game dependency -> unit-testable) --------
function getProp(obj, path) {
	if (obj == null || !path) return undefined;
	return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
const clampPercent = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const itemsOf = (actor) => Array.from(actor?.items ?? []);
const itemsOfType = (actor, ...types) => itemsOf(actor).filter((i) => types.includes(i?.type));
/** Localize with an English fallback so headless code/tests never render a bare key. */
const L = (key, fallback) => {
	const s = globalThis.game?.i18n?.localize?.(key);
	return (s && s !== key) ? s : fallback;
};

// =============================================================================
// Party HUD — stats (HP/MP/IP) + conditions
// =============================================================================

/** getStats: map the tracked attributes (or our defaults) to SAH HudStat objects. Pure. */
export function fuStats(actor, configAttributes) {
	const attrs = (configAttributes && configAttributes.length) ? configAttributes : DEFAULT_ATTRIBUTES;
	return attrs.map((attr) => {
		const raw = getProp(actor, attr.path);
		let value = 0, max = 0;
		if (raw && typeof raw === 'object') {
			value = Number(raw.value ?? 0) || 0;
			max = Number(raw.max ?? getProp(actor, attr.maxPath ?? `${attr.path}.max`) ?? 0) || 0;
		} else if (typeof raw === 'number') {
			value = raw;
			max = Number(getProp(actor, attr.maxPath ?? `${attr.path}.max`) ?? 0) || 0;
		}
		const percent = max > 0 ? clampPercent((value / max) * 100) : 0;
		return {
			path: attr.path, label: attr.label, value, max, percent,
			color: attr.color, style: attr.style ?? 'bar', icon: attr.icon, subtype: 'resource',
		};
	});
}

/** getConditions: FU active/temporary effects -> SAH ConditionData. Pure. */
export function fuConditions(actor) {
	const effects = actor?.temporaryEffects ?? [];
	return Array.from(effects).map((e) => {
		const src = e?.img || e?.icon || '';
		return {
			id: e?.id || e?.name || 'unknown',
			src: (typeof src === 'string' && (src.includes('/') || src.includes('.'))) ? src : '',
			name: e?.name || e?.label || 'Effect',
			value: e?.value ?? null,
		};
	}).filter((c) => c.src);
}

// =============================================================================
// Custom-item detectors (Arcana / Guises) — pure
// =============================================================================
export const arcanaItems = (actor) => itemsOf(actor).filter((i) => i?.type === 'classFeature' && i?.system?.featureType === ARCANUM_FEATURE);
export const guiseItems  = (actor) => itemsOf(actor).filter((i) => i?.type === 'classFeature' && i?.system?.featureType === GUISE_FEATURE);
/** Inventory = carried usable gear: Project FU `consumable` items (potions/tonics/etc.). Pure. */
export const inventoryItems = (actor) => itemsOfType(actor, 'consumable');
/** Regular class skills/features — classFeatures that are NOT our Arcana or Guise features. Pure. */
export function classSkillItems(actor) {
	return itemsOf(actor).filter((i) =>
		i?.type === 'skill' || i?.type === 'heroic'
		|| (i?.type === 'classFeature' && i?.system?.featureType !== ARCANUM_FEATURE && i?.system?.featureType !== GUISE_FEATURE));
}

// =============================================================================
// Action menu — categories + submenu data
// =============================================================================

// The four Fabula Ultima system actions (community-assets convention): rendered as
// `type: 'system'` buttons (no submenu), fired through the system's own handler.
// Universal — shown for every actor, not has-items gated.
export const SYSTEM_ACTIONS = [
	{ id: 'action.guard',     key: 'guard',     label: 'FU.Guard',     fallback: 'Guard',     icon: 'ra ra-shield' },
	{ id: 'action.study',     key: 'study',     label: 'FU.Study',     fallback: 'Study',     icon: 'ra ra-book' },
	{ id: 'action.hinder',    key: 'hinder',    label: 'FU.Hinder',    fallback: 'Hinder',    icon: 'ra ra-interdiction' },
	{ id: 'action.objective', key: 'objective', label: 'FU.Objective', fallback: 'Objective', icon: 'ra ra-targeted' },
];

/** getActionCategories: submenu categories only when the actor has items for them,
 *  then the four universal FU system actions. Pure. */
export function fuActionCategories(actor) {
	const cats = [];
	const cat = (id, label, icon) => ({ id, label, icon, type: 'submenu', systemId: SYSTEM_ID });
	if (itemsOfType(actor, 'weapon', 'customWeapon', 'basic').length) cats.push(cat('attacks', L('FU.Attack', 'Attacks'), 'ra ra-crossed-swords'));
	if (itemsOfType(actor, 'spell').length) cats.push(cat('spells', L('FU.Spell', 'Spells'), 'ra ra-crystal-wand'));
	if (classSkillItems(actor).length) cats.push(cat('skills', L('RIPPERS.SAH.Skills', 'Skills & Features'), 'ra ra-trophy'));
	if (inventoryItems(actor).length) cats.push(cat('inventory', L('FU.Inventory', 'Inventory'), 'ra ra-ammo-bag'));
	// Arcana is Arcanist-only: it appears ONLY when the actor holds an Arcanum item
	// (i.e. an Arcanist), and is absent for every other actor.
	if (arcanaItems(actor).length) cats.push(cat('arcana', L('RIPPERS.SAH.Arcana', 'Arcana'), 'fa-solid fa-hand-sparkles'));
	if (guiseItems(actor).length) cats.push(cat('guise', L('RIPPERS.SAH.Guises', 'Guises'), 'fa-solid fa-mask'));
	// The four FU system actions, always available (community-assets layout).
	for (const s of SYSTEM_ACTIONS) cats.push({ id: s.id, label: L(s.label, s.fallback), icon: s.icon, type: 'system' });
	return cats;
}

const asItem = (i) => ({ id: ID.item(i.id), name: i.name, img: i.img });
/** An inventory entry, with an IP cost string when the consumable carries one. */
function asInventoryItem(i) {
	const ip = Number(getProp(i, 'system.ipCost.value') ?? 0) || 0;
	return { id: ID.item(i.id), name: i.name, img: i.img, description: getProp(i, 'system.description') || '', cost: ip ? `${ip} IP` : null };
}

/** getSubMenuData: build the item list for one category. Pure. */
export function fuSubmenu(actor, categoryId) {
	switch (categoryId) {
		case 'attacks':
			return { title: L('FU.Attack', 'Attacks'), items: itemsOfType(actor, 'weapon', 'customWeapon', 'basic').map(asItem) };
		case 'spells':
			return { title: L('FU.Spell', 'Spells'), items: itemsOfType(actor, 'spell').map(asItem) };
		case 'skills':
			return { title: L('RIPPERS.SAH.Skills', 'Skills & Features'), items: classSkillItems(actor).map(asItem) };
		case 'inventory':
			return { title: L('FU.Inventory', 'Inventory'), items: inventoryItems(actor).map(asInventoryItem) };
		case 'arcana': {
			// Each Arcanum offers two actions: Pulse and Dismiss.
			const items = [];
			for (const a of arcanaItems(actor)) {
				items.push({ id: ID.arcanaPulse(a.id), name: `${a.name}: Pulse`, img: a.img });
				items.push({ id: ID.arcanaDismiss(a.id), name: `${a.name}: Dismiss`, img: a.img });
			}
			return { title: L('RIPPERS.SAH.Arcana', 'Arcana'), items };
		}
		case 'guise':
			return { title: L('RIPPERS.SAH.Guises', 'Guises'), items: guiseItems(actor).map((g) => ({ id: ID.guise(g.id), name: g.name, img: g.img })) };
		default:
			return { title: '', items: [] };
	}
}
/** The category ids this adapter handles itself (others fall through to super). */
export const HANDLED_CATEGORIES = new Set(['attacks', 'spells', 'skills', 'inventory', 'arcana', 'guise']);

// =============================================================================
// Action execution (runtime — routes to the FU roll / our module APIs)
// =============================================================================

/** Best-effort activation of a Foundry Item across FU versions: roll() -> use() -> open sheet. */
async function activateItem(item) {
	if (!item) return;
	try {
		if (typeof item.roll === 'function') return await item.roll();   // FU's item roll/use path
		if (typeof item.use === 'function') return await item.use();
		return item.sheet?.render(true);
	} catch (err) { console.error(`[${MODULE_ID}] activateItem failed`, err); }
}

/** Post an Arcanum's pulse/dismiss text to chat (fallback when the item has no direct roll). */
async function postArcanaText(actor, item, which) {
	const text = getProp(item, `system.data.${which}`) || '';
	const label = which === 'pulse' ? 'Pulse' : 'Dismiss';
	try {
		await activateItem(item);
		if (text && globalThis.ChatMessage?.create) {
			await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ actor }), content: `<strong>${item.name} — ${label}</strong><p>${text}</p>` });
		}
	} catch (err) { console.error(`[${MODULE_ID}] postArcanaText failed`, err); }
}

/** Run a Fabula Ultima system action through the system's own handler (community pattern):
 *  Study via projectfu.StudyRollHandler, the rest via projectfu.ActionHandler. Runtime. */
async function runSystemAction(actor, key) {
	const pfu = globalThis.projectfu;
	try {
		if (key === 'study' && pfu?.StudyRollHandler) return await new pfu.StudyRollHandler(actor).handleStudyRoll();
		if (pfu?.ActionHandler) return await new pfu.ActionHandler(actor).handleAction(key, false);
		console.warn(`[${MODULE_ID}] no Project FU handler available for system action "${key}".`);
	} catch (err) { console.error(`[${MODULE_ID}] system action "${key}" failed`, err); }
}

/** executeAction: route a namespaced action id to the right behaviour. Runtime. */
export async function fuExecuteAction(actor, actionId) {
	const raw = String(actionId ?? '');
	// FU system actions use the community "action.<name>" id (dot); route them first.
	if (raw.startsWith('action.')) return runSystemAction(actor, raw.slice('action.'.length));
	const [kind, a] = raw.split(':');
	switch (kind) {
		case 'item': return activateItem(actor?.items?.get(a));
		case 'arcana-pulse': return postArcanaText(actor, actor?.items?.get(a), 'pulse');
		case 'arcana-dismiss': return postArcanaText(actor, actor?.items?.get(a), 'dismiss');
		case 'guise': {
			// Route to the rippers-guise API when present (bind/activate the guise), else open it.
			const item = actor?.items?.get(a);
			const api = globalThis.game?.modules?.get?.('rippers-guise')?.api;
			try {
				if (api?.setActiveGuise) return await api.setActiveGuise(actor, item);
				if (api?.bindGuise) return await api.bindGuise(actor, item);
			} catch (err) { console.error(`[${MODULE_ID}] guise action failed`, err); }
			return item?.sheet?.render(true);
		}
		default: return activateItem(actor?.items?.get(a));
	}
}

/** useItem: SAH calls this for a plain item click. Runtime. */
export async function fuUseItem(actor, itemId) {
	const [, id] = String(itemId ?? '').split(':');
	return activateItem(actor?.items?.get(id ?? itemId));
}

// =============================================================================
// The adapter factory + registration (community convention)
// =============================================================================

/** Build the adapter class on top of SAH's BaseSystemAdapter (or Object as a fallback). */
export function createProjectFUAdapter(Base = Object) {
	return class RippersFuAdapter extends Base {
		constructor() { super(); this.systemId = SYSTEM_ID; }
		getStats(actor, configAttributes) { return fuStats(actor, configAttributes); }
		getConditions(actor) { return fuConditions(actor); }
		getActionCategories(actor) { return fuActionCategories(actor); }
		async getSubMenuData(actor, categoryId) {
			if (!HANDLED_CATEGORIES.has(categoryId) && typeof super.getSubMenuData === 'function') {
				return super.getSubMenuData(actor, categoryId);
			}
			return fuSubmenu(actor, categoryId);
		}
		async executeAction(actor, actionId) { return fuExecuteAction(actor, actionId); }
		async useItem(actor, itemId) {
			if (String(itemId).startsWith('macro-') && typeof super.useItem === 'function') return super.useItem(actor, itemId);
			return fuUseItem(actor, itemId);
		}
		getDefaultAttributes() { return DEFAULT_ATTRIBUTES; }
	};
}
// Test/back-compat alias.
export const makeAdapter = () => createProjectFUAdapter(Object);

/** Register with SAH once its API is ready. Guarded so an absent/old SAH never throws. */
export function registerWithSAH(api) {
	if (!api?.registerSystemAdapter) return false;
	// Community convention: extend api.BaseSystemAdapter when present (gives super.*
	// fallbacks); otherwise fall back to a standalone class so registration still works.
	const Base = api.BaseSystemAdapter ?? Object;
	const Adapter = createProjectFUAdapter(Base);
	try {
		api.registerSystemAdapter(SYSTEM_ID, Adapter, {
			priority: 100, source: MODULE_ID,
			isCompatible: (ctx) => (ctx?.system?.id ?? globalThis.game?.system?.id) === SYSTEM_ID,
		});
		api.registerDefaultAttributes?.(SYSTEM_ID, DEFAULT_ATTRIBUTES, { source: MODULE_ID });
		api.registerTheme?.('rippers-blood', {
			label: 'Rippers (Blood)',
			defaults: { scale: 1, format: 'box', nameZ: 5, barsZ: 5, dotsZ: 5, numbersZ: 5, badgesZ: 150 },
		});
		console.log(`[${MODULE_ID}] registered projectfu adapter with Stylish Action HUD.`);
		return true;
	} catch (err) {
		console.error(`[${MODULE_ID}] SAH registration failed`, err);
		return false;
	}
}

// Live wiring: only runs in Foundry (Hooks present). Harmless in headless tests.
if (typeof globalThis.Hooks?.once === 'function') {
	globalThis.Hooks.once('stylish-action-hud.apiReady', (api) => registerWithSAH(api));
}

export { MODULE_ID, SYSTEM_ID, DEFAULT_ATTRIBUTES, ARCANUM_FEATURE, GUISE_FEATURE, ID };

/* =============================================================================
 * rippers-stylish-hud.mjs
 * -----------------------------------------------------------------------------
 * A bridge module that registers a Fabula Ultima (projectfu) SYSTEM ADAPTER with
 * the "Stylish Action HUD" (SAH) module, so the party HUD and action menu know how
 * to read a Project FU actor — INCLUDING our custom item types (Arcana and Guises).
 *
 * VERIFIED against the free reference integrations' real source (not guessed):
 *   - CalielBR/sf2e-stylish-action-hud-integration  (stylish-bridge-sf2e)
 *   - swade-StylishActionHud-integration
 * The registration hook + adapter interface both come from those working modules:
 *   Hooks.once("stylish-action-hud.apiReady", api => api.registerSystemAdapter(id, Class))
 *   adapter methods: getStats / getConditions / getActionCategories / getSubMenuData
 *                    (+ executeAction / useItem, optional getDefaultAttributes)
 * SAH itself is a Patreon module; this bridge only needs its public adapter API and
 * loads harmlessly (no-ops) if SAH is absent. NO Project FU fork.
 *
 * SCOPE (Austin, LOCKED 2026-08-25):
 *   - Party HUD tracks: HP / MP / IP bars + status-condition icons. Nothing else
 *     (NOT Fabula/Ultima points, NOT zenit).
 *   - Action menu: core FU (attacks/weapons, spells, class skills/features) PLUS
 *     Arcana (pulse/dismiss, Arcanist-only — shown only for actors that hold an
 *     Arcanum item) and Guises. (Clots are NOT a menu category — Austin, 2026-08-26;
 *     their mechanical effects still ride on the host weapon/armor.)
 *
 * The mapping logic lives in PURE, exported helpers so it is unit-testable headless
 * (no SAH, no Foundry runtime needed). The adapter class + registration are thin
 * wrappers the live game calls.
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
	item:        (id) => `item:${id}`,
	arcanaPulse: (id) => `arcana-pulse:${id}`,
	arcanaDismiss: (id) => `arcana-dismiss:${id}`,
	guise:       (id) => `guise:${id}`,
};

// --- tiny pure path getter (no foundry.utils dependency -> unit-testable) -----
function getProp(obj, path) {
	if (obj == null || !path) return undefined;
	return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
const clampPercent = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const itemsOf = (actor) => Array.from(actor?.items ?? []);
const itemsOfType = (actor, ...types) => itemsOf(actor).filter((i) => types.includes(i?.type));

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

/** Regular class skills/features — classFeatures that are NOT our Arcana or Guise features. Pure. */
export function classSkillItems(actor) {
	return itemsOf(actor).filter((i) =>
		i?.type === 'skill' || i?.type === 'heroic'
		|| (i?.type === 'classFeature' && i?.system?.featureType !== ARCANUM_FEATURE && i?.system?.featureType !== GUISE_FEATURE));
}

// =============================================================================
// Action menu — categories + submenu data
// =============================================================================

/** getActionCategories: only surface a category when the actor actually has items for it. Pure. */
export function fuActionCategories(actor) {
	const cats = [];
	const cat = (id, label, icon) => ({ id, label, icon, type: 'submenu', systemId: SYSTEM_ID });
	if (itemsOfType(actor, 'weapon', 'customWeapon', 'basic').length) cats.push(cat('attacks', 'Attacks', 'ra ra-crossed-swords'));
	if (itemsOfType(actor, 'spell').length) cats.push(cat('spells', 'Spells', 'ra ra-crystal-wand'));
	if (classSkillItems(actor).length) cats.push(cat('skills', 'Skills & Features', 'ra ra-trophy'));
	// Arcana is Arcanist-only: it appears ONLY when the actor holds an Arcanum item
	// (i.e. an Arcanist), and is absent for every other actor.
	if (arcanaItems(actor).length) cats.push(cat('arcana', 'Arcana', 'fa-solid fa-hand-sparkles'));
	if (guiseItems(actor).length) cats.push(cat('guise', 'Guises', 'fa-solid fa-mask'));
	return cats;
}

const asItem = (i) => ({ id: ID.item(i.id), name: i.name, img: i.img });

/** getSubMenuData: build the item list for one category. Pure. */
export function fuSubmenu(actor, categoryId) {
	switch (categoryId) {
		case 'attacks':
			return { title: 'Attacks', items: itemsOfType(actor, 'weapon', 'customWeapon', 'basic').map(asItem) };
		case 'spells':
			return { title: 'Spells', items: itemsOfType(actor, 'spell').map(asItem) };
		case 'skills':
			return { title: 'Skills & Features', items: classSkillItems(actor).map(asItem) };
		case 'arcana': {
			// Each Arcanum offers two actions: Pulse and Dismiss.
			const items = [];
			for (const a of arcanaItems(actor)) {
				items.push({ id: ID.arcanaPulse(a.id), name: `${a.name}: Pulse`, img: a.img });
				items.push({ id: ID.arcanaDismiss(a.id), name: `${a.name}: Dismiss`, img: a.img });
			}
			return { title: 'Arcana', items };
		}
		case 'guise':
			return { title: 'Guises', items: guiseItems(actor).map((g) => ({ id: ID.guise(g.id), name: g.name, img: g.img })) };
		default:
			return { title: '', items: [] };
	}
}

// =============================================================================
// Action execution (runtime — routes to the FU roll / our module APIs)
// =============================================================================

/** Best-effort activation of a Foundry Item across FU versions: use() -> roll() -> open sheet. */
async function activateItem(item) {
	if (!item) return;
	try {
		if (typeof item.use === 'function') return await item.use();
		if (typeof item.roll === 'function') return await item.roll();
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

/** executeAction: route a namespaced action id to the right behaviour. Runtime. */
export async function fuExecuteAction(actor, actionId) {
	const [kind, a, b] = String(actionId ?? '').split(':');
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
// The adapter + registration
// =============================================================================
export function makeAdapter() {
	return class RippersFuAdapter {
		constructor() { this.systemId = SYSTEM_ID; }
		getStats(actor, configAttributes) { return fuStats(actor, configAttributes); }
		getConditions(actor) { return fuConditions(actor); }
		getActionCategories(actor) { return fuActionCategories(actor); }
		async getSubMenuData(actor, categoryId) { return fuSubmenu(actor, categoryId); }
		async executeAction(actor, actionId) { return fuExecuteAction(actor, actionId); }
		async useItem(actor, itemId) { return fuUseItem(actor, itemId); }
		getDefaultAttributes() { return DEFAULT_ATTRIBUTES; }
	};
}

/** Register with SAH once its API is ready. Guarded so an absent/old SAH never throws. */
export function registerWithSAH(api) {
	if (!api) return false;
	const Adapter = makeAdapter();
	try {
		api.registerSystemAdapter?.(SYSTEM_ID, Adapter, {
			priority: 100, source: MODULE_ID,
			isCompatible: (ctx) => (ctx?.system?.id ?? globalThis.game?.system?.id) === SYSTEM_ID,
		});
		api.registerDefaultAttributes?.(SYSTEM_ID, DEFAULT_ATTRIBUTES, { source: MODULE_ID });
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

/**
 * rippers-stylish-hud — headless tests for the PURE adapter mapping (no SAH, no
 * Foundry runtime). Covers the party-HUD stats/conditions and the action-menu
 * categories/submenus, including the custom Arcana / Clot / Guise item types and
 * Austin's scope lock (HP/MP/IP only; Arcana & Guise not double-listed under Skills).
 * Run: `npm test` (node --test test/*.test.mjs) from the module root.
 *
 * No globals are shimmed: the module only registers its Foundry hook when
 * globalThis.Hooks.once exists, which it doesn't here — so a bare import is inert.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
	fuStats, fuConditions, fuActionCategories, fuSubmenu, fuExecuteAction,
	arcanaItems, guiseItems, classSkillItems, inventoryItems, SYSTEM_ACTIONS,
	registerWithSAH, makeAdapter, createProjectFUAdapter, DEFAULT_ATTRIBUTES, SYSTEM_ID,
} = await import('../scripts/rippers-stylish-hud.mjs');

// --- fake actor builder -------------------------------------------------------
const item = (type, name, extra = {}) => ({ id: `${type}-${name}`.replace(/\s+/g, '_'), name, img: `icons/${name}.webp`, type, system: {}, ...extra });
const feature = (name, featureType) => item('classFeature', name, { system: { featureType } });
function actor({ hp = [45, 100], mp = [10, 30], ip = [3, 6], items = [], effects = [] } = {}) {
	return {
		system: { resources: { hp: { value: hp[0], max: hp[1] }, mp: { value: mp[0], max: mp[1] }, ip: { value: ip[0], max: ip[1] } } },
		items,
		temporaryEffects: effects,
	};
}

// --- party HUD: stats ---------------------------------------------------------
test('fuStats returns exactly HP/MP/IP bars with value/max/percent (Austin lock)', () => {
	const s = fuStats(actor(), null);
	assert.deepEqual(s.map((x) => x.label), ['HP', 'MP', 'IP']);
	const hp = s[0];
	assert.equal(hp.value, 45); assert.equal(hp.max, 100); assert.equal(hp.percent, 45);
	assert.equal(hp.style, 'bar'); assert.equal(hp.subtype, 'resource'); assert.equal(hp.color, '#c8102a');
	// percent is clamped and safe when max is 0
	const zero = fuStats(actor({ mp: [5, 0] }), null)[1];
	assert.equal(zero.percent, 0);
});

test('fuStats honours a caller-supplied config attribute list', () => {
	const s = fuStats(actor(), [{ path: 'system.resources.ip', label: 'IP', maxPath: 'system.resources.ip.max' }]);
	assert.equal(s.length, 1);
	assert.equal(s[0].label, 'IP'); assert.equal(s[0].value, 3); assert.equal(s[0].max, 6); assert.equal(s[0].percent, 50);
});

// --- party HUD: conditions ----------------------------------------------------
test('fuConditions maps temporaryEffects and drops icon-less ones', () => {
	const a = actor({ effects: [
		{ id: 'poisoned', name: 'Poisoned', img: 'icons/svg/poison.svg' },
		{ name: 'Weak', icon: 'icons/weak.webp' },
		{ name: 'NoIcon', img: '' },        // dropped: no usable icon
	] });
	const c = fuConditions(a);
	assert.deepEqual(c.map((x) => x.name), ['Poisoned', 'Weak']);
	assert.equal(c[0].src, 'icons/svg/poison.svg');
});

// --- detectors ----------------------------------------------------------------
test('custom-item detectors discriminate Arcana / Guise by their real markers', () => {
	const a = actor({ items: [
		feature('Agares', 'projectfu.arcanum'),
		feature('The Wolf', 'rippers-guise.guise'),
		feature('Bone Deep', 'some.other'),   // a plain class feature
		item('skill', 'Rage'),
	] });
	assert.deepEqual(arcanaItems(a).map((i) => i.name), ['Agares']);
	assert.deepEqual(guiseItems(a).map((i) => i.name), ['The Wolf']);
	// classSkillItems includes skill + plain classFeature, but NOT arcana/guise features
	const names = classSkillItems(a).map((i) => i.name).sort();
	assert.deepEqual(names, ['Bone Deep', 'Rage']);
});

// --- action categories --------------------------------------------------------
test('fuActionCategories: item categories gated + no double-listing/Clots, then the 4 system actions', () => {
	// an item-less actor still gets the four universal system actions
	assert.deepEqual(fuActionCategories(actor()).map((c) => c.id),
		['action.guard', 'action.study', 'action.hinder', 'action.objective']);
	const full = fuActionCategories(actor({ items: [
		item('weapon', 'Sabre'), item('spell', 'Flare'), item('skill', 'Study'),
		item('consumable', 'Health Tonic'),
		feature('Agares', 'projectfu.arcanum'), feature('The Wolf', 'rippers-guise.guise'),
	] }));
	assert.deepEqual(full.map((c) => c.id),
		['attacks', 'spells', 'skills', 'inventory', 'arcana', 'guise', 'action.guard', 'action.study', 'action.hinder', 'action.objective']);
	assert.ok(!full.some((c) => c.id === 'clots'), 'Clots must never be a category');
	// submenu categories carry systemId; system actions are type 'system'
	full.filter((c) => c.type === 'submenu').forEach((c) => assert.equal(c.systemId, SYSTEM_ID));
	full.filter((c) => c.id.startsWith('action.')).forEach((c) => assert.equal(c.type, 'system'));
});

test('the four FU system actions register and fire through the Project FU handler', () => {
	assert.deepEqual(SYSTEM_ACTIONS.map((s) => s.key), ['guard', 'study', 'hinder', 'objective']);
	// shim the projectfu system API and confirm each action routes to the right handler
	const calls = [];
	globalThis.projectfu = {
		StudyRollHandler: class { constructor(a) { this.a = a; } handleStudyRoll() { calls.push(['study-handler']); } },
		ActionHandler: class { constructor(a) { this.a = a; } handleAction(k, b) { calls.push(['action-handler', k, b]); } },
	};
	const a = actor();
	fuExecuteAction(a, 'action.study');
	fuExecuteAction(a, 'action.guard');
	fuExecuteAction(a, 'action.hinder');
	fuExecuteAction(a, 'action.objective');
	assert.deepEqual(calls, [
		['study-handler'],
		['action-handler', 'guard', false],
		['action-handler', 'hinder', false],
		['action-handler', 'objective', false],
	]);
	delete globalThis.projectfu;
});

test('Arcana is Arcanist-gated: absent without an Arcanum item, present with one', () => {
	// a non-Arcanist (weapon, spell, guise — but no Arcanum) never gets the Arcana category
	const nonArcanist = fuActionCategories(actor({ items: [
		item('weapon', 'Sabre'), item('spell', 'Flare'), feature('The Wolf', 'rippers-guise.guise'),
	] }));
	assert.ok(!nonArcanist.some((c) => c.id === 'arcana'), 'non-Arcanist must not see Arcana');
	// an Arcanist (holds an Arcanum item) does
	const arcanist = fuActionCategories(actor({ items: [feature('Agares', 'projectfu.arcanum')] }));
	assert.ok(arcanist.some((c) => c.id === 'arcana'), 'Arcanist must see Arcana');
});

// --- submenus -----------------------------------------------------------------
test('fuSubmenu builds items per category, Arcana gets a Pulse + Dismiss pair, Clots gone', () => {
	const host = item('customWeapon', 'Aether Blade');
	const a = actor({ items: [
		item('weapon', 'Sabre'), item('spell', 'Flare'),
		feature('Agares', 'projectfu.arcanum'), feature('The Wolf', 'rippers-guise.guise'), host,
	] });
	// the customWeapon host is legitimately an attack alongside plain weapons
	assert.deepEqual(fuSubmenu(a, 'attacks').items.map((i) => i.name), ['Sabre', 'Aether Blade']);
	assert.deepEqual(fuSubmenu(a, 'spells').items.map((i) => i.name), ['Flare']);
	const arc = fuSubmenu(a, 'arcana');
	assert.deepEqual(arc.items.map((i) => i.name), ['Agares: Pulse', 'Agares: Dismiss']);
	assert.match(arc.items[0].id, /^arcana-pulse:/);
	assert.match(arc.items[1].id, /^arcana-dismiss:/);
	assert.deepEqual(fuSubmenu(a, 'guise').items.map((i) => i.name), ['The Wolf']);
	// Clots is no longer a category — its submenu resolves to the empty default
	assert.deepEqual(fuSubmenu(a, 'clots'), { title: '', items: [] });
	assert.deepEqual(fuSubmenu(a, 'nope'), { title: '', items: [] });
});

// --- inventory (v0.1.1) -------------------------------------------------------
test('Inventory = consumables; category gated, submenu carries IP cost, fires by item id', () => {
	const bare = actor({ items: [item('weapon', 'Sabre')] });
	assert.ok(!fuActionCategories(bare).some((c) => c.id === 'inventory'), 'no consumables -> no Inventory category');
	const a = actor({ items: [
		item('consumable', 'Health Tonic', { system: { ipCost: { value: 3 }, description: 'Restores HP.' } }),
		item('consumable', 'Free Ration', { system: {} }),      // no IP cost
	] });
	assert.deepEqual(inventoryItems(a).map((i) => i.name), ['Health Tonic', 'Free Ration']);
	const sub = fuSubmenu(a, 'inventory');
	assert.equal(sub.items[0].name, 'Health Tonic');
	assert.equal(sub.items[0].cost, '3 IP');
	assert.equal(sub.items[1].cost, null);                    // no cost -> null, not "0 IP"
	assert.match(sub.items[0].id, /^item:/);                  // fires via the generic item path
});

// --- registration -------------------------------------------------------------
test('registerWithSAH registers the adapter + defaults + theme, and no-ops on a missing api', () => {
	const calls = { adapter: null, attrs: null, theme: null };
	class FakeBase { constructor() { this.base = true; } getSubMenuData() { return { title: 'super', items: [] }; } }
	const fakeApi = {
		BaseSystemAdapter: FakeBase,
		registerSystemAdapter: (id, Cls, opts) => { calls.adapter = { id, Cls, opts }; },
		registerDefaultAttributes: (id, data) => { calls.attrs = { id, data }; },
		registerTheme: (id, cfg) => { calls.theme = { id, cfg }; },
	};
	assert.equal(registerWithSAH(fakeApi), true);
	assert.equal(calls.adapter.id, SYSTEM_ID);
	assert.equal(calls.attrs.id, SYSTEM_ID);
	assert.equal(calls.attrs.data, DEFAULT_ATTRIBUTES);
	assert.equal(calls.theme.id, 'rippers');            // theme key -> CSS class .theme-rippers (SPEC)
	assert.equal(calls.theme.cfg.label, 'Rippers Unmasked');
	// community convention: the adapter EXTENDS SAH's BaseSystemAdapter
	const inst = new calls.adapter.Cls();
	assert.ok(inst instanceof FakeBase, 'adapter should extend api.BaseSystemAdapter');
	assert.equal(inst.systemId, SYSTEM_ID);
	for (const m of ['getStats', 'getConditions', 'getActionCategories', 'getSubMenuData', 'executeAction', 'useItem']) {
		assert.equal(typeof inst[m], 'function', `adapter missing ${m}`);
	}
	assert.equal(registerWithSAH(null), false);         // missing api -> safe no-op
	assert.equal(registerWithSAH({}), false);           // api without registerSystemAdapter -> no-op
});

test('makeAdapter() is a standalone adapter (no SAH base needed) implementing the interface', () => {
	const inst = new (makeAdapter())();
	assert.equal(inst.systemId, SYSTEM_ID);
	for (const m of ['getStats', 'getConditions', 'getActionCategories', 'getSubMenuData', 'executeAction', 'useItem']) {
		assert.equal(typeof inst[m], 'function');
	}
});

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
	fuStats, fuConditions, fuActionCategories, fuSubmenu,
	arcanaItems, guiseItems, clotItems, classSkillItems,
	registerWithSAH, makeAdapter, DEFAULT_ATTRIBUTES, SYSTEM_ID,
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
test('custom-item detectors discriminate Arcana / Guise / Clots by their real markers', () => {
	const host = item('customWeapon', 'Aether Blade', { system: { slotted: [item('hoplosphere', 'Ember Clot')] } });
	const a = actor({ items: [
		feature('Agares', 'projectfu.arcanum'),
		feature('The Wolf', 'rippers-guise.guise'),
		feature('Bone Deep', 'some.other'),   // a plain class feature
		item('skill', 'Rage'),
		host,
	] });
	assert.deepEqual(arcanaItems(a).map((i) => i.name), ['Agares']);
	assert.deepEqual(guiseItems(a).map((i) => i.name), ['The Wolf']);
	assert.equal(clotItems(a).length, 1);
	assert.equal(clotItems(a)[0].host.name, 'Aether Blade');
	// classSkillItems includes skill + plain classFeature, but NOT arcana/guise features
	const names = classSkillItems(a).map((i) => i.name).sort();
	assert.deepEqual(names, ['Bone Deep', 'Rage']);
});

// --- action categories --------------------------------------------------------
test('fuActionCategories only surfaces categories the actor has, no double-listing', () => {
	const empty = fuActionCategories(actor());
	assert.deepEqual(empty, []);                       // no items -> no categories
	const host = item('armor', 'Plated Coat', { system: { slotted: [item('hoplosphere', 'Iron Clot')] } });
	const full = fuActionCategories(actor({ items: [
		item('weapon', 'Sabre'), item('spell', 'Flare'), item('skill', 'Study'),
		feature('Agares', 'projectfu.arcanum'), feature('The Wolf', 'rippers-guise.guise'), host,
	] }));
	assert.deepEqual(full.map((c) => c.id), ['attacks', 'spells', 'skills', 'arcana', 'clots', 'guise']);
	full.forEach((c) => { assert.equal(c.type, 'submenu'); assert.equal(c.systemId, SYSTEM_ID); });
});

// --- submenus -----------------------------------------------------------------
test('fuSubmenu builds items per category, Arcana gets a Pulse + Dismiss pair', () => {
	const host = item('customWeapon', 'Aether Blade', { system: { slotted: [item('hoplosphere', 'Ember Clot')] } });
	const a = actor({ items: [
		item('weapon', 'Sabre'), item('spell', 'Flare'),
		feature('Agares', 'projectfu.arcanum'), feature('The Wolf', 'rippers-guise.guise'), host,
	] });
	// the customWeapon host is legitimately an attack too, alongside its Clots below
	assert.deepEqual(fuSubmenu(a, 'attacks').items.map((i) => i.name), ['Sabre', 'Aether Blade']);
	assert.deepEqual(fuSubmenu(a, 'spells').items.map((i) => i.name), ['Flare']);
	const arc = fuSubmenu(a, 'arcana');
	assert.deepEqual(arc.items.map((i) => i.name), ['Agares: Pulse', 'Agares: Dismiss']);
	assert.match(arc.items[0].id, /^arcana-pulse:/);
	assert.match(arc.items[1].id, /^arcana-dismiss:/);
	const clot = fuSubmenu(a, 'clots');
	assert.equal(clot.items[0].name, 'Ember Clot — Aether Blade');
	assert.match(clot.items[0].id, /^clot:/);
	assert.deepEqual(fuSubmenu(a, 'guise').items.map((i) => i.name), ['The Wolf']);
	assert.deepEqual(fuSubmenu(a, 'nope'), { title: '', items: [] });
});

// --- registration -------------------------------------------------------------
test('registerWithSAH registers the adapter + defaults, and no-ops on a missing api', () => {
	const calls = { adapter: null, attrs: null };
	const fakeApi = {
		registerSystemAdapter: (id, Cls) => { calls.adapter = { id, Cls }; },
		registerDefaultAttributes: (id, data) => { calls.attrs = { id, data }; },
	};
	assert.equal(registerWithSAH(fakeApi), true);
	assert.equal(calls.adapter.id, SYSTEM_ID);
	assert.equal(calls.attrs.id, SYSTEM_ID);
	assert.equal(calls.attrs.data, DEFAULT_ATTRIBUTES);
	// the registered class implements the SAH adapter interface
	const inst = new calls.adapter.Cls();
	for (const m of ['getStats', 'getConditions', 'getActionCategories', 'getSubMenuData', 'executeAction', 'useItem']) {
		assert.equal(typeof inst[m], 'function', `adapter missing ${m}`);
	}
	assert.equal(inst.systemId, SYSTEM_ID);
	assert.equal(registerWithSAH(null), false);         // missing api -> safe no-op
});

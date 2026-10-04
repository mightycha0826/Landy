import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/motion.ts', import.meta.url), 'utf8'));
const { settle, rubberBand, navigationMotion, motionDuration, scrollBehavior } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('everyday spring reaches its target with a quiet, bounded overshoot', () => {
	assert.equal(settle(0), 0);
	assert.equal(settle(1), 1);
	const values = Array.from({ length: 1001 }, (_, i) => settle(i / 1000));
	assert(values.every(Number.isFinite));
	assert(Math.min(...values) >= 0);
	assert(Math.max(...values) > 1 && Math.max(...values) < 1.02);
	assert(Math.abs(settle(0.8) - 1) < 0.001);
});

test('pull resistance never reverses on a long drag', () => {
	let previous = 0;
	for (let distance = 0; distance <= 5000; distance += 5) {
		const next = rubberBand(distance, 120);
		assert(next >= previous && next <= 120);
		previous = next;
	}
	assert.equal(rubberBand(-100, 120), 0);
	assert(rubberBand(220, 120) >= 72);
});

test('navigation follows tab order, parents, and real history direction', () => {
	assert.equal(navigationMotion('/letters', '/me'), 'tab-right');
	assert.equal(navigationMotion('/me', '/'), 'tab-left');
	assert.equal(navigationMotion('/me', '/me/achievements'), 'push');
	assert.equal(navigationMotion('/me/achievements/submit', '/me/achievements'), 'pop');
	assert.equal(navigationMotion('/settings', '/chat/room', -1), 'pop');
	assert.equal(navigationMotion('/chat/room', '/settings', 1), 'push');
	assert.equal(navigationMotion('/letters/new', '/letters/archive'), 'fade');
	assert.equal(navigationMotion('/letters', '/letters'), 'fade');
});

test('OS and app reduced-motion preferences both disable JS motion and smooth scroll', () => {
	const originalDocument = globalThis.document, originalMatchMedia = globalThis.matchMedia;
	try {
		globalThis.document = { documentElement: { dataset: {} } };
		globalThis.matchMedia = () => ({ matches: false });
		assert.equal(motionDuration(360), 360);
		assert.equal(scrollBehavior(), 'smooth');
		globalThis.document.documentElement.dataset.motion = 'reduce';
		assert.equal(motionDuration(360), 0);
		assert.equal(scrollBehavior(), 'auto');
		delete globalThis.document.documentElement.dataset.motion;
		globalThis.matchMedia = () => ({ matches: true });
		assert.equal(motionDuration(360), 0);
		assert.equal(scrollBehavior(), 'auto');
	} finally {
		if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
		if (originalMatchMedia === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = originalMatchMedia;
	}
});

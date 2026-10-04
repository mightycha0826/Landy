import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { ROOT, CHROME } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';

const PORT = 5201;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
vite.stdout.on('data', (data) => output += data);
vite.stderr.on('data', (data) => output += data);
let browser;
try {
	for (let i = 0; i < 120 && !output.includes('ready') && vite.exitCode === null; i++) await new Promise((r) => setTimeout(r, 500));
	assert(output.includes('ready'), output);
	browser = await chromium.launch({ executablePath: CHROME });
	const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error)));
	const waitChat = async (query = '') => {
		await page.goto(`${BASE}/dev/chat?s=chat${query}`);
		await page.locator('.bubble').first().waitFor();
		await page.waitForTimeout(500);
	};
	const transformY = (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
	const moving = (el) => el.getAnimations().some((a) => a.playState === 'running' && Number(a.effect.getTiming().duration) > 1);
	await waitChat();
	assert.equal(await page.locator('.row[data-mid]').first().evaluate(moving), false);
	await page.locator('.composer textarea').fill('새 메시지 모션');
	await page.getByRole('button', { name: '보내기', exact: true }).click();
	const newMessage = page.locator('.row', { has: page.locator('.bubble', { hasText: '새 메시지 모션' }) });
	await newMessage.waitFor();
	assert.equal(await newMessage.evaluate(moving), true);
	await page.waitForTimeout(450);
	assert.equal(await newMessage.evaluate(moving), false);
	console.log('  PASS  기존 기록은 고정, 새 메시지만 등장한 뒤 모션 정리');

	const textarea = page.locator('.composer textarea');
	const before = await textarea.evaluate((el) => el.getBoundingClientRect().height);
	await textarea.fill('첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄');
	assert.equal(await textarea.evaluate(moving), true);
	await page.waitForTimeout(300);
	assert(await textarea.evaluate((el) => el.getBoundingClientRect().height) > before);
	await textarea.fill(Array(20).fill('긴 메시지').join('\n'));
	await page.waitForTimeout(300);
	assert(await textarea.evaluate((el) => el.getBoundingClientRect().height) <= 120);
	console.log('  PASS  입력 높이가 부드럽게 늘어나고 120px 한도 유지');

	await waitChat('&sheet=menu');
	const sheet = page.locator('.sheet');
	await sheet.waitFor();
	await page.waitForTimeout(450);
	let grab = await page.locator('.grab').boundingBox();
	await page.mouse.move(grab.x + grab.width / 2, grab.y + 10);
	await page.mouse.down();
	await page.mouse.move(grab.x + grab.width / 2, grab.y + 50, { steps: 8 });
	assert(await sheet.evaluate(transformY) > 30);
	await page.waitForTimeout(150);
	await page.mouse.up();
	await page.waitForTimeout(450);
	assert.equal(await sheet.count(), 1);
	assert(Math.abs(await sheet.evaluate(transformY)) < 0.1);
	console.log('  PASS  짧게 당겼다 놓으면 현재 위치에서 제자리 복귀');

	grab = await page.locator('.grab').boundingBox();
	await page.mouse.move(grab.x + grab.width / 2, grab.y + 10);
	await page.mouse.down();
	await page.mouse.move(grab.x + grab.width / 2, grab.y + 110, { steps: 5 });
	await sheet.dispatchEvent('pointercancel', { pointerId: 1 });
	await page.mouse.up();
	await page.waitForTimeout(450);
	assert.equal(await sheet.count(), 1);
	assert(Math.abs(await sheet.evaluate(transformY)) < 0.1);
	await page.keyboard.press('Escape');
	await sheet.waitFor({ state: 'detached' });
	console.log('  PASS  포인터 취소로 시트가 닫히지 않고 Esc로 정상 종료');

	const showBanner = () => page.evaluate(async () => {
		const { notifyInApp } = await import('/src/lib/inapp.svelte.ts');
		notifyInApp({ key: 'motion-preview', title: '새벽수달', body: '새 알림', url: '/dev/letters', kind: 'chat' });
	});
	await showBanner();
	await page.locator('.inapp .card').waitFor();
	await page.waitForTimeout(400);
	let card = await page.locator('.inapp .card').boundingBox();
	await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
	await page.mouse.down();
	await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2 + 9, { steps: 3 });
	await page.mouse.up();
	await page.waitForTimeout(400);
	assert.equal(new URL(page.url()).pathname, '/dev/chat');
	assert.equal(await page.locator('.inapp').count(), 1);
	console.log('  PASS  알림을 끌었다 놓은 뒤 합성 클릭으로 화면이 이동하지 않음');
	card = await page.locator('.inapp .card').boundingBox();
	await page.mouse.move(card.x + card.width / 2, card.y + card.height - 10);
	await page.mouse.down();
	await page.mouse.move(card.x + card.width / 2, card.y + card.height - 50, { steps: 3 });
	await page.mouse.up();
	await page.locator('.inapp').waitFor({ state: 'detached' });
	await showBanner();
	await page.waitForTimeout(400);
	assert(Math.abs(await page.locator('.inapp .card').evaluate(transformY)) < 0.1);
	console.log('  PASS  알림 위로 밀기 퇴장, 다음 알림 위치 초기화');

	await page.evaluate(async () => {
		const { setPref } = await import('/src/lib/prefs.svelte.ts');
		setPref('motion', true);
	});
	await textarea.fill('움직임 줄이기\n둘째 줄');
	assert.equal(await textarea.evaluate(moving), false);
	await page.goto(`${BASE}/dev/chat?s=chat&sheet=menu`);
	await page.locator('.sheet').waitFor();
	assert.equal(await page.locator('.sheet').evaluate(moving), false);
	console.log('  PASS  앱의 움직임 줄이기 설정으로 JS·시트 모션 즉시 제거');
	await context.close();

	const reduced = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' });
	const reducedPage = await reduced.newPage();
	reducedPage.on('pageerror', (error) => errors.push(String(error)));
	await reducedPage.goto(`${BASE}/dev/chat?s=chat&sheet=menu`);
	await reducedPage.locator('.sheet').waitFor();
	assert.equal(await reducedPage.locator('.sheet').evaluate(moving), false);
	assert(Math.abs(await reducedPage.locator('.sheet').evaluate(transformY)) < 0.1);
	console.log('  PASS  OS 동작 줄이기, 좁은 화면에서도 시트가 최종 위치에 즉시 표시');
	assert.deepEqual(errors, []);
	console.log('  PASS  브라우저 런타임 오류 없음');
} finally {
	await browser?.close();
	stopProcess(vite);
}

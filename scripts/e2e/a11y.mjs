import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 동작 줄이기 · 화면 낭독기 — /dev/chat 미리보기
const SP = OUT, PORT = 5191;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const browser = await chromium.launch({ executablePath: CHROME });
const U = (p) => `http://localhost:${PORT}${p}`;
try {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
	const page = await ctx.newPage();
	const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
	const bubble = (t) => page.locator('.bubble', { hasText: t });
	const anim = (sel) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el); return { d: c.animationDuration, n: c.animationIterationCount, name: c.animationName }; });

	console.log('[화면 낭독기]');
	await page.goto(U('/dev/chat?s=chat&incoming'));
	await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(400);
	const live = page.locator('.sr-only[aria-live]');
	// 1.2초 뒤 오는 새 메시지(&incoming)는 느린 PC 에서 첫 말풍선보다 먼저 올 수 있다 — 그 안내는 맞는 동작. 지난 대화를 읽지 않는지만 본다
	const first = (await live.innerText()).trim();
	check('들어올 때 지난 대화는 읽지 않는다', first === '' || first === '새벽수달: 방금 온 메시지예요', first);
	await bubble('방금 온 메시지예요').waitFor(); await page.waitForTimeout(200);
	check('상대 새 메시지를 안내', (await live.innerText()).trim() === '새벽수달: 방금 온 메시지예요', await live.innerText());
	check('목록에 이름표', (await page.getByRole('region', { name: '대화 내용' }).count()) === 1);
	const srMine = await bubble('와 진짜요? 반갑네요').locator('.sr-only').innerText();
	const srTheirs = await bubble('공연도 가봤어요?').locator('.sr-only').innerText();
	check('말풍선마다 누가 보냈는지 (낭독기용)', srMine.trim() === '나:' && srTheirs.trim() === '새벽수달:', srMine + '|' + srTheirs);
	const vis = await bubble('공연도 가봤어요?').locator('.sr-only').boundingBox();
	check('그 글은 화면엔 안 보인다', vis.width <= 1 && vis.height <= 1, JSON.stringify(vis));
	// 내가 보낸 건 읽지 않는다
	await page.locator('textarea').fill('내가 보냄'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
	check('내 메시지는 안내하지 않는다', (await live.innerText()).trim() === '새벽수달: 방금 온 메시지예요');

	console.log('[동작 줄이기 꺼짐 = 평소]');
	await page.goto(U('/dev/chat?s=chat&matched'));
	await page.locator('.match').first().waitFor();
	const normal = await page.evaluate(() => [...document.querySelectorAll('*')].map((e) => getComputedStyle(e)).filter((c) => c.animationName !== 'none').map((c) => c.animationDuration));
	check('연결 화면 애니메이션이 돈다', normal.some((d) => parseFloat(d) >= 0.2), normal.join());

	console.log('[동작 줄이기 켜짐]');
	const rctx = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
	const rp = await rctx.newPage(); rp.on('pageerror', (e) => errs.push(String(e)));
	await rp.goto(U('/dev/chat?s=chat&matched'));
	await rp.locator('.bubble', { hasText: '안녕하세요!' }).waitFor();
	const reduced = await rp.evaluate(() => [...document.querySelectorAll('*')].map((e) => getComputedStyle(e)).filter((c) => c.animationName !== 'none').map((c) => c.animationDuration + '/' + c.animationIterationCount));
	check('애니메이션이 사실상 0초', reduced.length > 0 && reduced.every((x) => parseFloat(x) < 0.001 && x.endsWith('/1')), reduced.join());
	await rp.waitForTimeout(1900);
	check('연결 화면은 그래도 닫힌다', (await rp.locator('.match').count()) === 0);
	// 타이핑 점 3개는 멈춘 채로 보인다
	check('타이핑 표시는 남아 있다', (await rp.locator('.typing i').count()) === 3);
	// 답장 인용 → 이동: 즉시 스크롤, 반짝임은 커지지 않고 어두워지기만
	await rp.locator('.list').evaluate((l) => l.scrollTo(0, l.scrollHeight));
	await rp.locator('.quote').first().click();
	await rp.waitForTimeout(50);
	const f = await rp.locator('.bwrap.flash .bubble').evaluate((el) => { const c = getComputedStyle(el); return c.animationName + ' ' + c.animationDuration; });
	check('반짝임: 크기 변화 없는 버전으로 1.2초', /flash-still 1.2s$/.test(f), f);
	const inView = await rp.locator('.bwrap.flash').evaluate((el) => { const r = el.getBoundingClientRect(), l = el.closest('.list').getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom; });
	check('바로 그 자리로 (부드러운 스크롤 없이)', inView);
	await rp.screenshot({ path: `${SP}/a11y-reduced.png` });
	check('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} catch (e) { fail++; console.error(e); }
finally { await browser.close(); stopProcess(vite); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

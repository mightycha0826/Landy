import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 채팅 공감 — /dev/chat 미리보기 (가짜 전송: 상대가 "실리카겔 좋아하세요?"에 ❤️ 를 달아 둔 상태)
const SP = OUT, PORT = 5196;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const browser = await chromium.launch({ executablePath: CHROME });
try {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
	const page = await ctx.newPage();
	const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
	await page.goto(`http://localhost:${PORT}/dev/chat?s=chat`);
	await page.locator('.bubble', { hasText: '안녕하세요!' }).waitFor();
	await page.waitForTimeout(600);
	const bubble = (t) => page.locator('.bubble', { hasText: t });
	const badgeOf = (t) => bubble(t).locator('xpath=following-sibling::button[contains(@class,"reacts")]');
	// 폰에서 손가락으로 길게 누르기 (마우스는 길게 누르기 대신 오른쪽 클릭)
	const cdp = await ctx.newCDPSession(page);
	const longPress = async (t) => {
		const b = await bubble(t).boundingBox();
		const pt = [{ x: b.x + 20, y: b.y + b.height / 2 }];
		// 앞선 고르기 줄의 가림막이 닫히는 연출 중이면 손가락이 말풍선에 닿지 않는다 — 닿을 수 있을 때 누른다
		await page.waitForFunction(({ x, y, t }) => document.elementFromPoint(x, y)?.closest('.bubble')?.textContent.includes(t), { ...pt[0], t }, { timeout: 3000 });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
		await page.waitForTimeout(600);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await page.waitForTimeout(150);
	};

	console.log('[보이기]');
	check('상대가 단 ❤️ 가 내 말풍선 아래에', (await badgeOf('실리카겔 좋아하세요?').innerText()).includes('❤️'));
	const mb = await bubble('실리카겔 좋아하세요?').boundingBox(), bd = await badgeOf('실리카겔 좋아하세요?').boundingBox();
	check('내 말풍선의 공감은 오른쪽 아래 모서리', bd.y > mb.y + mb.height - 12 && bd.x + bd.width > mb.x + mb.width - 40, JSON.stringify({ mb, bd }));
	await page.screenshot({ path: `${SP}/react-1.png` });

	console.log('[두 번 톡 = ❤️]');
	await bubble('헐 저도 좋아해요').dblclick(); await page.waitForTimeout(300);
	check('상대 메시지에 ❤️', (await badgeOf('헐 저도 좋아해요').innerText()).trim() === '❤️');
	const tb = await bubble('헐 저도 좋아해요').boundingBox(), tbd = await badgeOf('헐 저도 좋아해요').boundingBox();
	check('상대 말풍선의 공감은 왼쪽 아래', tbd.x < tb.x + 40, JSON.stringify({ tb, tbd }));
	await bubble('헐 저도 좋아해요').dblclick(); await page.waitForTimeout(300);
	check('다시 두 번 톡 → 취소', (await badgeOf('헐 저도 좋아해요').count()) === 0);

	console.log('[길게 누르기 = 고르기]');
	await longPress('공연도 가봤어요?');
	check('고르기 줄: 공감 6개 + 답장 + 복사', (await page.locator('.rx-pick .rx').count()) === 6 && (await page.locator('.rx-pick .copy').allInnerTexts()).join() === '답장,복사');
	const pk = await page.locator('.rx-pick').boundingBox(), gb = await bubble('공연도 가봤어요?').boundingBox();
	check('말풍선 바로 위에 뜬다', pk.y + pk.height <= gb.y && gb.y - (pk.y + pk.height) < 20, JSON.stringify({ pk, gb }));
	check('화면 밖으로 넘치지 않는다', pk.x >= 0 && pk.x + pk.width <= 390, JSON.stringify(pk));
	await page.screenshot({ path: `${SP}/react-2-picker.png` });
	await page.getByRole('menuitem', { name: '웃겨요' }).click(); await page.waitForTimeout(300);
	check('😂 선택 → 고르기 닫히고 공감 표시', (await page.locator('.rx-pick').count()) === 0 && (await badgeOf('공연도 가봤어요?').innerText()).trim() === '😂');
	await longPress('공연도 가봤어요?');
	check('다시 열면 내 공감이 표시됨', await page.getByRole('menuitem', { name: '웃겨요' }).evaluate((b) => b.classList.contains('on')));
	await page.getByRole('menuitem', { name: '최고예요' }).click(); await page.waitForTimeout(300);
	check('다른 공감으로 바꾸기 (하나만)', (await badgeOf('공연도 가봤어요?').innerText()).trim() === '🔥');

	console.log('[같은 공감 둘 = ❤️ 2]');
	await bubble('실리카겔 좋아하세요?').dblclick(); await page.waitForTimeout(300);
	const both = (await badgeOf('실리카겔 좋아하세요?').innerText()).replace(/\s+/g, '');
	check('둘 다 ❤️ → "❤️2"', both === '❤️2', both);
	await page.screenshot({ path: `${SP}/react-3.png` });

	console.log('[목록이 저절로 움직일 때]');
	// 상대 입력 중 표시가 사라지거나 새 메시지가 오면 목록이 저절로 움직인다 — 고르기 줄은 닫히지 않고 말풍선을 따라간다
	await longPress('와 진짜요? 반갑네요');
	const before = await page.locator('.rx-pick').boundingBox();
	const moved = await page.locator('.list').evaluate(async (l) => {
		const from = l.scrollTop;
		l.scrollTop = from - 30;
		await new Promise((r) => setTimeout(r, 200));
		return from - l.scrollTop;
	});
	const after = await page.locator('.rx-pick').boundingBox();
	check('저절로 움직여도 고르기 줄은 열려 있다', moved > 0 && after != null, `moved=${moved}`);
	check('…그리고 말풍선을 따라 내려간다', after && Math.abs(after.y - before.y - moved) < 2, JSON.stringify({ before, after, moved }));
	// 사람이 목록을 밀려고 손가락을 대면 가림막이 받아서 닫는다
	const lb = await page.locator('.list').boundingBox();
	const at = { x: lb.x + lb.width / 2, y: lb.y + 60 };
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...at, y: at.y + 80 }] });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await page.waitForTimeout(300);
	check('손가락으로 밀면 닫힌다', (await page.locator('.rx-pick').count()) === 0);
	// 말풍선이 화면 밖으로 밀려나면 닫힌다
	await longPress('와 진짜요? 반갑네요');
	await page.locator('.list').evaluate(async (l) => { l.scrollTop = 0; await new Promise((r) => setTimeout(r, 200)); });
	check('말풍선이 화면 밖으로 나가면 닫힌다', (await page.locator('.rx-pick').count()) === 0);
	await page.locator('.list').evaluate((l) => l.scrollTo(0, l.scrollHeight)); await page.waitForTimeout(1100);

	console.log('[복사 · 닫기]');
	await longPress('혹시 요즘 뭐 듣는 노래');
	await page.locator('.rx-pick .copy', { hasText: '복사' }).click(); await page.waitForTimeout(300);
	check('복사', (await page.evaluate(() => navigator.clipboard.readText())) === '혹시 요즘 뭐 듣는 노래 있어요?');
	await longPress('안녕하세요!');
	await page.keyboard.press('Escape'); await page.waitForTimeout(200);
	check('Esc 로 닫힘', (await page.locator('.rx-pick').count()) === 0);
	await longPress('안녕하세요!');
	await page.mouse.click(200, 700); await page.waitForTimeout(200);
	check('바깥을 누르면 닫힘 (공감 안 달림)', (await page.locator('.rx-pick').count()) === 0 && (await badgeOf('안녕하세요!').count()) === 0);
	await bubble('안녕하세요!').click({ button: 'right' }); await page.waitForTimeout(200);
	check('데스크톱: 오른쪽 클릭으로도 열림', (await page.locator('.rx-pick .rx').count()) === 6);
	await page.keyboard.press('Escape');
	await page.mouse.click(200, 400); await page.waitForTimeout(300); // Esc 로 닫힌 고르기 줄이 사라지는 동안(0.12초)을 기다린다
	check('한 번 톡은 아무 일도 없음', (await page.locator('.rx-pick').count()) === 0);
	check('시스템 안내에는 반응 없음', (await page.locator('.sys + .reacts, .sys .reacts').count()) === 0);

	console.log('[끝난 대화]');
	await page.goto(`http://localhost:${PORT}/dev/chat?s=chat&sheet=leave`);
	await page.locator('.bubble', { hasText: '안녕하세요!' }).waitFor(); // 메시지를 받은 뒤에 나간다
	await page.locator('.sheet .item.danger', { hasText: '나가기' }).click();
	await page.waitForTimeout(600);
	check('대화를 나가도 화면에 메시지는 남아 있다', (await page.locator('.bubble').count()) > 3);
	const any = page.locator('.row:not(.mine) .bubble').first();
	const txt = await any.evaluate((el) => [...el.childNodes].filter((n) => !n.classList?.contains('sr-only')).map((n) => n.textContent).join('').trim());
	await any.dblclick(); await page.waitForTimeout(300);
	check('끝난 대화에서는 두 번 톡해도 공감 안 됨', (await badgeOf(txt).count()) === 0);
	await longPress(txt);
	check('길게 누르면 복사만', (await page.locator('.rx-pick .rx').count()) === 0 && (await page.locator('.rx-pick .copy').count()) === 1);
	check('페이지 오류 없음', errs.length === 0, errs.join(' / '));
} finally {
	await browser.close(); stopProcess(vite);

}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

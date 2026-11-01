import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 업적 (Phase 31) — /dev/achievements 미리보기 · 상대 프로필의 대표 업적(/dev/chat)
const SP = OUT, PORT = 5185;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const browser = await chromium.launch({ executablePath: CHROME });
const U = (p) => `http://localhost:${PORT}${p}`;
try {
	const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
	const errs = []; page.on('pageerror', (e) => errs.push(String(e)));

	console.log('[업적 화면]');
	await page.goto(U('/dev/achievements')); await page.locator('.grid').waitFor(); await page.waitForTimeout(400);
	check('요약: 모은 업적 수 · 금 · 은 · 동 (특별 업적은 금 · 은 · 동에 안 셈)', (await page.locator('.summary').innerText()).replace(/\s+/g, ' ').includes('19 / 23') && (await page.locator('.metals').innerText()).replace(/\s+/g, '') === '금2은3동4', await page.locator('.summary').innerText());
	check('★ 대표 업적 3/3 · Landy 금 뱃지 2/5 (5개면 칸 5개, Phase 84)', (await page.locator('.feat-head h2').innerText()).includes('3/3') && (await page.locator('.five').innerText()).includes('2/5'));
	check('★ 대표 업적 = 교복 깃의 배지 3개 (Phase 69 — 칸 줄 대신 교복)', (await page.locator('.featured .uniform button.pin [role="img"]').count()) === 3
		&& (await page.locator('.featured .hint').innerText()) === '메달을 꾹 눌러 교복에 달아요');
	check('메달 23개 · 잠긴 것은 잠김으로', (await page.locator('.grid .card').count()) === 23 && (await page.locator('.card.locked').count()) === 4);
	check('★ 베타 테스터 — 특별 업적 ("특별" · 받음)', (await page.locator('.card', { hasText: '베타 테스터' }).locator('[aria-label="베타 테스터 특별"]').count()) === 1
		&& (await page.locator('.card', { hasText: '베타 테스터' }).innerText()).includes('받음'));
	check('새로 딴 업적에 NEW', (await page.locator('.card .new').count()) === 2);
	check('진행도: "7 / 20번"', (await page.locator('.card', { hasText: '연장의 달인' }).innerText()).includes('7 / 20번'));
	check('개척자는 가입 순서로', (await page.locator('.card', { hasText: '개척자' }).innerText()).includes('가입 42번째'));
	// Phase 84 — Landy 뱃지는 동그란 메달 대신 아이콘 모양 그대로 오린 입체 핀 (금속 판 · 두께 · 에나멜 · 금속 선)
	const die = await page.evaluate(() => {
		const cards = [...document.querySelectorAll('.grid .card')].filter((c) => !c.querySelector('.medal.pin'));
		const one = document.querySelector('.card .die');
		return {
			landy: cards.length,
			die: cards.filter((c) => c.querySelector('.medal .die svg')).length,
			round: document.querySelectorAll('.card .medal .rim').length,
			layers: one ? ['side', 'plate', 'enamel', 'gloss', 'wire'].every((k) => one.querySelector(`path.${k}`)) : false,
			gold: getComputedStyle(document.querySelector('.card .medal.t3:not(.sp):not(.pin) .die')).getPropertyValue('--m2').trim(),
			bronze: getComputedStyle(document.querySelector('.card .medal.t1:not(.pin) .die')).getPropertyValue('--m2').trim(),
			enamel: [...new Set([...document.querySelectorAll('.card .medal:not(.t0) .die')].map((d) => getComputedStyle(d.querySelector('.enamel')).fill))].length
		};
	});
	check('★ Landy 뱃지는 아이콘 모양 핀 — 동그란 테 없이 판 · 두께 · 에나멜 · 광택 · 금속 선', die.landy === 13 && die.die === 13 && die.round === 0 && die.layers, JSON.stringify(die));
	check('★ 금속은 등급 색 (금 ≠ 동) · 에나멜은 뱃지마다 다른 색', die.gold && die.bronze && die.gold !== die.bronze && die.enamel >= 7, JSON.stringify(die));
	await page.screenshot({ path: `${SP}/ach-1-grid.png`, fullPage: true });
	await page.getByRole('button', { name: '편지', exact: true }).click();
	check('★ 분류 탭에 CNSA', (await page.locator('.cats button').allInnerTexts()).at(-1) === 'CNSA');
	check('분류 탭: 편지만', (await page.locator('.grid .card').count()) === 2);
	await page.getByRole('button', { name: 'CNSA', exact: true }).click();
	check('★ CNSA 탭: 뱃지 열 (CNSA · MSMP 금 · 은 · Beatus · 극작소 · 도서부 · 1500m 인증제 · 품격 · 자율 · 창의위원) — 동그란 메달 대신 핀 그림', (await page.locator('.grid .card').count()) === 10
		&& (await page.locator('.card .pin-art').count()) === 10 && (await page.locator('.card .medal.pin .rim').count()) === 0
		&& (await page.locator('.card [aria-label="CNSA 뱃지 CNSA"]').count()) === 1 && (await page.locator('.card [aria-label="MSMP 우수 금뱃지 CNSA"]').count()) === 1 && (await page.locator('.card [aria-label="MSMP 우수 은뱃지 CNSA"]').count()) === 1
		&& (await page.locator('.card [aria-label="자율위원 CNSA"]').count()) === 1 && (await page.locator('.card [aria-label="창의위원 CNSA"]').count()) === 1
		&& (await page.locator('.card.locked [aria-label="Beatus 잠김"]').count()) === 1);
	check('Beatus 핀 — 위 · 아래 글자 · B', (await page.locator('.card', { hasText: 'Beatus' }).locator('textPath').allTextContents()).join('|') === 'CNSA IT CLUB|BEATUS');
	await page.screenshot({ path: `${SP}/ach-1b-cnsa.png`, fullPage: true });
	await page.locator('.card', { hasText: '극작소' }).click(); await page.waitForTimeout(300);
	check('★ 극작소 자세히 — "동아리 부원에게 주는 CNSA 뱃지"', (await page.locator('.detail').innerText()).includes('동아리 부원에게 주는 CNSA 뱃지'));
	await page.keyboard.press('Escape'); await page.waitForTimeout(400);
	await page.locator('.card', { hasText: 'MSMP 우수 금뱃지' }).click(); await page.waitForTimeout(300);
	check('MSMP 자세히 — 동아리가 아니면 "운영진이 주는 CNSA 뱃지"', (await page.locator('.detail').innerText()).includes('운영진이 주는 CNSA 뱃지'));
	await page.keyboard.press('Escape'); await page.waitForTimeout(400);
	await page.getByRole('button', { name: '전체', exact: true }).click();

	console.log('[자세히 · 대표 업적]');
	await page.locator('.card', { hasText: '연장의 달인' }).click(); await page.waitForTimeout(250);
	const sheet = page.getByRole('dialog', { name: '연장의 달인' });
	check('메달을 누르면 등급 기준 (동 5번 · 은 20번 · 금 50번)', (await sheet.innerText()).replace(/\s+/g, '').includes('동5번') && (await sheet.innerText()).replace(/\s+/g, '').includes('금50번') && (await sheet.locator('.tiers li.done').count()) === 1);
	await page.screenshot({ path: `${SP}/ach-2-detail.png` });
	await sheet.getByRole('button', { name: '대표 업적으로 걸기' }).click(); await page.waitForTimeout(250);
	check('★ 대표로 걸면 맨 앞에 · 3개로 유지', JSON.stringify(await page.evaluate(() => window.__featured)) === '["extend","fun","pioneer"]', JSON.stringify(await page.evaluate(() => window.__featured)));
	await page.locator('.card', { hasText: '연장의 달인' }).click(); await page.waitForTimeout(250);
	await page.getByRole('dialog', { name: '연장의 달인' }).getByRole('button', { name: '대표 업적에서 내리기' }).click(); await page.waitForTimeout(250);
	check('대표에서 내리기', JSON.stringify(await page.evaluate(() => window.__featured)) === '["fun","pioneer"]');
	await page.locator('.card', { hasText: '친절왕' }).click(); await page.waitForTimeout(250);
	check('잠긴 업적은 대표로 못 건다', (await page.getByRole('dialog', { name: '친절왕' }).getByRole('button', { name: /대표 업적/ }).count()) === 0);
	check('대표 업적 칸에 설명 문구 없음 (Phase 44)', !(await page.locator('.featured').innerText()).includes('대화 상대에게 보여요'));
	await page.keyboard.press('Escape'); await page.waitForTimeout(300);
	await page.locator('.card', { hasText: '베타 테스터' }).click(); await page.waitForTimeout(250);
	const beta = page.getByRole('dialog', { name: '베타 테스터' });
	check('★ 특별 업적 자세히 — 등급 기준 대신 "운영진이 주는 특별 업적"', (await beta.innerText()).includes('운영진이 주는 특별 업적') && (await beta.locator('.tiers').count()) === 0);
	await page.screenshot({ path: `${SP}/ach-6-beta.png` });
	await page.keyboard.press('Escape');

	console.log('[끌어 놓기 — 메달을 교복으로 · 교복 안에서 (Phase 69)]');
	{
		const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
		const tp = await tctx.newPage();
		const terrs = []; tp.on('pageerror', (e) => terrs.push(String(e)));
		const cdp = await tctx.newCDPSession(tp);
		const touch = (type, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
		const glide = async (from, to, steps = 12) => { for (let i = 1; i <= steps; i++) { await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await tp.waitForTimeout(16); } };
		const mid = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
		const LIFT = 34; // 메달은 손끝 위로 떠서 따라온다 — 칸 아래 LIFT 에서 떼면 칸 위에 놓인다
		const feat = () => tp.evaluate(() => JSON.stringify(window.__featured ?? null));
		const toY = async (loc, y) => { await loc.evaluate((e, y) => scrollBy(0, e.getBoundingClientRect().top - y), y); await tp.waitForTimeout(250); };
		await tp.goto(U('/dev/achievements')); await tp.locator('.grid .card').first().waitFor(); await tp.waitForTimeout(500);
		const card = (t) => tp.locator('.card', { hasText: t });
		const slot = (i) => tp.locator(`.featured .uniform [data-drop-slot="${i}"]`);

		// 짧게 밀면 스크롤 — 집지 않는다
		await toY(card('대화 여행자'), 560);
		const s0 = await tp.evaluate(() => scrollY), c0 = await mid(card('대화 여행자').locator('.medal'));
		await touch('touchStart', c0.x, c0.y); await glide(c0, { x: c0.x, y: c0.y - 200 }, 8); await touch('touchEnd'); await tp.waitForTimeout(500);
		check('★ 메달 위에서 짧게 밀면 그냥 스크롤 (집지 않는다)', (await tp.evaluate(() => scrollY)) > s0 + 100 && (await feat()) === 'null' && (await tp.locator('.drag-ghost').count()) === 0);

		// 목록 아래의 메달을 꾹 눌러 집으면 교복이 보이게 스크롤 → 두 번째 칸에 놓는다
		await toY(card('대화 여행자'), 560);
		const c1 = await mid(card('대화 여행자').locator('.medal'));
		await touch('touchStart', c1.x, c1.y); await tp.waitForTimeout(450);
		const held = await tp.evaluate(() => ({ dropping: !!document.querySelector('.featured .uniform[data-dropping]'), src: !!document.querySelector('.card [data-drag-src]'), ghost: document.querySelectorAll('.drag-ghost').length }));
		await tp.waitForTimeout(700);
		const shown = await tp.evaluate(() => { const r = document.querySelector('.featured .uniform').getBoundingClientRect(); return r.top >= document.querySelector('.topbar').getBoundingClientRect().bottom - 1 && r.bottom <= innerHeight; });
		check('★ 꾹 누르면 메달을 집는다 — 떠오른 메달 · 빈자리는 흐리게 · 교복 칸에 점선 고리', held.dropping && held.src && held.ghost === 1, JSON.stringify(held));
		check('★ 집는 순간 교복이 화면 밖이면 보이게 스크롤', shown);
		const t1 = await mid(slot(1));
		await glide(c1, { x: t1.x, y: t1.y + LIFT }, 14); await tp.waitForTimeout(120);
		check('칸 위에 올라가면 그 칸이 커지며 밝게', (await slot(1).getAttribute('data-drop-over')) === '' && (await tp.locator('.featured [data-drop-over]').count()) === 1);
		await tp.screenshot({ path: `${SP}/ach-7-drag.png` });
		await touch('touchEnd'); await tp.waitForTimeout(500);
		check('★ 놓으면 그 칸의 대표 업적이 된다 (있던 배지는 밀려난다)', (await feat()) === '["fun","chats","warm"]', await feat());
		check('끌고 놓아도 자세히 창이 같이 열리지 않고 · 떠 있던 메달은 사라진다', (await tp.getByRole('dialog').count()) === 0 && (await tp.locator('.drag-ghost').count()) === 0 && (await tp.locator('[data-drag-src], [data-dropping]').count()) === 0);
		check('교복 깃에 바로 보인다', (await slot(1).getAttribute('aria-label')) === '대화 여행자 업적 자세히');

		// 교복 안에서 칸 옮기기 — 첫 칸의 배지를 셋째 칸으로 (자리 바꾸기)
		const a0 = await mid(slot(0)), a2 = await mid(slot(2));
		await touch('touchStart', a0.x, a0.y); await tp.waitForTimeout(450); await glide(a0, { x: a2.x, y: a2.y + LIFT }); await tp.waitForTimeout(120); await touch('touchEnd'); await tp.waitForTimeout(500);
		check('★ 교복의 배지를 꾹 눌러 다른 칸에 놓으면 자리를 바꾼다', (await feat()) === '["warm","chats","fun"]' && (await tp.getByRole('dialog').count()) === 0, await feat());

		// 칸 밖에 놓으면 그대로 · 잠긴 메달은 집히지 않는다
		const b1 = await mid(slot(1));
		await touch('touchStart', b1.x, b1.y); await tp.waitForTimeout(450); await glide(b1, { x: 360, y: b1.y + 160 }); await touch('touchEnd'); await tp.waitForTimeout(500);
		check('칸 밖에 놓으면 제자리로 (그대로)', (await feat()) === '["warm","chats","fun"]' && (await tp.locator('.drag-ghost').count()) === 0);
		await toY(card('친절왕'), 560);
		const k = await mid(card('친절왕').locator('.medal'));
		await touch('touchStart', k.x, k.y); await tp.waitForTimeout(450);
		check('★ 잠긴 메달은 꾹 눌러도 집히지 않는다', (await tp.locator('[data-dropping]').count()) === 0 && (await card('친절왕').getAttribute('data-drag')) === null);
		await touch('touchEnd'); await tp.waitForTimeout(300);
		await tp.keyboard.press('Escape'); await tp.waitForTimeout(300);
		// 짧게 누르면 전처럼 자세히
		await card('이야기꾼').tap(); await tp.waitForTimeout(350);
		check('짧게 누르면 전처럼 자세히 (대표 업적 걸기 · 내리기)', (await tp.getByRole('dialog', { name: '이야기꾼' }).count()) === 1);
		check('페이지 오류 없음 (끌어 놓기)', terrs.length === 0, terrs.join(' / '));
		await tctx.close();
	}

	console.log('[교복 — 대표 업적은 깃의 배지 (Phase 60)]');
	await page.goto(U('/dev/achievements?uniform')); await page.locator('.uniform').first().waitFor(); await page.waitForTimeout(400);
	const uni = (neck, n) => page.locator(`.u[data-neck="${neck}"][data-n="${n}"] .uniform`);
	// Phase 70 — 교복은 움직이지 않는다 (숨 쉬기 · 넥타이 · 리본 흔들림 없음)
	const moving = await page.locator('.u .uniform').evaluateAll((us) => us.flatMap((u) => [...u.querySelectorAll('.body, .body g, .body path')])
		.filter((e) => { const c = getComputedStyle(e); return c.animationName !== 'none' || (c.rotate !== 'none' && c.rotate !== '0deg'); }).length);
	check('★ 교복 · 넥타이 · 리본이 움직이지 않는다', moving === 0, String(moving));
	check('★ 오른쪽 아래 "전체 업적 보기" → 업적 화면', (await uni('tie', 3).locator('a.all').getAttribute('href')) === '/dev/achievements'
		&& (await uni('tie', 2).locator('a.all').count()) === 0);
	const [ub, ab] = await Promise.all([uni('tie', 3).boundingBox(), uni('tie', 3).locator('a.all').boundingBox()]);
	check('전체 업적 보기는 교복 오른쪽 아래 구석 · 누름 높이 44', ab.x + ab.width > ub.x + ub.width * 0.8 && ab.y + ab.height > ub.y + ub.height * 0.85 && ab.height >= 44, JSON.stringify([ub, ab]));
	const medal = await uni('tie', 3).locator('button.pin .medal').first().boundingBox();
	check('★ 교복의 배지가 크다 (폰 폭에서 48 이상)', medal.width >= 48, JSON.stringify(medal));
	await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(150);
	check('★ 넥타이 · 리본 교복', (await uni('tie', 3).getAttribute('data-neck')) === 'tie' && (await uni('ribbon', 3).getAttribute('data-neck')) === 'ribbon');
	check('★ 대표 업적 수만큼 깃에 배지 · 남은 칸은 점선 "+" (업적 화면으로)', (await uni('tie', 3).locator('button.pin').count()) === 3 && (await uni('tie', 3).locator('.empty').count()) === 0
		&& (await uni('tie', 2).locator('button.pin').count()) === 2 && (await uni('tie', 2).locator('a.empty').getAttribute('href')) === '/dev/achievements'
		&& (await uni('ribbon', 0).locator('a.empty').count()) === 3);
	check('빈 칸 링크가 없으면(상대 프로필) 빈 칸도 없다', (await page.locator('.sheet-size .uniform .empty').count()) === 0 && (await page.locator('.sheet-size .uniform button.pin').count()) === 2);
	await uni('tie', 3).getByRole('button', { name: '개척자 업적 자세히' }).click(); await page.waitForTimeout(150);
	check('배지를 누르면 그 업적', (await page.locator('.picked').innerText()) === '개척자');
	const pins = await uni('tie', 3).locator('button.pin').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height, r.top]));
	check('배지 누름 영역 44 · 서로 겹치지 않는다', pins.every(([w, h]) => w >= 44 && h >= 44) && pins.every((p, i) => !i || p[2] - pins[i - 1][2] >= 44), JSON.stringify(pins));
	// Phase 62 — 넥타이는 매듭(머리)이 날 위를 덮고 날보다 넓다, 리본은 고리 둘 · 꼬리 둘 · 매듭
	const tie = await uni('tie', 3).evaluate((u) => {
		const k = u.querySelector('.tie .knot').getBBox(), b = u.querySelector('.tie .blade').getBBox();
		return { knotW: k.width, covers: k.y < b.y && k.y + k.height > b.y + 2, wider: k.width > 2 * 7.5 + 10 };
	});
	check('★ 넥타이 매듭(머리) — 날 위를 덮고 날 윗부분보다 넓다', tie.covers && tie.wider, JSON.stringify(tie));
	// Phase 64 — 사진처럼 조끼 V넥이 칼라 끝 바로 아래(그림 위쪽 절반, 매듭보다 아래), 스케치처럼 넥타이는 왼쪽 끝
	const lay = await uni('tie', 3).evaluate((u) => {
		const f = u.getBoundingClientRect(), v = u.querySelector('.vneck').getBoundingClientRect(), k = u.querySelector('.tie .knot').getBoundingClientRect();
		return { vBottom: (v.bottom - f.top) / f.height, knotBottom: (k.bottom - f.top) / f.height, knotX: (k.left + k.width / 2 - f.left) / f.width };
	});
	check('★ 조끼 V넥은 칼라 끝 바로 아래 · 넥타이는 왼쪽 끝', lay.vBottom < 0.5 && lay.vBottom > lay.knotBottom && lay.knotX < 0.15, JSON.stringify(lay));
	check('★ 리본 — 고리 둘 · 꼬리 둘', (await uni('ribbon', 3).locator('.ribbon .loop').count()) === 2 && (await uni('ribbon', 3).locator('.ribbon-tails .tail').count()) === 2
		&& (await uni('tie', 3).locator('.ribbon').count()) === 0 && (await uni('ribbon', 3).locator('.tie').count()) === 0);
	// Phase 65 · 66 — 실제로 입은 것처럼 겹친다: 칼라는 조끼 목둘레에 닿지 않고, 리본 머리와 넥타이 매듭은 재킷에 닿지 않으며
	// 리본 고리(1.5배 — 앞섶 사이보다 넓다)는 끝이 재킷 밑으로 들어가고(재킷보다 먼저 그린다), 보이는 곳은 조끼 위에 걸치지 않고,
	// 넥타이 날 끝은 조끼 속에 있고, 리본 꼬리는 조끼보다 나중에 그려져 조끼 목둘레 단을 넘어 조끼 위로 늘어진다 (Phase 69 — 조끼 밖으로)
	const layering = async (neck) => uni(neck, 3).evaluate((u) => {
		const into = (el, target) => { const m = target.getScreenCTM().inverse().multiply(el.getScreenCTM()); return (x, y) => new DOMPoint(x, y).matrixTransform(m); };
		const outline = (el) => { const L = el.getTotalLength(), out = []; for (let d = 0; d <= L; d += 2) out.push(el.getPointAtLength(d)); return out; };
		// 그림 밖 점과, hidden 이 있으면 그것(재킷)에 가려지는 점은 빼고 본다
		const frame = u.getBoundingClientRect();
		const seen = (el, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM()); return q.x >= frame.left && q.x <= frame.right && q.y >= frame.top && q.y <= frame.bottom; };
		const clear = (sel, target, dy = 0, hidden = null) => [...u.querySelectorAll(sel)].every((el) => {
			const f = into(el, target), h = hidden && into(el, hidden);
			return outline(el).every((p) => !seen(el, p) || (h && hidden.isPointInFill(h(p.x, p.y))) || !target.isPointInFill(f(p.x, p.y + dy)));
		});
		const under = (sel, target) => [...u.querySelectorAll(sel)].every((el) => !!(el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING));
		// 끝이 조끼 자리에 있고, 조끼보다 먼저 그려져(아래 겹) 가려진다
		const tucked = (sel, target) => [...u.querySelectorAll(sel)].every((el) => { const b = el.getBBox(), f = into(el, target); return target.isPointInFill(f(b.x + b.width / 2, b.y + b.height - 1)) && !!(el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING); });
		const over = (sel, target) => [...u.querySelectorAll(sel)].every((el) => !!(el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING));
		const vest = u.querySelector('.vest'), lap = u.querySelector('.lapel-r');
		return {
			collarAboveVest: clear('.leaf', vest, 5),
			neckClearOfJacket: clear('.tie .knot, .ribbon .bow-knot', lap),
			loopsUnderJacket: under('.ribbon .loop', lap),
			bowAboveVest: clear('.ribbon .loop, .ribbon .bow-knot', vest, 4, lap),
			tuckedInVest: tucked('.tie .blade', vest),
			tailsOverVest: [...u.querySelectorAll('.ribbon-tails .tail')].every((el) => {
				const b = el.getBBox(), f = into(el, vest);
				return !!(el.compareDocumentPosition(vest) & Node.DOCUMENT_POSITION_PRECEDING) && vest.isPointInFill(f(b.x + b.width / 2, b.y + b.height - 3));
			}),
			bowOverVest: over('.ribbon .loop, .ribbon .bow-knot', vest)
		};
	});
	for (const neck of ['tie', 'ribbon']) {
		const l = await layering(neck);
		check(`★ 입은 순서대로 자연스럽게 겹친다 (${neck})`, Object.values(l).every(Boolean), JSON.stringify(l));
	}
	// Phase 67 — 리본 고리가 거의 다 보이고(1.5배로 키웠을 때 잘려서 넥타이처럼 보였다), 넥타이 날은 머리에 맞게 넓고,
	// 조끼 목둘레는 끝만 살짝 둥근 V(라운드넥이 아니다), 재킷 앞섶은 거의 곧다
	const shape = await page.evaluate(() => {
		const tie = document.querySelector('.u[data-neck="tie"][data-n="3"] .uniform'), rib = document.querySelector('.u[data-neck="ribbon"][data-n="3"] .uniform');
		const pts = (el, step = 1) => { const L = el.getTotalLength(), out = []; for (let d = 0; d <= L; d += step) out.push(el.getPointAtLength(d)); return out; };
		// 리본 고리 — 그림 안이고 재킷에 가려지지 않은 윤곽 점의 비율
		const frame = rib.getBoundingClientRect(), lap = rib.querySelector('.lapel-r'), lm = lap.getScreenCTM().inverse();
		const loops = [...rib.querySelectorAll('.ribbon .loop')].map((el) => {
			const m = el.getScreenCTM(), all = pts(el, 2);
			const seen = all.filter((p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(m); return q.x >= frame.left && q.x <= frame.right && q.y >= frame.top && q.y <= frame.bottom && !lap.isPointInFill(q.matrixTransform(lm)); });
			return seen.length / all.length;
		});
		// 넥타이 날 너비 (머리 아래 끝에서 8 아래) ÷ 머리 너비
		const knot = tie.querySelector('.tie .knot'), blade = tie.querySelector('.tie .blade'), kb = knot.getBBox();
		const y = kb.y + kb.height + 8; let w = 0;
		for (let x = kb.x - 20; x < kb.x + kb.width + 20; x += 0.5) if (blade.isPointInFill(new DOMPoint(x, y))) w += 0.5;
		// 조끼 목둘레 — 가장 아래 점과, 거기서 옆으로 10 떨어진 곳의 높이 차 (둥글면 거의 0)
		const vp = pts(tie.querySelector('.vneck'), 0.5), bottom = vp.reduce((a, p) => (p.y > a.y ? p : a));
		const side = vp.reduce((a, p) => (Math.abs(p.x - (bottom.x + 10)) < Math.abs(a.x - (bottom.x + 10)) ? p : a));
		// 재킷 앞섶 — 양 끝을 잇는 곧은 선에서 가장 멀리 벗어난 거리
		const fp = pts(tie.querySelector('.front-edge'), 2), [a0, a1] = [fp[0], fp[fp.length - 1]];
		const dev = Math.max(...fp.map((p) => Math.abs((a1.y - a0.y) * p.x - (a1.x - a0.x) * p.y + a1.x * a0.y - a1.y * a0.x) / Math.hypot(a1.y - a0.y, a1.x - a0.x)));
		return { loops: loops.map((v) => +v.toFixed(2)), bladeRatio: +(w / kb.width).toFixed(2), vTip: +(bottom.y - side.y).toFixed(1), frontDev: +dev.toFixed(1) };
	});
	// Phase 68 — 리본은 프레임 안에 통째로 들어온다 (고리마다 윤곽 거의 전부가 보인다)
	check('★ 리본 고리가 다 보인다 (넥타이처럼 보이지 않게)', shape.loops.length === 2 && shape.loops.every((v) => v >= 0.95), JSON.stringify(shape));
	check('★ 넥타이 날은 머리에 맞게 넓다', shape.bladeRatio >= 0.45, JSON.stringify(shape));
	check('★ 조끼 목둘레는 끝만 살짝 둥근 V (라운드넥 아님)', shape.vTip >= 2, JSON.stringify(shape));
	check('★ 재킷 앞섶은 거의 곧다', shape.frontDev <= 2.5, JSON.stringify(shape));
	// Phase 68 — 카라 · 넥타이 · 리본을 한 비례로 다시 그렸다. 카라 벌어짐(뾰족한 두 끝 사이)이 기준: 매듭은 그 절반쯤, 리본은 2/3쯤.
	// 카라 잎은 끝이 뾰족하고(60 도쯤) 매듭 어깨를 덮으며, 리본 날개는 카라 위에 얹힌다. 리본 꼬리는 서로 벌어지고 날개는 프레임 안.
	const fit = async (neck) => uni(neck, 3).evaluate((u) => {
		const pts = (el, step = 0.5) => { const L = el.getTotalLength(), out = []; for (let d = 0; d <= L; d += step) out.push(el.getPointAtLength(d)); return out; };
		const frame = u.getBoundingClientRect(), leaves = [...u.querySelectorAll('.leaf')], leaf = leaves[0], m = leaf.getScreenCTM();
		const P = pts(leaf), ti = P.reduce((a, p, i) => (p.y > P[a].y ? i : a), 0), tip = P[ti];
		// 끝 각도 — 끝에서 윤곽을 양쪽으로 12 만큼 간 두 점이 이루는 각 (잎 좌표 그대로)
		const va = { x: P[ti - 24].x - tip.x, y: P[ti - 24].y - tip.y }, vb = { x: P[ti + 24].x - tip.x, y: P[ti + 24].y - tip.y };
		const angle = (Math.acos((va.x * vb.x + va.y * vb.y) / (Math.hypot(va.x, va.y) * Math.hypot(vb.x, vb.y))) * 180) / Math.PI;
		const cx = new DOMPoint(0, 0).matrixTransform(m).x, spread = 2 * (new DOMPoint(tip.x, tip.y).matrixTransform(m).x - cx);
		const out = { leaves: leaves.length, tipAngle: +angle.toFixed(0) };
		const knot = u.querySelector('.tie .knot');
		if (knot) {
			out.knotRatio = +(knot.getBoundingClientRect().width / spread).toFixed(2);
			// 카라 잎이 매듭 어깨를 덮는다 — 매듭 윤곽 점이 잎 안에 들어 있고, 잎이 매듭보다 나중에 그려진다
			const km = knot.getScreenCTM();
			out.collarCoversKnot = pts(knot, 1).filter((p) => leaves.some((l) => l.isPointInFill(new DOMPoint(p.x, p.y).matrixTransform(km).matrixTransform(l.getScreenCTM().inverse())))).length >= 8
				&& leaves.every((l) => !!(knot.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING));
		}
		const loops = [...u.querySelectorAll('.ribbon .loop')];
		if (loops.length) {
			const rs = loops.map((l) => l.getBoundingClientRect());
			out.bowRatio = +((Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left))) / spread).toFixed(2);
			out.bowInFrame = rs.every((r) => r.left >= frame.left + 4 && r.right <= frame.right - 4 && r.top >= frame.top);
			out.bowOverCollar = loops.every((l) => leaves.every((c) => !!(l.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING)));
			// 꼬리 — 가장 아래 두 점(제비꼬리 두 끝)의 안쪽 끝 사이 간격 ÷ 그림 너비
			const inner = [...u.querySelectorAll('.ribbon-tails .tail')].map((t) => {
				const tm = t.getScreenCTM(), Q = pts(t, 1).map((p) => new DOMPoint(p.x, p.y).matrixTransform(tm)), yMax = Math.max(...Q.map((q) => q.y));
				const low = Q.filter((q) => q.y > yMax - 14 * (frame.height / 280)).map((q) => q.x);
				return { lo: Math.min(...low), hi: Math.max(...low) };
			});
			const [r, l] = inner[0].lo > inner[1].lo ? inner : [inner[1], inner[0]];
			out.tails = inner.length;
			// 꼬리 폭 (가운데 높이에서 가로로 잰 윤곽 안 길이) ÷ 리본 너비
			const t0 = u.querySelector('.ribbon-tails .tail'), tb = t0.getBBox(), ty = tb.y + tb.height * 0.45;
			let tw = 0;
			for (let x = tb.x - 10; x < tb.x + tb.width + 10; x += 0.25) if (t0.isPointInFill(new DOMPoint(x, ty))) tw += 0.25;
			const bowW = Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left));
			out.tailRatio = +((tw * t0.getScreenCTM().a) / bowW).toFixed(2);
			out.tailGap = +((r.lo - l.hi) / frame.width).toFixed(3);
		}
		return out;
	});
	for (const neck of ['tie', 'ribbon']) {
		const f = await fit(neck);
		check(`★ 카라 잎 둘 · 끝이 뾰족하다 (${neck})`, f.leaves === 2 && f.tipAngle >= 40 && f.tipAngle <= 85, JSON.stringify(f));
		// Phase 83 — 사진처럼 매듭은 작게 (카라 벌어짐의 1/3 남짓 — 전엔 절반쯤)
		if (neck === 'tie') check('★ 넥타이 매듭은 작다 (카라 벌어짐의 1/3 남짓) · 카라 잎이 매듭 어깨를 덮는다', f.knotRatio >= 0.28 && f.knotRatio <= 0.45 && f.collarCoversKnot, JSON.stringify(f));
		else {
			check('★ 리본은 카라 벌어짐의 2/3쯤 · 프레임 안 · 카라 위에 얹힌다', f.bowRatio >= 0.55 && f.bowRatio <= 0.8 && f.bowInFrame && f.bowOverCollar, JSON.stringify(f));
			check('★ 리본 꼬리 둘이 서로 벌어진다 (한 장처럼 겹치지 않게)', f.tails === 2 && f.tailGap >= 0.04, JSON.stringify(f));
			check('★ 리본 꼬리는 굵다 — 꼬리 폭 ≥ 리본 너비의 30% (Phase 69)', f.tailRatio >= 0.3, JSON.stringify(f));
		}
	}
	// Phase 69 — 마우스는 누른 채 끌면 바로 집는다 (길게 누를 필요 없음) · 끄는 동안 칸 표시
	{
		const pinAt = (i) => uni('tie', 3).locator(`[data-drop-slot="${i}"]`);
		const before = JSON.stringify(await page.evaluate(() => window.__featured));
		const pickedBefore = await page.locator('.picked').innerText();
		const m0 = await pinAt(0).boundingBox(), m1 = await pinAt(1).boundingBox();
		await page.mouse.move(m0.x + m0.width / 2, m0.y + m0.height / 2); await page.mouse.down();
		await page.mouse.move(m1.x + m1.width / 2, m1.y + m1.height / 2, { steps: 10 }); await page.waitForTimeout(100);
		const during = await uni('tie', 3).evaluate((u) => ({ dropping: u.hasAttribute('data-dropping'), over: u.querySelector('[data-drop-over]')?.getAttribute('data-drop-slot') }));
		await page.mouse.up(); await page.waitForTimeout(300);
		const f0 = JSON.parse(before ?? 'null') ?? ['fun', 'pioneer', 'warm'];
		check('★ 마우스로 끌어 교복 칸 옮기기 (자리 바꾸기 · 끈 뒤 누르기로 세지 않는다)', during.dropping && during.over === '1' && JSON.stringify(await page.evaluate(() => window.__featured)) === JSON.stringify([f0[1], f0[0], ...f0.slice(2)])
			&& (await page.locator('.picked').innerText()) === pickedBefore, JSON.stringify({ during, before, after: await page.evaluate(() => window.__featured) }));
		check('끌기 없이 누르면 전처럼 그 업적 (교복)', await (async () => { await pinAt(2).click(); await page.waitForTimeout(150); return (await page.locator('.picked').innerText()).length > 0; })());
		check('★ 상대 프로필 교복의 배지는 끌 수 없다', (await page.locator('.sheet-size .uniform [data-drag]').count()) === 0 && (await uni('tie', 3).locator('button.pin[data-drag]').count()) === 3);
	}
	// Phase 61 — 깃이 커서 배지 3개가 다 깃 안에 (가운데 · 위아래 · 좌우 끝), 주머니는 수평으로 교표 바로 위 가운데 (움직임을 멈추고 잰다)
	for (const [neck, w] of [['tie', 0], ['ribbon', 320]]) {
		if (w) { await page.setViewportSize({ width: w, height: 844 }); await page.waitForTimeout(200); }
		const inside = await uni(neck, 3).evaluate((u) => {
			const svg = u.querySelector('svg'), lap = u.querySelector('.lapel-r'), m = svg.getScreenCTM().inverse();
			return [...u.querySelectorAll('button.pin .coin')].every((c) => {
				const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
				return [[cx, cy], [cx, r.top], [cx, r.bottom], [r.left, cy], [r.right, cy]].every(([x, y]) => lap.isPointInFill(new DOMPoint(x, y).matrixTransform(m)));
			});
		});
		check(`★ 배지 3개가 다 깃 안에 (${neck}${w ? ` · 폭 ${w}` : ''})`, inside);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	const pocket = await uni('tie', 3).evaluate((u) => {
		const p = u.querySelector('.pocket').getBBox(), c = u.querySelector('image').getBBox();
		return { level: /^M[\d.]+ ([\d.]+)H[\d.]+V[\d.]+H/.test(u.querySelector('.pocket').getAttribute('d')), above: p.y + p.height < c.y, dx: Math.abs(p.x + p.width / 2 - (c.x + c.width / 2)) };
	});
	check('★ 가슴 주머니는 수평 · 교표 바로 위 가운데', pocket.level && pocket.above && pocket.dx < 1, JSON.stringify(pocket));
	const crest = await page.evaluate(async () => {
		const img = new Image();
		img.src = document.querySelector('.uniform image')?.getAttribute('href') ?? '';
		try { await img.decode(); return `${img.naturalWidth}x${img.naturalHeight}`; } catch { return 'fail'; }
	});
	check('★ 가슴의 교표 그림이 불러와진다', crest === '244x256', crest);
	// Phase 84 — 5칸: 깃 셋 + 가슴 주머니 위 둘. 그림 안 · 서로 겹치지 않고(누름 44) · 주머니 · 교표를 가리지 않는다
	for (const neck of ['tie', 'ribbon']) {
		const five = await uni(neck, 5).evaluate((u) => {
			const f = u.getBoundingClientRect(), pins = [...u.querySelectorAll('button.pin')].map((b) => b.getBoundingClientRect());
			const c = pins.map((r) => [r.left + r.width / 2, r.top + r.height / 2]);
			let near = 1e9;
			for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) near = Math.min(near, Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]));
			const pocket = u.querySelector('.pocket').getBoundingClientRect(), crest = u.querySelector('image').getBoundingClientRect();
			const medals = [...u.querySelectorAll('button.pin .coin')].slice(3).map((m) => m.getBoundingClientRect());
			return {
				n: pins.length,
				inFrame: pins.every((r) => r.left + r.width / 2 > f.left && r.right - r.width / 2 < f.right && r.top >= f.top - 2 && r.bottom <= f.bottom),
				near: Math.round(near),
				clear: medals.every((m) => m.bottom <= pocket.top + 1 && m.bottom <= crest.top)
			};
		});
		check(`★ 대표 칸 5개 교복 — 깃 셋 + 주머니 위 둘 (${neck})`, five.n === 5 && five.inFrame && five.near >= 44 && five.clear, JSON.stringify(five));
	}
	await uni('tie', 5).screenshot({ path: `${SP}/ach-7b-uniform-five.png` });
	await uni('tie', 3).screenshot({ path: `${SP}/ach-7-uniform-tie.png` });
	await uni('ribbon', 2).screenshot({ path: `${SP}/ach-8-uniform-ribbon.png` });
	await page.emulateMedia({ reducedMotion: 'no-preference' });

	console.log('[새 업적 축하]');
	await page.goto(U('/dev/achievements?celebrate')); await page.waitForTimeout(700);
	const party = page.getByRole('dialog', { name: '새 업적' });
	check('★ 여러 개면 "업적 3개를 모았어요!" · 메달 3개', (await party.innerText()).includes('업적 3개를 모았어요!') && (await party.locator('.m').count()) === 3);
	await page.screenshot({ path: `${SP}/ach-3-celebrate.png` });
	await page.goto(U('/dev/achievements?celebrate&one')); await page.waitForTimeout(700);
	check('하나면 "고정 친구 동 등급!"', (await page.getByRole('dialog', { name: '새 업적' }).innerText()).includes('고정 친구 동 등급!'));
	await page.getByRole('button', { name: '닫기' }).click(); await page.waitForTimeout(500);
	check('닫으면 사라진다', (await page.getByRole('dialog', { name: '새 업적' }).count()) === 0);

	console.log('[상대 프로필의 대표 업적]');
	// 업적 카탈로그 (Phase 44) — 남의 메달을 누르면 설명 · 기준을 여기서
	let catalogCalls = 0;
	await page.route('https://fake-proj.supabase.co/rest/v1/rpc/achievement_catalog', (r) => {
		catalogCalls++;
		return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
			{ code: 'warm', title: '따뜻한 사람', description: '매너 온도', icon: '🌡️', category: 'manner', unit: '도', lower_better: false, granted: false, tiers: [42, 45, 50] },
			{ code: 'pin', title: '고정 친구', description: '둘 다 고정한 채팅', icon: '📌', category: 'chat', unit: '명', lower_better: false, granted: false, tiers: [1, 3, 10] },
			{ code: 'fun', title: '이야기꾼', description: '"대화가 재밌어요" 받기', icon: '🎉', category: 'manner', unit: '번', lower_better: false, granted: false, tiers: [10, 50, 200] }
		]) });
	});
	await page.goto(U('/dev/chat?s=chat')); await page.locator('.bubble', { hasText: '안녕하세요!' }).waitFor(); await page.waitForTimeout(400);
	check('대화 맨 위 소개에 대표 업적 메달 3개', (await page.locator('.intro [role="img"]').count()) === 3);
	await page.getByRole('button', { name: '이야기꾼 업적 자세히' }).first().click();
	const fun = page.getByRole('dialog', { name: '이야기꾼' });
	await fun.locator('.tiers li').first().waitFor({ timeout: 5000 }).catch(() => {});
	check('★ 소개의 메달을 누르면 어떻게 얻는지 · 등급 기준 (업적 화면과 같은 모양)', (await fun.innerText()).includes('"대화가 재밌어요" 받기') && (await fun.locator('.tiers li.done').count()) === 3
		&& (await fun.innerText()).replace(/\s+/g, '').includes('금200번'), await fun.innerText().catch(() => ''));
	await page.screenshot({ path: `${SP}/ach-5-partner-badge.png` });
	await page.keyboard.press('Escape');
	await fun.waitFor({ state: 'detached' });
	// 닫기 애니메이션 뒤 history.back의 popstate까지 끝나야 다음 시트가 닫히지 않는다.
	await page.waitForFunction(() => !(history.state?.['sveltekit:states']?.ov ?? []).length);
	await page.getByRole('button', { name: '프로필 보기' }).first().click();
	await page.locator('.profile .badges').waitFor({ state: 'visible' });
	check('★ 상대 프로필 시트: 교복 깃에 대표 업적 배지 (이름 · 등급) · 늘 넥타이 (Phase 60)', (await page.locator('.profile .badges').getByRole('button', { name: '따뜻한 사람 업적 자세히' }).count()) === 1
		&& (await page.locator('.profile .badges [aria-label="이야기꾼 금"]').count()) === 1 && (await page.locator('.profile .uniform[data-neck="tie"]').count()) === 1
		&& (await page.locator('.profile .uniform .empty').count()) === 0);
	await page.screenshot({ path: `${SP}/ach-4-partner.png` });
	await page.emulateMedia({ reducedMotion: 'reduce' }); // 교복 배지는 숨 쉬듯 움직인다 — 멈추고 누른다
	await page.locator('.profile .badges').getByRole('button', { name: '고정 친구 업적 자세히' }).click();
	const pin = page.getByRole('dialog', { name: '고정 친구' });
	await pin.locator('.tiers li').first().waitFor();
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	check('★ 프로필 시트 위에 메달 자세히 (동 1명 · 동만 달성)', (await pin.innerText()).includes('둘 다 고정한 채팅') && (await pin.locator('.tiers li.done').count()) === 1);
	check('카탈로그는 한 번만 받는다', catalogCalls === 1, String(catalogCalls));
	check('페이지 오류 없음', errs.length === 0, errs.join(' / '));
} finally { await browser.close(); stopProcess(vite);  }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

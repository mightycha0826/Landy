import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 답장 · 첫마디 도우미 · 시간 구분선 · 연결 화면 — /dev/chat 미리보기
const SP = OUT, PORT = 5192;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const browser = await chromium.launch({ executablePath: CHROME });
const U = (p) => `http://localhost:${PORT}${p}`;
try {
	const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
	const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
	const bubble = (t) => page.locator('.bubble', { hasText: t });

	console.log('[시간 구분선]');
	await page.goto(U('/dev/chat?s=chat'));
	await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(600);
	const seps = await page.locator('.time-sep').allInnerTexts();
	check('대화 시작 + 5분 넘게 쉰 뒤 = 구분선 2개', seps.length === 2 && seps.every((t) => /^(오전|오후) \d{1,2}:\d{2}$/.test(t)), JSON.stringify(seps));
	const firstSep = await page.locator('.time-sep').first().boundingBox(), firstSys = await page.locator('.list .sys').first().boundingBox();
	check('첫 구분선은 첫 안내 위', firstSep.y < firstSys.y);

	console.log('[답장 보이기]');
	const quoted = page.locator('.bwrap', { has: bubble('헐 저도 좋아해요') }).locator('.quote');
	check('답장 말풍선 위에 인용', (await quoted.innerText()).includes('내 메시지에 답장') && (await quoted.innerText()).includes('실리카겔 좋아하세요?'), await quoted.innerText().catch(() => ''));
	await page.screenshot({ path: `${SP}/feat-1-chat.png` });
	await page.locator('.list').evaluate((e) => e.scrollTo(0, e.scrollHeight));
	await quoted.click(); await page.waitForTimeout(250);
	check('★ 인용 누르면 원래 메시지로 가서 반짝', (await page.locator('.bwrap.flash .bubble').innerText()).includes('실리카겔 좋아하세요?'));

	const qb = await quoted.boundingBox(), bb = await bubble('헐 저도 좋아해요').boundingBox();
	check('★ 인용 상자와 답장 말풍선이 겹치지 않는다', qb.y + qb.height <= bb.y, JSON.stringify({ quoteBottom: qb.y + qb.height, bubbleTop: bb.y }));

	console.log('[답장 보내기]');
	await bubble('공연도 가봤어요?').click({ button: 'right' }); await page.waitForTimeout(200);
	check('고르기 줄에 "답장"', (await page.getByRole('menuitem', { name: '답장' }).count()) === 1);
	const pk = await page.locator('.rx-pick').boundingBox();
	check('고르기 줄이 화면 안에', pk.x >= 0 && pk.x + pk.width <= 390, JSON.stringify(pk));
	await page.getByRole('menuitem', { name: '답장' }).click(); await page.waitForTimeout(200);
	const bar = page.locator('.replying');
	check('입력창 위 "새벽수달에게 답장" 막대', (await bar.innerText()).includes('새벽수달에게 답장') && (await bar.innerText()).includes('공연도 가봤어요?'));
	check('입력창에 커서', await page.locator('textarea').evaluate((e) => e === document.activeElement));
	await page.screenshot({ path: `${SP}/feat-2-replying.png` });
	await page.evaluate(() => document.documentElement.style.setProperty('--bubble-fill', 'linear-gradient(#3b8af6, #3b8af6)'));
	const barBg = await page.locator('.replying-text').evaluate((e) => getComputedStyle(e, '::before').backgroundImage);
	check('답장 막대의 세로줄 = 테마 색상 (설정에서 고른 색)', barBg.includes('59, 138, 246'), barBg);
	await page.evaluate(() => document.documentElement.style.removeProperty('--bubble-fill'));
	await page.locator('.replying-x').click();
	await page.locator('.replying').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {}); // 닫히는 연출(out:expand)이 끝날 때까지
	check('✕ 로 답장 취소', (await page.locator('.replying').count()) === 0);
	await bubble('공연도 가봤어요?').click({ button: 'right' }); await page.getByRole('menuitem', { name: '답장' }).click();
	await page.locator('textarea').fill('아직 못 가봤어요!'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
	const mine = page.locator('.bwrap', { has: bubble('아직 못 가봤어요!') });
	check('★ 보낸 답장에 인용 · 막대 사라짐', (await mine.locator('.quote').innerText()).includes('새벽수달의 메시지에 답장') && (await page.locator('.replying').count()) === 0);
	await page.screenshot({ path: `${SP}/feat-3-sent.png` });

	console.log('[밀어서 답장]');
	// 손가락 밀기 — 터치 포인터 이벤트를 말풍선에 직접 보낸다 (down → move 여러 번 → up)
	const drag = (text, dx, dy = 0, type = 'touch') => page.evaluate(async ([text, dx, dy, type]) => {
		const el = [...document.querySelectorAll('.bubble')].find((b) => b.textContent.includes(text));
		const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
		const ev = (n, cx, cy) => el.dispatchEvent(new PointerEvent(n, { bubbles: true, cancelable: true, pointerId: 7, pointerType: type, isPrimary: true, button: 0, clientX: cx, clientY: cy }));
		ev('pointerdown', x, y);
		for (let i = 1; i <= 6; i++) ev('pointermove', x + (dx * i) / 6, y + (dy * i) / 6);
		await new Promise((r) => requestAnimationFrame(() => r())); // 화면이 따라 그려진 뒤에 본다
		const w = el.closest('.bwrap');
		return { transform: w.style.transform, icon: !!w.querySelector('.swipe-ic'), hit: !!w.querySelector('.swipe-ic.hit'), left: !!w.querySelector('.swipe-ic.left') };
	}, [text, dx, dy, type]);
	const lift = (text) => page.evaluate((text) => {
		const el = [...document.querySelectorAll('.bubble')].find((b) => b.textContent.includes(text));
		el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 }));
	}, text);
	const replying = () => page.locator('.replying').innerText().catch(() => '');

	let mid = await drag('공연도 가봤어요?', 100);
	check('상대 말풍선을 오른쪽으로 끌면 따라온다 + 왼쪽에 답장 화살표', /translateX\(\d/.test(mid.transform) && mid.icon && mid.left && mid.hit, JSON.stringify(mid));
	await page.screenshot({ path: `${SP}/feat-6-swipe.png` });
	await lift('공연도 가봤어요?'); await page.waitForTimeout(300);
	check('★ 놓으면 그 메시지에 답장 준비', (await replying()).includes('새벽수달에게 답장') && (await replying()).includes('공연도 가봤어요?'), await replying());
	check('말풍선은 제자리로', (await page.locator('.bwrap', { has: bubble('공연도 가봤어요?') }).evaluate((e) => e.style.transform)) === '');
	check('밀기는 톡으로 세지 않는다 (공감 안 달림)', (await page.locator('.bwrap.reacted', { has: bubble('공연도 가봤어요?') }).count()) === 0);
	await page.locator('.replying-x').click();

	mid = await drag('아직 못 가봤어요!', -100);
	check('내 말풍선은 왼쪽으로 밀어도 된다 (화살표는 오른쪽)', /translateX\(-\d/.test(mid.transform) && mid.icon && !mid.left, JSON.stringify(mid));
	await lift('아직 못 가봤어요!'); await page.waitForTimeout(300);
	check('★ 내 메시지에도 밀어서 답장', (await replying()).includes('내 메시지에 답장') && (await replying()).includes('아직 못 가봤어요!'), await replying());
	await page.locator('.replying-x').click();

	await drag('공연도 가봤어요?', 35); await lift('공연도 가봤어요?'); await page.waitForTimeout(300);
	check('조금만 밀다 놓으면 답장 안 함', (await page.locator('.replying').count()) === 0);
	mid = await drag('공연도 가봤어요?', 12, 80); await lift('공연도 가봤어요?'); await page.waitForTimeout(300);
	check('위아래로 움직이면 스크롤로 보고 밀지 않는다', !mid.icon && (await page.locator('.replying').count()) === 0, JSON.stringify(mid));
	mid = await drag('공연도 가봤어요?', 100, 0, 'mouse'); await lift('공연도 가봤어요?'); await page.waitForTimeout(300);
	check('마우스 드래그는 글자 고르기 — 밀기 아님', !mid.icon && (await page.locator('.replying').count()) === 0, JSON.stringify(mid));
	mid = await page.evaluate(async () => {
		const b = [...document.querySelectorAll('.bubble')].find((x) => x.textContent.includes('공연도 가봤어요?'));
		const row = b.closest('.row'), r = b.getBoundingClientRect(), rr = row.getBoundingClientRect();
		const x = r.right + (rr.right - r.right) / 2, y = r.top + r.height / 2; // 말풍선 오른쪽 빈자리
		const ev = (n, cx) => row.dispatchEvent(new PointerEvent(n, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, clientX: cx, clientY: y }));
		ev('pointerdown', x);
		for (let i = 1; i <= 6; i++) ev('pointermove', x - (100 * i) / 6);
		await new Promise((res) => requestAnimationFrame(() => res()));
		const w = b.closest('.bwrap'), out = { hit: document.elementFromPoint(x, y) === row, transform: w.style.transform, icon: !!w.querySelector('.swipe-ic.hit') };
		ev('pointerup', x - 100);
		return out;
	});
	await page.waitForTimeout(300);
	check('★ 말풍선 밖 빈자리(그 줄)를 밀어도 답장', mid.hit && /translateX\(-\d/.test(mid.transform) && mid.icon && (await replying()).includes('공연도 가봤어요?'), JSON.stringify(mid) + ' ' + (await replying()));
	await page.locator('.replying-x').click();
	check('말풍선: 위아래 스크롤만 브라우저에 맡긴다 (touch-action: pan-y)', (await bubble('공연도 가봤어요?').evaluate((e) => getComputedStyle(e).touchAction)) === 'pan-y');

	console.log('[첫마디 도우미]');
	await page.goto(U('/dev/chat?s=fresh'));
	await page.locator('.starters').waitFor(); await page.waitForTimeout(800);
	const chips = await page.locator('.starters .chip').allInnerTexts();
	check('질문 3개 · 첫째는 상대 관심사', chips.length === 3 && chips[0] === '밴드 좋아하시는구나! 언제부터예요?', JSON.stringify(chips));
	check('★ 신상을 묻는 질문 없음', !chips.some((c) => /학년|반이|이름|학번|인스타|번호/.test(c)));
	await page.screenshot({ path: `${SP}/feat-4-starters.png` });
	await page.locator('textarea').focus();
	await page.locator('.starters .more').evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); await page.waitForTimeout(100);
	check('입력 줄의 단추(↻ 다른 질문)는 키보드를 내리지 않는다 (data-keep-kb, Phase 46)', await page.locator('textarea').evaluate((e) => e === document.activeElement));
	const chips2 = await page.locator('.starters .chip').allInnerTexts();
	check('↻ 다른 질문', chips2.length === 3 && chips2.join() !== chips.join(), JSON.stringify(chips2));
	await page.locator('.starters .chip').first().click(); await page.waitForTimeout(100);
	check('누르면 입력창에 채워지고 보내지는 않음', (await page.locator('textarea').inputValue()) === chips2[0] && (await page.locator('.row.mine').count()) === 0);
	await page.locator('.starters').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {}); // 닫히는 연출(out:expand)이 끝날 때까지
	check('입력창에 글이 있으면 도우미 숨김', (await page.locator('.starters').count()) === 0);
	await page.keyboard.press('Enter'); await page.waitForTimeout(500);
	check('★ 한 마디 보내면 도우미 사라짐', (await page.locator('.row.mine').count()) === 1 && (await page.locator('.starters').count()) === 0);
	await page.goto(U('/dev/chat?s=chat')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(400);
	check('이미 대화한 방에는 없음', (await page.locator('.starters').count()) === 0);

	console.log('[연결 화면]');
	await page.goto(U('/dev/chat?s=fresh&matched'));
	await page.locator('.match').waitFor({ timeout: 5000 });
	check('새로 매칭된 방: "연결됐어요!" · 새벽수달님과 10분', (await page.locator('.match').innerText()).replace(/\s+/g, ' ').includes('연결됐어요!') && (await page.locator('.match').innerText()).includes('새벽수달님과 10분'));
	await page.waitForTimeout(250); await page.screenshot({ path: `${SP}/feat-5-match.png` });
	await page.waitForTimeout(1900);
	check('1.8초 뒤 저절로 닫힘', (await page.locator('.match').count()) === 0);
	await page.goto(U('/dev/chat?s=fresh&matched')); await page.locator('.match').waitFor();
	await page.locator('.match').click(); await page.waitForTimeout(150);
	check('누르면 바로 닫힘', (await page.locator('.match').count()) === 0);
	await page.goto(U('/dev/chat?s=chat')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(300);
	check('평소에 들어가면 안 뜸', (await page.locator('.match').count()) === 0);

	console.log('[메시지 삭제]');
	await page.goto(U('/dev/chat?s=chat')); await bubble('아직이요').waitFor(); await page.waitForTimeout(300);
	await bubble('안녕하세요!').click({ button: 'right' }); await page.waitForTimeout(200);
	check('상대 말에는 "삭제" 없음', (await page.getByRole('menuitem', { name: '삭제' }).count()) === 0);
	await page.keyboard.press('Escape'); await page.waitForTimeout(150);
	await bubble('아직이요').click({ button: 'right' }); await page.waitForTimeout(200);
	check('내 말에는 "삭제"', (await page.getByRole('menuitem', { name: '삭제' }).count()) === 1);
	await page.getByRole('menuitem', { name: '삭제' }).click(); await page.waitForTimeout(400);
	check('★ 지우면 "삭제했습니다" 알림', await page.getByText('삭제했습니다').isVisible());
	const gone = page.locator('.bubble.deleted');
	check('★ 말풍선은 "삭제된 메시지입니다" (흐리게)', (await gone.count()) === 1 && (await gone.innerText()).includes('삭제된 메시지입니다') && !(await page.locator('.list').innerText()).includes('아직이요'));
	await page.screenshot({ path: `${SP}/feat-7-deleted.png` });
	await gone.click({ button: 'right' }); await page.waitForTimeout(200);
	check('지운 말은 다시 메뉴가 안 뜬다', (await page.locator('.rx-pick').count()) === 0);

	console.log('[둘 다 볼 때만 시간]');
	await page.goto(U('/dev/chat?s=paused')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(300);
	const t1 = await page.locator('.timer').innerText();
	await page.waitForTimeout(2200);
	const t2 = await page.locator('.timer').innerText();
	check('★ 멈춘 동안 시간이 줄지 않는다 (5:00 그대로 · 멈춤 표시)', t1 === t2 && t1.includes('5:00') && (await page.locator('.timer .pause-ic').count()) === 1 && (await page.locator('.paused-bar').isVisible()), `${t1} → ${t2}`);
	await page.screenshot({ path: `${SP}/feat-8-paused.png` });
	await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
	await page.waitForTimeout(200);
	await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
	await page.waitForTimeout(200);
	const views = await page.evaluate(() => window.__views ?? []);
	check('★ 앱을 내리면 "안 봄", 돌아오면 "봄"을 서버에 알린다', JSON.stringify(views.slice(-2)) === '[false,true]', JSON.stringify(views));
	await page.goto(U('/dev/chat?s=chat')); await bubble('안녕하세요!').waitFor();
	const a1 = await page.locator('.timer').innerText(); await page.waitForTimeout(2200);
	check('둘 다 보고 있으면 평소처럼 흐른다', a1 !== (await page.locator('.timer').innerText()) && (await page.locator('.timer .pause-ic').count()) === 0);

	console.log('[연장 공개 — 각자 고른다: 학년 · 디플로마 · 동아리 · 랜덤 질문 (Phase 103)]');
	await page.goto(U('/dev/chat?s=hints')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(300);
	check('★ 공개된 상대 힌트: 학년 · 질문 답', (await page.locator('.hint-chip').allInnerTexts()).map((x) => x.replace(/\s+/g, '')).join(',') === '학년2학년,요즘빠져있는것밴드음악', JSON.stringify(await page.locator('.hint-chip').allInnerTexts()));
	check('★ 고를 것: 이미 공개한 학년은 빠지고 디플로마 · 동아리 · 랜덤 질문', (await page.getByRole('radio').allInnerTexts()).map((x) => x.replace(/\s+/g, '')).join(',') === '디플로마,동아리,랜덤질문', JSON.stringify(await page.getByRole('radio').allInnerTexts()));
	await page.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(300);
	check('★ 안 고르면 연장이 안 된다', (await page.evaluate(() => (window.__votes ?? []).length)) === 0 && (await page.getByText('연장하면 공개할 것을 하나 골라 주세요').isVisible()));
	await page.getByRole('radio', { name: /디플로마/ }).click();
	const dip = page.getByRole('combobox', { name: '내 디플로마 검색' });
	check('디플로마를 고르면 검색 칸 · "둘 다 동의하면 공개: 디플로마"', (await page.locator('.extend').innerText()).includes('둘 다 동의하면 공개: 디플로마') && (await dip.count()) === 1);
	check('비어 있으면 목록을 늘어놓지 않는다 (적어야 검색)', (await page.locator('#dip-list').count()) === 0);
	await page.screenshot({ path: `${SP}/feat-9-hints.png` });
	await page.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(300);
	check('★ 디플로마를 안 고르면 연장이 안 된다', (await page.evaluate(() => (window.__votes ?? []).length)) === 0 && (await page.getByText('디플로마를 검색해서 골라 주세요').isVisible()));
	await dip.fill('과학'); await page.waitForTimeout(200);
	check('★ 적으면 학교 디플로마 중 맞는 것만 (과학 → 생명과학 · 사회과학)', (await page.locator('#dip-list [role=option]').allInnerTexts()).join(',') === '생명과학,사회과학', (await page.locator('#dip-list').innerText()));
	await page.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(300);
	check('★ 목록에 없는 글("과학")로는 연장이 안 된다', (await page.evaluate(() => (window.__votes ?? []).length)) === 0);
	await dip.fill('ㅁㄹ'); await page.waitForTimeout(200);
	check('초성으로도 찾는다 (ㅁㄹ → 물리학)', (await page.locator('#dip-list [role=option]').allInnerTexts()).join(',') === '물리학');
	await dip.fill('물리'); await page.waitForTimeout(150);
	// 아이폰은 버튼을 눌러도 입력칸에서 초점이 빠지지 않는다 — 초점을 옮기지 않는 click 으로 흉내 (Phase 46)
	await page.locator('#dip-list [role=option]', { hasText: '물리학' }).evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
	await page.waitForTimeout(150);
	check('고르면 칸에 채워지고 목록이 닫힌다', (await dip.inputValue()) === '물리학' && (await page.locator('#dip-list').count()) === 0);
	check('★ 검색해서 고르면 검색 키보드를 내린다 (칸에서 초점이 빠진다)', await dip.evaluate((e) => e !== document.activeElement));
	await page.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(300);
	check('★ 고르고 연장하면 고른 것 · 그 값과 함께 투표', JSON.stringify(await page.evaluate(() => window.__votes)) === '[{"agree":true,"hint":"물리학","kind":"diploma"}]', JSON.stringify(await page.evaluate(() => window.__votes)));

	await page.goto(U('/dev/chat?s=question')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(300);
	await page.getByRole('radio', { name: /랜덤 질문/ }).click(); await page.waitForTimeout(1900);
	const qBox = page.getByRole('textbox', { name: '랜덤 질문 요즘 빠져 있는 것 — 내 답' });
	check('★ 랜덤 질문: 슬롯이 이번 질문에 멈추고 내 답 칸', (await page.locator('.slot').getAttribute('aria-label')) === '이번 질문 요즘 빠져 있는 것' && (await qBox.count()) === 1 && (await qBox.getAttribute('maxlength')) === '30');
	await page.screenshot({ path: `${SP}/feat-10-question.png` });
	await page.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(300);
	check('답을 안 적으면 연장이 안 된다', (await page.evaluate(() => (window.__votes ?? []).length)) === 0 && (await page.getByText('답을 적어 주세요').isVisible()));
	await qBox.fill('러닝');
	await page.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(300);
	check('답과 함께 투표', JSON.stringify(await page.evaluate(() => window.__votes)) === '[{"agree":true,"hint":"러닝","kind":"question"}]');

	console.log('[시간이 다 된 뒤 "연장할까요?" — 평가 전에 (Phase 103)]');
	await page.goto(U('/dev/chat?s=decide')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(300);
	const card = page.locator('.decide');
	check('★ 시간이 다 되면 가운데 "연장할까요?" · 남은 초 · 입력은 막힘', (await card.count()) === 1 && /\d+초 안에 골라 주세요/.test(await card.innerText()) && (await page.locator('textarea').isDisabled()), await card.innerText());
	await card.getByRole('radio', { name: /학년/ }).click();
	await card.getByRole('button', { name: '더 얘기하기' }).click(); await page.waitForTimeout(2200);
	check('★ 연장되면 화면이 닫히고 상대가 고른 공개가 슬롯 칸에 — "상대는 2학년!"', (await card.count()) === 0 && (await page.locator('.slot').getAttribute('aria-label')) === '상대는 2학년!', await page.locator('.slot').getAttribute('aria-label'));

	console.log('[대화 고정]');
	await page.goto(U('/dev/chat?s=pin')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(300);
	const pinBar = await page.locator('.extend').innerText();
	check('★ 60분 째: "이 채팅을 고정하시겠습니까?" · 상대가 원함 · 적는 칸 없음', pinBar.includes('이 채팅을 고정하시겠습니까?') && pinBar.includes('상대가 고정을 원해요') && (await page.locator('.extend input').count()) === 0, pinBar);
	check('공개된 힌트 다섯 가지', (await page.locator('.hint-chip').count()) === 5);
	await page.screenshot({ path: `${SP}/feat-11-pin.png` });
	await page.getByRole('button', { name: '고정하기' }).click(); await page.waitForTimeout(300);
	check('고정하기 = 힌트 없이 동의', JSON.stringify(await page.evaluate(() => window.__votes)) === '[{"agree":true,"hint":null}]');
	await page.goto(U('/dev/chat?s=pinned')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(1200);
	check('★ 고정한 대화: 타이머 대신 "고정됨" · 연장 배너 · 시간 종료 없음', (await page.locator('.pinned-tag').innerText()).includes('고정됨') && (await page.locator('.timer').count()) === 0 && (await page.locator('.extend').count()) === 0 && (await page.getByText('시간 종료').count()) === 0 && !(await page.locator('textarea').isDisabled()));
	await page.getByRole('button', { name: '메뉴' }).click(); await page.getByRole('button', { name: '대화 나가기' }).click();
	check('나가기 확인에 "고정한 대화" 안내', (await page.locator('.warn').innerText()).includes('고정한 대화'));
	await page.screenshot({ path: `${SP}/feat-12-pinned.png` });

	console.log('[매너 온도 · 평가 (Phase 30)]');
	await page.goto(U('/dev/chat?s=chat')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(400);
	check('대화 맨 위 소개에 상대 매너 온도', (await page.locator('.intro').innerText()).includes('42.3°C'));
	await page.goto(U('/dev/chat?s=rate')); await page.locator('.rate-card').waitFor(); await page.waitForTimeout(300); // 끝난 대화는 메시지를 불러오지 않는다
	const rc = page.locator('.rate-card');
	check('★ 끝난 대화: "새벽수달님과의 대화, 어땠어요?" 평가 카드', (await rc.innerText()).includes('새벽수달님과의 대화, 어땠어요?'));
	check('표정을 고르기 전에는 보낼 수 없다', await rc.getByRole('button', { name: '평가 보내기' }).isDisabled());
	await rc.getByRole('radio', { name: '아쉬웠어요' }).click();
	check('아쉬웠어요 → 아쉬운 이유 칩만', (await rc.getByRole('button', { name: '무례해요' }).count()) === 1 && (await rc.getByRole('button', { name: '친절해요' }).count()) === 0);
	await rc.getByRole('button', { name: '무례해요' }).click();
	await rc.getByRole('radio', { name: '좋았어요' }).click();
	check('좋았어요로 바꾸면 칩도 바뀌고 고른 것은 비워진다', (await rc.getByRole('button', { name: '친절해요' }).count()) === 1 && (await rc.locator('.chip.on').count()) === 0);
	await rc.getByRole('button', { name: '친절해요' }).click();
	await rc.getByRole('button', { name: '대화가 재밌어요' }).click();
	await page.screenshot({ path: `${SP}/feat-13-rate.png` });
	await rc.getByRole('button', { name: '평가 보내기' }).click(); await page.waitForTimeout(300);
	check('★ 보내면 표정 · 칩이 그대로 서버로', JSON.stringify(await page.evaluate(() => window.__rates)) === '[{"score":"good","reasons":["kind","fun"]}]', JSON.stringify(await page.evaluate(() => window.__rates)));
	check('보낸 뒤 카드 대신 안내', (await rc.count()) === 0 && (await page.getByText('평가를 보냈어요 · 매너 온도는 내일 새벽에 반영돼요').isVisible()));
	await page.goto(U('/dev/chat?s=pinrate')); await bubble('안녕하세요!').waitFor(); await page.waitForTimeout(400);
	check('고정한 대화: 위쪽 "평가하기" 막대', await page.locator('.rate-bar').isVisible());
	await page.locator('.rate-bar').click(); await page.waitForTimeout(200);
	check('막대를 누르면 평가 시트', await page.getByRole('dialog', { name: '매너 평가' }).isVisible());
	await page.screenshot({ path: `${SP}/feat-14-pinrate.png` });
	await page.getByRole('button', { name: '나중에 할게요' }).click();
	// 시트가 닫히는 움직임(약 0.3초)이 끝날 때까지 — 0.2초 고정 대기는 느린 기계에서 가끔 모자랐다
	await page.getByRole('dialog', { name: '매너 평가' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
	check('나중에 → 시트 닫힘 · 막대는 남는다', (await page.getByRole('dialog', { name: '매너 평가' }).count()) === 0 && (await page.locator('.rate-bar').isVisible()));
	await page.getByRole('button', { name: '프로필 보기' }).first().click(); await page.waitForTimeout(300);
	check('상대 프로필 시트에 매너 온도 막대', (await page.locator('.profile').innerText()).includes('매너 온도') && (await page.locator('.profile').innerText()).includes('42.3°C'));
	await page.keyboard.press('Escape');

	console.log('[내 말풍선 그라디언트 — 스크롤 중 다시 칠하지 않는다]');
	const sp = await (await browser.newContext({ viewport: { width: 390, height: 360 } })).newPage();
	await sp.goto(U('/dev/chat?s=chat')); await sp.locator('.bubble', { hasText: '안녕하세요!' }).waitFor(); await sp.waitForTimeout(400);
	const paint = await sp.locator('.mine .bubble').first().evaluate((b) => ({ image: getComputedStyle(b).backgroundImage, after: getComputedStyle(b, '::before').animationName, content: getComputedStyle(b, '::before').content }));
	check('★ 말풍선 자체의 고정 그라디언트 · 스크롤 연동 애니메이션 없음', paint.image.startsWith('linear-gradient') && paint.after === 'none' && paint.content === 'none', JSON.stringify(paint));
	check('말풍선 바탕은 테마의 가운데 색 (인스타 #d6246e)', (await sp.locator('.mine .bubble').first().evaluate((b) => getComputedStyle(b).backgroundColor)) === 'rgb(214, 36, 110)');
	check('페이지 오류 없음', errs.length === 0, errs.join(' / '));
} finally { await browser.close(); stopProcess(vite);  }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

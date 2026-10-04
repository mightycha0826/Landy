import { ROOT, CHROME, OUT } from './_env.mjs';
import { chromium } from 'playwright-core';
// 학생 앱 공지사항 — 종 아이콘 · 빨간 점 · /notices (가짜 Supabase 를 브라우저 요청 가로채기로)
const SP = OUT;
const BASE = 'http://localhost:5199';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();

let notices = [
	{ id: 2, title: '시험 기간 운영 안내', body: '시험 기간에는 밤 10시에 닫아요.\n둘째 줄', created_at: ago(30) },
	{ id: 1, title: '처음 공지', body: '', created_at: ago(60 * 30) }
];
let lastSeen = 1;
const inquiries = [{ id: 1, kind: 'bug', body: '예전에 보낸 문의', created_at: new Date().toISOString(), answer: '확인했어요, 고쳤어요!', answered_at: new Date().toISOString() }];
const inqCalls = [];
const marks = [];

let GATE = false; // 익명편지 잠금 (Phase 44)
let FRESH = false; // 새로 딴 업적이 있다 (Phase 89 — 저절로 뜨는 창의 순서)
let freshCalls = 0;
const prof = { id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true, allow_rematch: false, letters_open: true, letters_recommend: true };
const patches = [];
let failPatch = false, tokenGate = null;
const passwordUpdates = [];

const browser = await chromium.launch({ executablePath: CHROME });
try {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.text().startsWith('DBG') && console.log('   ', m.text()));
	await page.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request(); const u = new URL(req.url());
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (u.pathname === '/auth/v1/token') { if (tokenGate) await tokenGate; return json(session); }
		if (u.pathname === '/auth/v1/user') { if (req.method() === 'PUT') passwordUpdates.push(req.postDataJSON()); return json(session.user); }
		if (u.pathname.startsWith('/auth/v1/')) return json({});
		if (u.pathname === '/rest/v1/rpc/my_account') return json({ has_password: true });
		if (u.pathname === '/rest/v1/rpc/my_rooms') return json({ rooms: [], server_now: new Date().toISOString() });
		if (u.pathname === '/rest/v1/rpc/my_notices') return json({ notices, last_seen: lastSeen });
		if (u.pathname === '/rest/v1/rpc/mark_notices_seen') { const p = req.postDataJSON().p_id; marks.push(p); lastSeen = Math.max(lastSeen, p); return json(lastSeen); }
		if (u.pathname === '/rest/v1/profiles') {
			if (req.method() === 'PATCH') {
				if (failPatch) { failPatch = false; return json({ message: '설정 저장 실패' }, 400); }
				Object.assign(prof, req.postDataJSON()); patches.push(req.postDataJSON()); return route.fulfill({ status: 204 });
			}
			return json(prof);
		}
		if (u.pathname === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 30, join_grace_sec: 30, max_rounds: 99, heartbeat_sec: 30, presence_ttl_sec: 70, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300, letters_gate: GATE, letters_gate_min: 100 });
		if (u.pathname === '/rest/v1/signup_stats') return json({ students: 42 }); // Phase 44 — 가입한 학생 수
		// 문의 (Phase 37)
		if (u.pathname === '/rest/v1/rpc/my_inquiries') { inqCalls.push('list'); return json(inquiries); }
		if (u.pathname === '/rest/v1/rpc/send_inquiry') {
			const a = req.postDataJSON(); inqCalls.push(a);
			if (inquiries.filter((q) => !q.answer).length >= 1) return json({ status: 'too_many' });
			inquiries.unshift({ id: 10 + inquiries.length, kind: a.p_kind, body: a.p_body, created_at: new Date().toISOString(), answer: null, answered_at: null });
			return json({ status: 'ok', id: 10 });
		}
		if (u.pathname === '/rest/v1/rpc/heartbeat') return json({ server_now: new Date().toISOString(), ach_new: FRESH });
		if (u.pathname === '/rest/v1/rpc/new_achievements') { freshCalls++; return json(FRESH ? [{ code: 'pioneer', title: '개척자', icon: 'flag', tier: 3 }] : []); }
		if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
		return json([]);
	});
	// 알림 안내는 평소엔 물은 것으로 — e2e-ask 가 있으면 아직 묻지 않은 기기 (Phase 89)
	await page.addInitScript(() => { try { localStorage.getItem('e2e-ask') ? localStorage.removeItem('push-asked-v1') : localStorage.setItem('push-asked-v1', '1'); } catch {} });

	await page.goto(`${BASE}/login`);
	await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
	await page.getByPlaceholder('비밀번호').fill('abcd1234');
	await page.getByRole('button', { name: '로그인', exact: true }).click();
	await page.waitForURL(`${BASE}/`, { timeout: 8000 }).catch(() => {});
	await page.locator('a.logo').waitFor({ timeout: 8000 });
	await page.waitForTimeout(600);
	const idx = () => page.evaluate(() => navigation.currentEntry.index);
	const toastText = () => page.locator('.toasts').innerText().catch(() => '');
	const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(400); };

	console.log('[로고]');
	const logo = page.locator('a.logo');
	check('로고 = 홈 링크, 끌 수 없음', (await logo.getAttribute('href')) === '/' && (await logo.getAttribute('draggable')) === 'false');
	const lb = await logo.boundingBox();
	await page.mouse.move(lb.x + 3, lb.y + lb.height / 2); await page.mouse.down();
	await page.mouse.move(lb.x + lb.width - 3, lb.y + lb.height / 2, { steps: 6 }); await page.mouse.up();
	check('로고를 드래그해도 글자가 잡히지 않는다', (await page.evaluate(() => getSelection().toString())) === '');
	check('하단 탭 3개 — 익명편지 · 채팅 · 프로필 순서', (await page.locator('a.tab').allInnerTexts()).map((t) => t.trim()).join(',') === '익명편지,채팅,프로필',
		(await page.locator('a.tab').allInnerTexts()).join(','));
	check('상단 오른쪽 = 알림 하트 + 설정 톱니 (프로필 사진 없음)', (await page.locator('button.settings').count()) === 1 && (await page.locator('button.heart').count()) === 1 && (await page.locator('button.me').count()) === 0);
	await page.locator('a.tab', { hasText: '프로필' }).click(); await page.waitForURL('**/me'); await page.waitForTimeout(500);
	check('프로필 탭 → 탭바 그대로 · 프로필 탭 켜짐', (await page.locator('a.tab.on').innerText()).includes('프로필') && (await page.locator('button.back').count()) === 0);
	check('프로필 탭 전환도 기록을 쌓지 않는다', (await idx()) === 1, String(await idx()));
	const heads = async () => (await page.locator('.g-head').allInnerTexts()).map((t) => t.replace(/\s+\d.*$/, ''));
	const meHeads = await heads();
	check('프로필 = 소개 · 관심사 · MBTI · 상대 (알림 · 비밀번호 · 로그아웃 없음)',
		meHeads.join(',') === '소개,관심사,MBTI,이런 사람과 이야기할래요' && (await page.getByRole('button', { name: '로그아웃' }).count()) === 0, meHeads.join(','));
	check('프로필: 설정식 — 회색 바탕 위 둥근 카드', (await page.locator('.page.grouped').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(246, 243, 240)'
		&& (await page.locator('.g-card').first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius)) === '24px');
	check('상대 고르기 = 체크 표시 줄 (지금 고른 것 하나)', (await page.getByRole('radio', { checked: true }).count()) === 1);
	await page.screenshot({ path: `${SP}/profile.png`, fullPage: true });
	await back(); await page.waitForTimeout(300);
	check('★ 프로필에서 뒤로 → 채팅 홈', new URL(page.url()).pathname === '/' && (await idx()) === 1, `${page.url()} ${await idx()}`);
	await logo.click(); await page.waitForTimeout(300);
	check('홈에서 로고 누르기 → 홈 그대로', new URL(page.url()).pathname === '/');

	console.log('[홈에서 뒤로가기]');
	check('홈: 맨 아래 홈 + 표식 하나', (await idx()) === 1, String(await idx()));
	await back();
	check('★ 뒤로 한 번 → "한 번 더 누르면 종료" 안내, 화면은 홈 그대로', (await toastText()).includes('뒤로가기를 한 번 더 누르면 종료됩니다') && new URL(page.url()).pathname === '/');
	check('★ 이제 기록 맨 아래 → 한 번 더 누르면 앱이 닫힌다', (await idx()) === 0, String(await idx()));
	await page.waitForTimeout(2300);
	check('2초가 지나면 다시 처음 상태 (다시 안내부터)', (await idx()) === 1, String(await idx()));

	console.log('[탭]');
	await page.locator('a.tab', { hasText: '익명편지' }).click(); await page.waitForURL('**/letters'); await page.waitForTimeout(500);
	check('탭 전환은 기록을 쌓지 않는다', (await idx()) === 1, String(await idx()));
	await page.locator('a.tab', { hasText: '채팅' }).click(); await page.waitForURL(`${BASE}/`); await page.waitForTimeout(400);
	await page.locator('a.tab', { hasText: '익명편지' }).click(); await page.waitForURL('**/letters'); await page.waitForTimeout(400);
	check('여러 번 오가도 그대로', (await idx()) === 1, String(await idx()));
	const tabCenters = await page.evaluate(() => {
		const pill = document.querySelector('.tab-indicator').getBoundingClientRect();
		const selected = document.querySelector('.tab.on').getBoundingClientRect();
		return { pill: pill.x + pill.width / 2, selected: selected.x + selected.width / 2, nav: document.documentElement.dataset.nav };
	});
	check('탭 표시가 선택한 탭의 중앙에 정착하고 전환 상태 정리', Math.abs(tabCenters.pill - tabCenters.selected) < 1 && !tabCenters.nav, JSON.stringify(tabCenters));
	// Also exercise the ordinary CSS arrival when View Transitions are unavailable.
	await page.evaluate(() => { window.__viewTransition = document.startViewTransition; document.startViewTransition = undefined; });
	await page.locator('a.tab', { hasText: '프로필' }).click(); await page.waitForURL('**/me'); await page.waitForTimeout(400);
	check('View Transitions 미지원에서도 탭 내용과 표시 정상', await page.locator('a.tab.on').innerText() === '프로필' && await page.locator('.page').first().evaluate((el) => Number(getComputedStyle(el).opacity)) === 1);
	await page.locator('a.tab', { hasText: '익명편지' }).click(); await page.waitForURL('**/letters'); await page.waitForTimeout(400);
	await page.evaluate(() => { document.startViewTransition = window.__viewTransition; delete window.__viewTransition; });
	await back(); await page.waitForTimeout(300);
	check('★ 익명편지에서 뒤로 → 채팅 홈', new URL(page.url()).pathname === '/' && (await idx()) === 1, `${page.url()} ${await idx()}`);
	await back();
	check('이어서 뒤로 → 종료 안내', (await toastText()).includes('한 번 더') && (await idx()) === 0);
	await page.waitForTimeout(2300);

	console.log('[다른 화면에서 돌아오기]');
	await page.locator('button.heart').click(); await page.waitForURL('**/activity'); await page.locator('button.row').first().click(); await page.waitForURL('**/notices/*'); await page.waitForTimeout(300);
	await page.locator('button.back').click(); await page.waitForURL('**/activity'); await page.waitForTimeout(300);
	await page.locator('button.back').click(); await page.waitForURL(`${BASE}/`); await page.waitForTimeout(500);
	check('공지 → 뒤로 → 알림 → 뒤로 → 홈, 기록 늘지 않음', (await idx()) === 1, String(await idx()));
	await page.locator('button.heart').click(); await page.waitForURL('**/activity'); await page.locator('button.row').first().click(); await page.waitForURL('**/notices/*'); await page.waitForTimeout(300);
	await back(); await back();
	check('휴대폰 뒤로가기로 돌아와도 같음 (안내 없이 홈)', new URL(page.url()).pathname === '/' && (await idx()) === 1);

	console.log('[아이폰 상태바]');
	// 홈 화면 앱(black-translucent)은 화면이 상태바 밑까지 올라간다 — 안전영역 47px 을 흉내 내서 머리글이 그만큼 내려오는지
	await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '47px')); await page.waitForTimeout(100);
	const tb = await page.locator('.topbar').first().boundingBox();
	const lg = await page.locator('a.logo').boundingBox();
	check('★ 머리글 = 상태바 47 + 48, 로고는 상태바 아래', Math.round(tb.height) === 95 && lg.y >= 47, `${tb.height} ${lg.y}`);
	await page.evaluate(() => document.documentElement.style.removeProperty('--safe-top'));
	check('안전영역이 없으면 48 그대로', Math.round((await page.locator('.topbar').first().boundingBox()).height) === 48);

	console.log('[설정 · 테마 색상]');
	const fill = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bubble-fill').trim());
	const before = await fill();
	await page.locator('button.settings').click(); await page.waitForURL('**/settings'); await page.waitForTimeout(300);
	check('톱니 → 설정 화면 (탭바 숨김)', (await page.locator('.title').innerText()) === '설정' && (await page.locator('nav.tabbar').count()) === 0);
	const setHeads = await heads();
	check('★ 설정 = 화면 · 테마 색상 · 알림 · 대화 · 편지 · 뱃지(Phase 84) · 계정 · 도움(문의) · 약관 및 정책 · 앱 · 로그아웃', setHeads.join(',') === '테마 색상,알림,대화,편지,뱃지,계정,도움,약관 및 정책,앱'
		&& (await page.getByRole('switch', { name: '푸시 알림' }).count()) === 1 && (await page.getByText('학교 인증').count()) === 1
		&& (await page.getByRole('button', { name: '로그아웃' }).count()) === 1, setHeads.join(','));
	check('뒤로는 둥근 단추 · 제목 가운데', (await page.locator('button.back').evaluate((e) => getComputedStyle(e).borderRadius)) === '50%'
		&& Math.abs(await page.locator('.topbar .title').evaluate((e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2 - innerWidth / 2; })) < 2);
	const rematch = page.getByRole('switch', { name: '만났던 사람 다시 만나기' });
	check('매칭: "만났던 사람 다시 만나기" 스위치 — 기본 꺼짐', (await rematch.count()) === 1 && !(await rematch.isChecked()));
	await rematch.click(); await page.waitForTimeout(400);
	check('★ 켜면 내 프로필에 저장 (allow_rematch = true) · 스위치 켜짐', JSON.stringify(patches.at(-1)) === '{"allow_rematch":true}' && (await rematch.isChecked()), JSON.stringify(patches));
	await rematch.click(); await page.waitForTimeout(400);
	check('다시 끄면 false 로 저장', JSON.stringify(patches.at(-1)) === '{"allow_rematch":false}' && !(await rematch.isChecked()));
	failPatch = true;
	await rematch.click(); await page.getByText('설정 저장 실패', { exact: true }).waitFor();
	check('설정 저장 실패는 스위치를 원래 값에 유지하고 재시도 허용', !(await rematch.isChecked()) && await rematch.isEnabled());
	const receiveLetters = page.getByRole('switch', { name: '편지 받기', exact: true });
	const recommendLetters = page.getByRole('switch', { name: '추천에 나오기', exact: true });
	await receiveLetters.click(); await page.waitForTimeout(400);
	check('편지 받기를 끄면 같은 저장 경로로 처리하고 추천 스위치 비활성화', patches.at(-1).letters_open === false && !(await receiveLetters.isChecked()) && await recommendLetters.isDisabled());
	await receiveLetters.click(); await page.waitForTimeout(400);
	await recommendLetters.click(); await page.waitForTimeout(400);
	check('추천 스위치는 별도 프로필 필드만 저장', JSON.stringify(patches.at(-1)) === '{"letters_recommend":false}' && !(await recommendLetters.isChecked()));
	await recommendLetters.click(); await page.waitForTimeout(400);
	check('색 후보 4개 — 파랑만 단색, 나머지는 그라데이션', await page.evaluate(() => {
		const dots = [...document.querySelectorAll('.swatch')].map((l) => ({ n: l.querySelector('input').getAttribute('aria-label'), bg: getComputedStyle(l.querySelector('.dot')).backgroundImage }));
		const cols = (bg) => new Set(bg.match(/rgb\([^)]*\)/g)).size;
		return dots.length === 4 && dots.every((d) => (d.n === '파랑' ? cols(d.bg) === 1 : cols(d.bg) >= 2));
	}));
	const pwRow = page.getByRole('button', { name: /^비밀번호 (바꾸기|만들기)$/ });
	await pwRow.click(); await page.waitForTimeout(150);
	check('비밀번호 줄 → 카드 안에서 펼침 (›가 아래로)', (await pwRow.getAttribute('aria-expanded')) === 'true' && (await page.getByPlaceholder('지금 비밀번호').count()) === 1);
	await pwRow.click();
	await page.getByPlaceholder('지금 비밀번호').waitFor({ state: 'detached' });
	check('다시 누르면 접힘', (await pwRow.getAttribute('aria-expanded')) === 'false' && (await page.getByPlaceholder('지금 비밀번호').count()) === 0);
	await pwRow.click(); await page.getByPlaceholder('지금 비밀번호').fill('abcd1234');
	let releaseVerification;
	tokenGate = new Promise((resolve) => { releaseVerification = resolve; });
	const verificationRequest = page.waitForRequest((request) => request.url().includes('/auth/v1/token'));
	await page.getByRole('button', { name: '확인', exact: true }).click(); await verificationRequest;
	await page.getByRole('button', { name: '취소', exact: true }).click();
	const verificationResponse = page.waitForResponse((response) => response.url().includes('/auth/v1/token'));
	releaseVerification(); tokenGate = null; await verificationResponse; await page.waitForTimeout(500);
	check('비밀번호 확인 중 취소하면 늦은 성공이 입력 폼을 다시 열지 않음', await pwRow.getAttribute('aria-expanded') === 'false' && await page.getByPlaceholder('새 비밀번호').count() === 0);
	await pwRow.click(); await page.getByPlaceholder('새 비밀번호').fill('changed1234'); await page.getByPlaceholder('한 번 더').fill('changed1234');
	await page.locator('#password').getByRole('button', { name: '저장', exact: true }).click();
	await page.getByText('비밀번호 저장 완료', { exact: true }).waitFor();
	check('최근 재인증 후 새 비밀번호 저장은 확인 입력과 서버 저장을 거쳐 접힘', passwordUpdates.at(-1)?.password === 'changed1234' && await pwRow.getAttribute('aria-expanded') === 'false');
	await page.screenshot({ path: `${SP}/settings.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(150);
	await page.screenshot({ path: `${SP}/settings-dark.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	const swatch = (name) => page.locator('.swatch', { has: page.getByRole('radio', { name }) });
	check('기본 색이 골라져 있다', (await page.getByRole('radio', { name: '기본' }).isChecked()) && (await swatch('기본').getAttribute('class')).includes('on'));
	check('색 동그라미 아래 글자 없음 (이름은 화면 낭독기에만)', (await page.locator('.swatches').innerText()).trim() === '');
	await swatch('파랑').click(); await page.waitForTimeout(200);
	const blue = await fill();
	check('★ 파랑을 고르면 대비를 높인 말풍선 색이 바로 바뀐다', blue !== before && blue.includes('#3173cc'), blue);
	const mine = await page.locator('.preview .mine .bubble').first().evaluate((e) => getComputedStyle(e).backgroundImage);
	check('미리보기 말풍선에도 입혀진다', mine.includes('49, 115, 204'), mine);
	const tok = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return ['--accent-fill', '--accent', '--brand'].map((k) => cs.getPropertyValue(k).trim()); });
	const [af, ac, br] = await tok();
	check('★ 앱 전체 색이 바뀐다 — 대비를 높인 버튼·글자와 원래 로고색', af.includes('#3173cc') && ac === '#3173cc' && br.includes('#3b8af6'), JSON.stringify([af, ac, br]));
	check('설정 안의 포인트(화면 모드 고른 칸)도 파랑', (await page.locator('[aria-labelledby="theme-h"] .seg-btn.on').evaluate((e) => getComputedStyle(e).backgroundImage)).includes('49, 115, 204'));
	check('이 기기에 저장', (await page.evaluate(() => localStorage.getItem('chat-color-v1'))) === 'ocean');
	await page.screenshot({ path: `${SP}/settings-color.png` });
	check('긴 설정 화면에서도 머리글 52px 그대로 (눌려 줄지 않음)', Math.round((await page.locator('.topbar').boundingBox()).height) === 52, String((await page.locator('.topbar').boundingBox()).height));
	await page.reload(); await page.locator('.swatch.on').waitFor({ timeout: 8000 });
	check('다시 열어도 그대로', (await fill()).includes('#3173cc') && (await page.getByRole('radio', { name: '파랑' }).isChecked()));
	await page.goto(`${BASE}/`); await page.locator('a.logo').waitFor(); await page.waitForTimeout(400);
	await page.screenshot({ path: `${SP}/home-theme-blue.png` });
	check('★ 홈 로고도 테마 색 (파랑)', (await page.locator('a.logo').evaluate((e) => { const cs = getComputedStyle(e); return cs.backgroundImage + cs.color; })).includes('59, 138, 246'));
	await page.goto(`${BASE}/settings`); await page.locator('.swatch.on').waitFor({ timeout: 8000 });
	await swatch('기본').click(); await page.waitForTimeout(200);
	check('기본으로 되돌리면 저장값도 지운다', (await fill()) === before && (await page.evaluate(() => localStorage.getItem('chat-color-v1'))) === null);
	check('기본으로 되돌리면 앱 색도 원래대로', (await tok()).every((v) => !v.includes('#3b8af6')) && (await tok())[0].includes('#843ed8'), JSON.stringify(await tok()));

	console.log('[설정 · 글자 크기 · 이 기기 설정 (Phase 43)]');
	const prefs = () => page.evaluate(() => localStorage.getItem('prefs-v1'));
	const html = (k) => page.evaluate((k) => document.documentElement.dataset[k] ?? null, k);
	const previewFs = () => page.locator('.preview .bubble').first().evaluate((e) => getComputedStyle(e).fontSize);
	check('글자 크기: 네 단계 · 기본은 보통 (15px)', (await page.getByRole('radiogroup', { name: '글자 크기' }).getByRole('radio').count()) === 4
		&& (await page.getByRole('radio', { name: '보통' }).getAttribute('aria-checked')) === 'true' && (await previewFs()) === '15px' && (await prefs()) === null);
	await page.getByRole('radio', { name: '아주 크게' }).click(); await page.waitForTimeout(150);
	check('★ 아주 크게 → 미리보기 말풍선이 바로 커지고(19px) 이 기기에 저장', (await previewFs()) === '19px' && (await html('text')) === 'xl' && (await prefs()) === '{"text":"xl"}', `${await previewFs()} ${await prefs()}`);
	await page.getByRole('radio', { name: '반듯한 글씨' }).click(); await page.getByRole('switch', { name: 'Enter 키로 보내기' }).click();
	await page.getByRole('switch', { name: '봉투 여는 장면' }).click(); await page.getByRole('switch', { name: '움직임 줄이기' }).click(); await page.waitForTimeout(150);
	check('★ 편지지 글씨 · Enter 키 · 봉투 장면 · 움직임 — 이 기기에 저장, <html> 에 입혀진다', (await html('letterFont')) === 'plain' && (await html('motion')) === 'reduce'
		&& JSON.stringify(JSON.parse(await prefs())) === JSON.stringify({ text: 'xl', motion: true, letterFont: 'plain', envelope: false, enterSend: false }), await prefs());
	await page.reload(); await page.getByRole('radiogroup', { name: '글자 크기' }).waitFor({ timeout: 8000 });
	check('★ 다시 켜도 그대로 (첫 화면부터 <html> 에)', (await html('text')) === 'xl' && (await html('letterFont')) === 'plain' && (await page.getByRole('radio', { name: '아주 크게' }).getAttribute('aria-checked')) === 'true'
		&& !(await page.getByRole('switch', { name: 'Enter 키로 보내기' }).isChecked()) && (await previewFs()) === '19px');
	check('버전 = 빌드 시각', /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/.test((await page.locator('.g-row', { hasText: /^버전/ }).locator('.g-val').innerText()).trim()));
	await page.getByRole('button', { name: '이 기기 설정 초기화' }).click();
	await page.getByRole('button', { name: '되돌리기' }).click(); await page.waitForTimeout(200);
	check('★ 이 기기 설정 초기화 → 모두 기본 · 저장값 지움', (await prefs()) === null && (await html('text')) === null && (await html('letterFont')) === null && (await html('motion')) === null
		&& (await previewFs()) === '15px' && (await page.getByRole('switch', { name: 'Enter 키로 보내기' }).isChecked()) && (await toastText()).includes('처음으로 되돌렸어요'));

	console.log('[설정 · 약관 및 정책]');
	const legal = page.locator('a.legal-row');
	check('★ 약관 및 정책 = 이용약관 · 개인정보 처리방침 · 운영정책 (각각 한 줄 설명)', (await legal.count()) === 3
		&& (await legal.locator('.legal-text > span').allInnerTexts()).join(',') === '이용약관,개인정보 처리방침,운영정책'
		&& (await legal.locator('small').allInnerTexts()).every((t) => t.length > 0));
	for (const [label, path, must] of [['이용약관', 'terms', '@cnsa.hs.kr'], ['개인정보 처리방침', 'privacy', '24시간이 지난 대화를 매일 새벽 정리'], ['운영정책', 'policy', '자동으로 차단']]) {
		await page.locator('a.legal-row', { hasText: label }).click(); await page.waitForURL(`**/settings/${path}`); await page.locator('article h1').waitFor();
		const txt = await page.locator('article').innerText();
		check(`★ ${label} 페이지 (제목 · 시행일 · 내용)`, (await page.locator('article h1').innerText()) === label && txt.includes('시행일') && txt.includes(must) && (await page.locator('article section').count()) >= 3 && (path === 'privacy' ? ['증빙 사진','초안','CSV','15분'].every(term => txt.includes(term)) : txt.length < 600), String(txt.length));
		if (path === 'privacy') await page.screenshot({ path: `${SP}/legal-privacy.png` });
		await page.locator('button.back').click(); await page.waitForURL(/\/settings$/); await page.locator('a.legal-row').first().waitFor();
	}
	await page.locator('a.legal-row').first().scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SP}/settings-legal.png` });
	await page.goto(`${BASE}/settings/nope`); await page.getByText('없는 문서예요').waitFor({ timeout: 8000 }).catch(() => {});
	check('없는 문서 주소', await page.getByText('없는 문서예요').isVisible());
	await page.goto(`${BASE}/settings`); await page.getByRole('radiogroup', { name: '화면' }).waitFor({ timeout: 8000 });

	console.log('[설정 · 운영진에게 문의하기]');
	await page.getByRole('link', { name: '운영진에게 문의하기' }).click(); await page.waitForURL('**/settings/contact');
	await page.locator('.mine .q').first().waitFor({ timeout: 8000 });
	check('★ 설정 › 운영진에게 문의하기 → 문의 화면 · 내 문의와 답변', (await page.locator('.mine .q').count()) === 1 && (await page.locator('.mine .answer').innerText()).includes('확인했어요')
		&& (await page.locator('.mine .st').innerText()) === '답변 완료');
	check('종류 다섯 가지 · 처음은 "이용 방법"', (await page.getByRole('radiogroup', { name: '무엇에 관한 문의인가요?' }).getByRole('radio').count()) === 5
		&& (await page.getByRole('radio', { name: '이용 방법' }).getAttribute('aria-checked')) === 'true');
	const sendBtn = page.getByRole('button', { name: '보내기', exact: true });
	await page.getByRole('textbox', { name: '문의 내용' }).fill('짧아');
	check('5자 안 되면 보내기 꺼짐', await sendBtn.isDisabled());
	await page.getByRole('radio', { name: '오류 제보' }).click();
	await page.getByRole('textbox', { name: '문의 내용' }).fill('  알림이 두 번씩 와요  ');
	await sendBtn.click(); await page.locator('.mine .q').nth(1).waitFor({ timeout: 5000 });
	check('★ 보내기 → 종류 · 내용(앞뒤 공백 정리) · 목록 맨 위에 "답변 대기"', JSON.stringify(inqCalls.find((c) => typeof c === 'object')) === JSON.stringify({ p_kind: 'bug', p_body: '알림이 두 번씩 와요' })
		&& (await page.locator('.mine .q').first().innerText()).includes('알림이 두 번씩 와요') && (await page.locator('.mine .st').first().innerText()) === '답변 대기'
		&& (await page.getByRole('textbox', { name: '문의 내용' }).inputValue()) === '' && (await toastText()).includes('문의를 보냈어요'));
	await page.getByRole('textbox', { name: '문의 내용' }).fill('하나 더 보내 봅니다');
	await sendBtn.click(); await page.locator('.err').waitFor({ timeout: 5000 });
	check('★ 답을 못 받은 문의가 많으면 안내 (글은 그대로)', (await page.locator('.err').innerText()).includes('답변을 기다리는 문의') && (await page.getByRole('textbox', { name: '문의 내용' }).inputValue()) === '하나 더 보내 봅니다');
	check('문의 화면은 열 때 한 번 · 보낸 뒤 한 번만 목록을 읽는다 (주기 확인 없음)', inqCalls.filter((c) => c === 'list').length === 2, String(inqCalls.filter((c) => c === 'list').length));
	await page.screenshot({ path: `${SP}/settings-contact.png`, fullPage: true });
	await page.locator('button.back').click(); await page.waitForURL(/\/settings$/);
	await page.getByRole('radiogroup', { name: '화면' }).waitFor({ timeout: 8000 });

	console.log('[설정 · 화면 모드]');
	const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	const mode = (name) => page.getByRole('radio', { name });
	const bar = () => page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content).join(','));
	await page.emulateMedia({ colorScheme: 'light' });
	check('화면: 세 가지 · 기본은 "기기 설정 따르기"', (await page.getByRole('radiogroup', { name: '화면' }).getByRole('radio').count()) === 3
		&& (await mode('기기 설정 따르기').getAttribute('aria-checked')) === 'true');
	check('★ 화면은 한 줄 — 왼쪽 "화면", 오른쪽 아이콘 셋 (글자 없음)', await page.evaluate(() => {
		const g = document.querySelector('[role="radiogroup"][aria-labelledby="theme-h"]'), row = g.closest('.g-row');
		const lab = row.querySelector('#theme-h').getBoundingClientRect(), gr = g.getBoundingClientRect();
		return row.getBoundingClientRect().height < 60 && lab.right < gr.left && g.innerText.trim() === '' && g.querySelectorAll('svg').length === 3;
	}));
	await mode('다크 모드').click(); await page.waitForTimeout(200);
	check('★ 다크 모드를 고르면 폰이 라이트여도 바로 어두워진다', (await bg()) === 'rgb(12, 10, 11)' && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
	check('상단 바 색도 어둡게', (await bar()) === '#0c0a0b,#0c0a0b', await bar());
	check('이 기기에 저장', (await page.evaluate(() => localStorage.getItem('theme-v1'))) === 'dark');
	await page.screenshot({ path: `${SP}/settings-theme-dark.png` });
	await page.reload(); await page.getByRole('radiogroup', { name: '화면' }).waitFor({ timeout: 8000 });
	check('★ 다시 켜도 그대로 (첫 화면부터)', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await mode('다크 모드').getAttribute('aria-checked')) === 'true');
	await page.emulateMedia({ colorScheme: 'dark' });
	await mode('라이트 모드').click(); await page.waitForTimeout(200);
	check('★ 라이트 모드 — 폰이 다크여도 밝게', (await bg()) === 'rgb(251, 249, 247)' && (await bar()) === '#fbf9f7,#fbf9f7', await bar());
	await mode('기기 설정 따르기').click(); await page.waitForTimeout(200);
	check('기기 설정 따르기 → 폰 설정(다크)대로 · 저장값 지움', (await bg()) === 'rgb(12, 10, 11)' && (await page.evaluate(() => localStorage.getItem('theme-v1'))) === null
		&& (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined && (await bar()) === '#fbf9f7,#0c0a0b', await bar());
	await page.emulateMedia({ colorScheme: 'light' });

	console.log('[처음 사용법 안내 · 빈 홈 (Phase 44)]');
	await page.goto(`${BASE}/`); await page.locator('a.logo').waitFor(); await page.waitForTimeout(600);
	check('★ 빈 홈 — 숫자(10:00) 대신 두 말풍선', (await page.locator('.hero .talk .say').count()) === 2 && !(await page.locator('.hero').innerText()).includes(':00'), await page.locator('.hero').innerText());
	check('자동 테스트에서는 사용법 안내가 저절로 뜨지 않는다', (await page.getByRole('dialog', { name: '사용법 안내' }).count()) === 0);
	await page.goto(`${BASE}/?tour`);
	const tour = page.getByRole('dialog', { name: '사용법 안내' });
	await tour.waitFor({ timeout: 8000 });
	check('★ 처음 홈 → 사용법 안내 (환영 · 건너뛰기 · 11단계)', (await tour.innerText()).includes('환영') && (await tour.getByRole('button', { name: '건너뛰기' }).count()) === 1
		&& (await tour.locator('.dots i').count()) === 11);
	await page.screenshot({ path: `${SP}/tour-1.png` });
	await tour.getByRole('button', { name: '알려 주세요' }).click(); await page.waitForTimeout(700);
	const near = (a, b, pad) => Math.abs(a.x - (b.x - pad)) < 3 && Math.abs(a.y - (b.y - pad)) < 3 && Math.abs(a.width - (b.width + pad * 2)) < 3;
	check('★ "새 대화 찾기" 자리를 비춘다', (await tour.innerText()).includes('새 대화 찾기') && near(await page.locator('.tour .hole').boundingBox(), await page.locator('.cta').boundingBox(), 6),
		JSON.stringify([await page.locator('.tour .hole').boundingBox(), await page.locator('.cta').boundingBox()]));
	await page.screenshot({ path: `${SP}/tour-2.png` });
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(400);
	check('시간 규칙은 운영 설정 값으로 (첫 대화 · 연장)', (await tour.innerText()).includes('첫 대화는 10분') && (await tour.innerText()).includes('10분씩'));
	for (let i = 0; i < 4; i++) { await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(250); }
	await page.waitForTimeout(500);
	check('★ 익명편지 탭을 비춘다', (await tour.innerText()).includes('익명편지') && near(await page.locator('.tour .hole').boundingBox(), await page.locator('a.tab[href="/letters"]').boundingBox(), 6));
	await page.screenshot({ path: `${SP}/tour-3.png` });
	await tour.getByRole('button', { name: '건너뛰기' }).click(); await page.waitForTimeout(400);
	check('★ 건너뛰기 → 닫히고 이 기기에 "봤음"', (await page.getByRole('dialog', { name: '사용법 안내' }).count()) === 0 && (await page.evaluate(() => localStorage.getItem('tour-v1'))) === '1');
	await page.goto(`${BASE}/?tour`); await page.locator('a.logo').waitFor(); await page.waitForTimeout(700);
	check('한 번 보면 다시 뜨지 않는다', (await page.getByRole('dialog', { name: '사용법 안내' }).count()) === 0);
	await page.goto(`${BASE}/settings`); await page.getByRole('button', { name: '사용법 다시 보기' }).click();
	await page.getByRole('dialog', { name: '사용법 안내' }).waitFor({ timeout: 8000 });
	check('★ 설정 › 사용법 다시 보기 → 홈에서 처음부터', new URL(page.url()).pathname === '/' && (await page.getByRole('dialog', { name: '사용법 안내' }).innerText()).includes('환영'));
	for (let i = 0; i < 10; i++) { await page.getByRole('dialog', { name: '사용법 안내' }).getByRole('button', { name: /^(알려 주세요|다음)$/ }).click(); await page.waitForTimeout(200); }
	check('마지막 — 지킬 것 세 가지 · 시작하기 (건너뛰기 없음)', (await page.locator('.tour .rules li').count()) === 3 && (await page.getByRole('button', { name: '건너뛰기' }).count()) === 0);
	await page.screenshot({ path: `${SP}/tour-4.png` });
	await page.getByRole('button', { name: '시작하기' }).click(); await page.waitForTimeout(400);
	check('시작하기 → 닫힘', (await page.getByRole('dialog', { name: '사용법 안내' }).count()) === 0);

	console.log('[저절로 뜨는 창은 한 번에 하나 · 프로필 안내 · 익명편지 안내 (Phase 89)]');
	// 처음 가입한 기기 흉내: 안내를 본 적 없고 · 새로 딴 업적이 있고 · 알림을 아직 묻지 않았다
	FRESH = true;
	await page.evaluate(() => { for (const k of ['tour-v1', 'tour-me-v1', 'tour-letters-v1', 'cnsa-tour-v1']) localStorage.removeItem(k); localStorage.setItem('e2e-ask', '1'); });
	await page.goto(`${BASE}/?tour`);
	// 홈이 그려질 때부터 3초 동안 떠 있던 창을 30ms 마다 적는다 — 안내가 뜨기 전 0.6초 사이에 다른 창이 먼저 뜨면 잡힌다
	const during = await page.evaluate(() => new Promise((res) => {
		const log = new Set(); const t0 = performance.now();
		const iv = setInterval(() => {
			log.add([...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label')).join('+'));
			if (performance.now() - t0 > 3000) { clearInterval(iv); res([...log]); }
		}, 30);
	}));
	const dialogs = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label')).join('+'));
	check('★ 처음 홈 — 사용법 안내만 뜬다 (업적 축하 · 알림 안내는 뒤에서 기다린다)', during.join('|') === '|사용법 안내' || during.join('|') === '사용법 안내', JSON.stringify(during));
	check('새 업적은 안내 뒤에서 이미 받아 왔다 (한 번만 묻는다)', freshCalls === 1, String(freshCalls));
	await tour.getByRole('button', { name: '건너뛰기' }).click(); await page.waitForTimeout(700);
	check('★ 안내를 닫으면 → 업적 축하만 (알림 안내는 아직)', (await dialogs()) === '새 업적', await dialogs());
	await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.waitForTimeout(900);
	const afterParty = await dialogs();
	check('★ 축하를 닫아도 CNSA 뱃지 안내가 이어 뜨지 않는다 (프로필 안내로 옮겼다)', !afterParty.includes('CNSA 뱃지 안내') && !afterParty.includes('새 업적'), afterParty);
	if (afterParty === '알림 받기') { // 알림을 쓸 수 있는 환경(VAPID 키)에서만 묻는다
		check('★ 그다음에 알림 안내', true);
		await page.getByRole('button', { name: '나중에' }).click(); await page.waitForTimeout(300);
	}
	FRESH = false;
	await page.evaluate(() => localStorage.removeItem('e2e-ask'));

	// 프로필 안내 — 처음 프로필에 오면. 끝까지 보면 CNSA 뱃지 안내가 이어진다
	await page.goto(`${BASE}/me?tour`);
	await tour.waitFor({ timeout: 8000 }); await page.waitForTimeout(900);
	check('★ 처음 프로필 → 프로필 안내 (6단계 · 이름 카드를 비춘다)', (await tour.locator('h2').innerText()) === '내 프로필' && (await tour.locator('.dots i').count()) === 6
		&& near(await page.locator('.tour .hole').boundingBox(), await page.locator('.who').boundingBox(), 6),
		JSON.stringify([await tour.locator('h2').innerText(), await tour.locator('.dots i').count(), await page.locator('.tour .hole').boundingBox(), await page.locator('.who').boundingBox()]));
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(600);
	const cardBox = await page.locator('.tour .card').boundingBox();
	check('★ 교복을 비춘다 · 카드가 화면 안에 있다', (await tour.locator('h2').innerText()) === '교복과 대표 업적' && near(await page.locator('.tour .hole').boundingBox(), await page.locator('.dress').boundingBox(), 6)
		&& cardBox.y >= 0 && cardBox.y + cardBox.height <= 844, JSON.stringify(cardBox));
	await page.screenshot({ path: `${SP}/tour-me.png` });
	for (let i = 0; i < 3; i++) { await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(500); }
	const want = await page.locator('[aria-labelledby="want-h"]').boundingBox();
	check('★ 화면 아래쪽 카드(이야기하고 싶은 상대)는 끌어 올려 비춘다', (await tour.locator('h2').innerText()) === '이야기하고 싶은 상대' && want.y >= 0 && want.y + want.height <= 844
		&& near(await page.locator('.tour .hole').boundingBox(), want, 6), JSON.stringify(want));
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(300);
	check('마지막 장 — CNSA 뱃지 (건너뛰기 없음)', (await tour.locator('h2').innerText()) === 'CNSA 뱃지' && (await tour.getByRole('button', { name: '건너뛰기' }).count()) === 0);
	await tour.getByRole('button', { name: '다음' }).click();
	const cnsa = page.getByRole('dialog', { name: 'CNSA 뱃지 안내' });
	await cnsa.waitFor({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1200);
	check('★ 끝까지 보면 CNSA 뱃지 안내가 이어진다 (떴다가 닫히지 않는다) · 프로필 안내는 "봤음"', (await dialogs()) === 'CNSA 뱃지 안내' && (await cnsa.locator('h2').innerText()) === 'CNSA 뱃지란?'
		&& (await page.evaluate(() => localStorage.getItem('tour-me-v1'))) === '1' && (await page.evaluate(() => scrollY)) === 0, await dialogs());
	await cnsa.getByRole('button', { name: '안내 닫기' }).click(); await page.waitForTimeout(400);
	check('닫으면 CNSA 뱃지 안내도 "봤음"', (await dialogs()) === '' && (await page.evaluate(() => localStorage.getItem('cnsa-tour-v1'))) === '1');
	await page.goto(`${BASE}/me?tour`); await page.locator('.who').waitFor(); await page.waitForTimeout(900);
	check('한 번 보면 다시 뜨지 않는다', (await dialogs()) === '');
	await page.evaluate(() => localStorage.removeItem('tour-me-v1'));
	await page.goto(`${BASE}/me?tour`); await tour.waitFor({ timeout: 8000 });
	check('CNSA 뱃지 안내를 이미 본 기기 — 프로필 안내는 5단계 (뱃지 안내를 다시 잇지 않는다)', (await tour.locator('.dots i').count()) === 5);
	await tour.getByRole('button', { name: '건너뛰기' }).click(); await page.waitForTimeout(600);
	check('건너뛰면 닫히고 "봤음"', (await dialogs()) === '' && (await page.evaluate(() => localStorage.getItem('tour-me-v1'))) === '1');

	// 익명편지 안내 — 처음 익명편지에 오면 (편지가 열려 있을 때)
	await page.goto(`${BASE}/letters?tour`);
	await tour.waitFor({ timeout: 8000 });
	check('★ 처음 익명편지 → 익명편지 안내 (5단계 · 봉투 그림)', (await tour.locator('h2').innerText()) === '익명편지' && (await tour.locator('.dots i').count()) === 5 && (await tour.locator('.art .env').count()) === 1);
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(600);
	check('★ 우체통을 비춘다', (await tour.locator('h2').innerText()) === '우체통' && near(await page.locator('.tour .hole').boundingBox(), await page.locator('.wall .post').boundingBox(), 6));
	await page.screenshot({ path: `${SP}/tour-letters.png` });
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(600);
	check('편지 보관함 이름표를 비춘다', (await tour.locator('h2').innerText()) === '편지 보관함' && near(await page.locator('.tour .hole').boundingBox(), await page.locator('.desk .plate').boundingBox(), 6));
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(600);
	check('★ 편지 쓰기 단추를 비춘다', (await tour.locator('h2').innerText()) === '편지 쓰기' && near(await page.locator('.tour .hole').boundingBox(), await page.locator('a.fab').boundingBox(), 6));
	await tour.getByRole('button', { name: '다음' }).click(); await page.waitForTimeout(300);
	check('마지막 장 — 버리기 · 차단 · 신고 · 편지 받기 끄기', (await tour.innerText()).includes('차단') && (await tour.innerText()).includes('편지 받기'));
	await tour.getByRole('button', { name: '확인' }).click(); await page.waitForTimeout(500);
	check('확인 → 닫히고 "봤음"', (await dialogs()) === '' && (await page.evaluate(() => localStorage.getItem('tour-letters-v1'))) === '1');
	// 설정 › 사용법 다시 보기 — 세 안내가 모두 "안 봤음"으로
	await page.goto(`${BASE}/settings`); await page.getByRole('button', { name: '사용법 다시 보기' }).click();
	await tour.waitFor({ timeout: 8000 });
	check('★ 사용법 다시 보기 → 세 안내 모두 다시 (홈 안내부터)', (await tour.innerText()).includes('환영')
		&& (await page.evaluate(() => ['tour-v1', 'tour-me-v1', 'tour-letters-v1'].map((k) => localStorage.getItem(k)).join())) === ',,');
	await tour.getByRole('button', { name: '건너뛰기' }).click(); await page.waitForTimeout(500);

	console.log('[익명편지 잠금 (Phase 44)]');
	GATE = true;
	await page.goto(`${BASE}/letters`); await page.getByText('100명이 모이면 열려요').waitFor({ timeout: 8000 }).catch(() => {});
	check('★ 잠겨 있으면 편지함 대신 "100명이 모이면 열려요" · 실시간 가입 42/100', (await page.locator('.gate h1').innerText()).includes('100명이 모이면 열려요')
		&& (await page.locator('.gate .big').innerText()) === '42' && (await page.locator('.gate .left').innerText()).includes('58명 더'), await page.locator('.gate').innerText().catch(() => ''));
	check('편지 쓰기 단추 · 편지함 요청 없음', (await page.locator('a.fab').count()) === 0);
	await page.screenshot({ path: `${SP}/letters-gate.png` });
	await page.goto(`${BASE}/letters/new`); await page.locator('.gate').waitFor({ timeout: 8000 }).catch(() => {});
	check('편지 쓰기 주소로 와도 잠금 화면', (await page.locator('.gate').count()) === 1 && (await page.getByRole('searchbox').count()) === 0);
	GATE = false;
	await page.goto(`${BASE}/letters`); await page.locator('a.fab').waitFor({ timeout: 8000 }).catch(() => {});
	check('잠금을 끄면 평소 편지함', (await page.locator('.gate').count()) === 0 && (await page.locator('a.fab').count()) === 1);
	check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} finally { await browser.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

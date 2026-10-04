import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { CHROME, OUT } from './_env.mjs';

// 실제 계정·메시지·운영진에게 요청을 보내지 않는 제품 흐름 회귀 검증.
const BASE = 'http://localhost:5199';
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const roomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const iso = (seconds = 0) => new Date(Date.now() + seconds * 1000).toISOString();
let passed = 0;
const check = (name, condition) => { assert(condition, name); passed++; console.log(`  PASS  ${name}`); };
const browser = await chromium.launch({ executablePath: CHROME });
async function open({ onboarded = true } = {}) {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	const st = { calls: [], errors: [], inquiries: [], failList: false, failSend: false, match: false, matched: false };
	const profile = { id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'm', want: 'f', status: 'active', verified: true, onboarded, letters_open: true, letters_recommend: true };
	page.on('pageerror', (error) => st.errors.push(String(error)));
	await page.addInitScript(() => localStorage.setItem('push-asked-v1', '1'));
	await page.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request(), p = new URL(req.url()).pathname;
		const args = req.postData() ? req.postDataJSON() : null;
		st.calls.push({ p, args });
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (p === '/auth/v1/token') return json(session);
		if (p === '/auth/v1/user') return json(session.user);
		if (p.startsWith('/auth/v1/')) return json({});
		if (p === '/rest/v1/profiles') {
			if (req.method() === 'PATCH') { Object.assign(profile, args); return route.fulfill({ status: 204 }); }
			return json(profile);
		}
		if (p === '/rest/v1/app_settings') return json({ is_open: true, heartbeat_sec: 30, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, letters_gate: false, ai_chat: true, ai_moderation: false });
		if (p.endsWith('/my_account')) return json({ has_password: true, name: '샘플학생', grade: 1, name_source: 'roster' });
		if (p.endsWith('/my_rooms')) return json({ rooms: [], server_now: iso() });
		if (p.endsWith('/request_match')) {
			if (st.match) { st.match = false; st.matched = true; return json({ status: 'matched', room_id: roomId }); }
			return json({ status: 'waiting', reason: 'empty', poll_ms: 700 });
		}
		if (p.endsWith('/ai_chat_start')) return json({ status: 'ok', id: 'sample-ai', expires_at: iso(600), turns: 0, max_turns: 20, server_now: iso() });
		if (/\/(ack_room|room_snapshot|room_view|close_if_expired)$/.test(p)) return json({ room_id: roomId, status: 'active', my_seat: 1, my_alias: '푸른고래', partner_alias: '새벽수달', expires_at: iso(45), round: 1, max_rounds: 0, extend_minutes: 10, vote_window_sec: 90, my_vote: null, partner_vote: null, partner_joined: true, partner_online: true, their_read_id: null, close_reason: null, server_now: iso(), next_hint: { kind: 'grade', label: '학년', typed: false } });
		if (p.endsWith('/partner_profile')) return json({ nickname: '새벽수달', bio: '', interests: [], mbti: null, badges: [] });
		if (p.endsWith('/my_inquiries')) return st.failList ? json({ message: '조회 실패' }, 500) : json(st.inquiries);
		if (p.endsWith('/send_inquiry')) {
			if (st.failSend) return json({ message: '전송 실패' }, 500);
			st.inquiries.unshift({ id: st.inquiries.length + 1, kind: args.p_kind, body: args.p_body, created_at: iso(), answer: null, answered_at: null });
			return json({ status: 'ok' });
		}
		if (p.endsWith('/dm_mailbox')) return json({ items: [], has_more: false });
		if (p.endsWith('/my_notices')) return json({ notices: [], last_seen: 0 });
		if (p.startsWith('/rest/v1/rpc/')) return json(null);
		return json([]);
	});
	const count = (fn) => st.calls.filter((c) => c.p.endsWith(`/${fn}`)).length;
	return { ctx, page, st, profile, count };
}
async function login(page, target = '/') {
	await page.goto(`${BASE}/login`);
	await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
	await page.getByPlaceholder('비밀번호').fill('abcd1234');
	await page.getByRole('button', { name: '로그인', exact: true }).click();
	await page.waitForURL(`${BASE}${target}`);
}
try {
	console.log('[설치 전 체험]');
	{
		const { ctx, page, st } = await open();
		await page.goto(`${BASE}/welcome`);
		await page.getByRole('button', { name: '샘플 답장해 보기' }).click();
		check('로그인 없이 샘플 쌍방 대화 체험', await page.getByText('저는 카레요! 그쪽은요?', { exact: true }).isVisible());
		await page.getByRole('tab', { name: '익명편지', exact: true }).click();
		await page.getByRole('button', { name: '샘플 편지 열어 보기' }).click();
		check('샘플 편지를 열어 본문 확인', await page.locator('.sample-paper').isVisible());
		check('샘플은 인증·DB·AI 요청을 보내지 않는다', st.calls.length === 0);
		for (const width of [320, 390, 560]) {
			await page.setViewportSize({ width, height: 844 });
			check(`소개 화면 ${width}px에서 가로 넘침 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({ path: `${OUT}/product-welcome.png`, fullPage: true });
		await page.goto(`${BASE}/install?gate`);
		await page.getByRole('link', { name: /설치 전에 대화와 편지/ }).click();
		await page.waitForURL(`${BASE}/welcome`);
		// 주소가 바뀐 뒤 화면 넘김이 끝나야 새 화면이 그려진다 — 바로 isVisible 로 보면 이전 화면을 본다
		const welcomed = await page.getByRole('heading', { name: '먼저 둘러보세요' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
		check('설치 안내에서 공개 소개 화면으로 진입', welcomed);
		check('소개 화면 런타임 오류 없음', st.errors.length === 0);
		await ctx.close();
	}
	console.log('[온보딩과 공개 범위]');
	{
		const { ctx, page, profile, st } = await open({ onboarded: false });
		await login(page, '/onboarding');
		await page.locator('.opts').first().getByRole('button', { name: '남자', exact: true }).click();
		check('성별을 골라도 대화 상대 선호 자동 선택 없음', await page.locator('.opts').nth(1).locator('.on').count() === 0);
		check('선호를 직접 선택하기 전 시작 불가', await page.getByRole('button', { name: '동의하고 시작하기' }).isDisabled());
		check('가입 전에 상대·운영자 공개 범위 안내', await page.locator('.privacy-body').innerText().then((s) => s.includes('신원 열람 권한') && s.includes('성별') && s.includes('이름·학년·학번')));
		await page.getByRole('button', { name: '상관없어요' }).click();
		await page.locator('.opts').first().getByRole('button', { name: '여자', exact: true }).click();
		check('성별을 바꿔도 직접 고른 선호 유지', await page.locator('.opts').nth(1).locator('.on').innerText() === '상관없어요');
		await page.getByRole('button', { name: '동의하고 시작하기' }).click();
		await page.waitForURL(`${BASE}/`);
		check('선택한 성별·선호로 온보딩 저장', profile.gender === 'f' && profile.want === 'any' && profile.onboarded);
		check('온보딩 런타임 오류 없음', st.errors.length === 0);
		await ctx.close();
	}
	console.log('[탭 이동 중 매칭과 명시적 AI 선택]');
	{
		const { ctx, page, st, count, profile } = await open();
		await login(page);
		check('기존 사용자의 대화 선호 유지', profile.want === 'f');
		await page.getByRole('button', { name: '새 대화 찾기', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('.seek'));
		await page.locator('a.tab', { hasText: '프로필' }).click();
		await page.waitForURL(`${BASE}/me`);
		await page.getByRole('complementary', { name: '매칭 대기' }).waitFor();
		const before = count('request_match');
		await page.waitForTimeout(1600);
		check('프로필에서 매칭 대기 유지·폴링 지속', count('request_match') > before && count('stop_seeking') === 0);
		await page.locator('a.tab', { hasText: '익명편지' }).click();
		await page.waitForURL(`${BASE}/letters`);
		check('편지 탭에서도 대기 표시·취소 제공', await page.getByRole('button', { name: '그만 찾기', exact: true }).isVisible());
		const stopped = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/stop_seeking'));
		await page.getByRole('button', { name: '그만 찾기', exact: true }).click();
		await stopped;
		await page.waitForFunction(() => !document.querySelector('.matching-bar'));
		check('다른 탭에서 직접 취소 시 서버 취소 한 번', count('stop_seeking') === 1);
		await page.locator('a.tab', { hasText: '채팅' }).click();
		await page.getByRole('button', { name: '새 대화 찾기', exact: true }).click();
		await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 21000; });
		const choose = page.getByRole('button', { name: 'AI와 대화하기', exact: true });
		await choose.waitFor();
		check('대기 시간이 지나도 AI 선택 전 세션 생성 없음', count('ai_chat_start') === 0 && await page.getByRole('dialog', { name: '대화 봇과 대화' }).count() === 0);
		await choose.click();
		await page.getByRole('dialog', { name: '대화 봇과 대화' }).waitFor();
		check('AI 선택 후에만 세션 생성·명시적 안내', count('ai_chat_start') === 1 && await page.locator('.bot .sys').first().innerText().then((s) => s.includes('직접 선택')));
		await page.getByRole('button', { name: '대화 봇 닫기' }).click();
		await page.locator('a.tab', { hasText: '프로필' }).click();
		await page.waitForURL(`${BASE}/me`);
		st.match = true;
		await page.waitForURL(`${BASE}/chat/${roomId}`);
		await page.getByRole('region', { name: '대화 내용' }).waitFor();
		check('다른 탭에서 매칭되면 대화방으로 연결', !await page.locator('.matching-bar').count());
		check('연장 동의 전에 공개되는 실제 학년 안내', await page.locator('.disclosure').innerText().then((s) => s.includes('1학년') && s.includes('그만해도 괜찮아요')));
		check('대화 시작부 익명 범위 도움말 제공', await page.locator('.intro .privacy-summary').count() === 1);
		check('매칭·AI 런타임 오류 없음', st.errors.length === 0);
		await ctx.close();
	}
	console.log('[로그아웃 시 매칭 정리]');
	{
		const { ctx, page, count, st } = await open();
		await login(page);
		await page.getByRole('button', { name: '새 대화 찾기', exact: true }).click();
		await page.locator('.seek').waitFor();
		await page.locator('button.settings').click();
		await page.waitForURL(`${BASE}/settings`);
		await page.waitForFunction(() => document.body.innerText.includes('상대 찾기를 멈췄어요'));
		const seekingInSettings = count('request_match');
		await page.waitForTimeout(1800);
		// 탭 밖 화면에는 찾는 중 표시가 없다 — 예고 없이 대화방으로 넘어가지 않게 멈추고 알린다
		check('탭 밖 화면(설정)으로 가면 찾기를 멈추고 알린다', count('request_match') === seekingInSettings && count('stop_seeking') === 1);
		await page.getByRole('button', { name: '로그아웃', exact: true }).click();
		await page.waitForURL(`${BASE}/login`);
		const before = count('request_match');
		await page.waitForTimeout(1800);
		check('로그아웃 후 매칭 폴링과 대기 UI 정리', count('request_match') === before && !await page.locator('.matching-bar').count());
		check('로그아웃 런타임 오류 없음', st.errors.length === 0);
		await ctx.close();
	}
	console.log('[삭제 요청 접수·답변·실패·재시도]');
	{
		const { ctx, page, st, count } = await open();
		await login(page);
		await page.goto(`${BASE}/settings`);
		await page.getByRole('link', { name: '계정 삭제 요청', exact: true }).click();
		await page.getByText('아직 삭제 요청이 없어요.', { exact: true }).waitFor();
		const submit = page.getByRole('button', { name: '계정 삭제 요청 보내기', exact: true });
		check('삭제 요청이 즉시 삭제가 아니라는 안내와 확인', await submit.isDisabled() && await page.getByText('접수만으로 계정이 삭제되지는 않아요.', { exact: true }).isVisible());
		await page.getByRole('textbox').fill('보관되는 정보도 안내해 주세요');
		await page.getByRole('checkbox').check();
		await submit.click();
		await page.getByText('접수 · 답변 대기', { exact: true }).waitFor();
		check('삭제 요청은 기존 인증된 계정 문의 API로 접수', st.inquiries.length === 1 && st.inquiries[0].kind === 'account' && st.inquiries[0].body.startsWith('[계정 삭제 요청]\n'));
		await page.reload();
		await page.getByText('접수 · 답변 대기', { exact: true }).waitFor();
		check('재접속 후 내역 유지·대기 중 중복 접수 차단', !await submit.count() && count('send_inquiry') === 1);
		st.inquiries[0].answer = '삭제 범위를 확인 중이에요. 보관 예외를 안내할게요.'; st.inquiries[0].answered_at = iso();
		await page.getByRole('button', { name: '새로고침', exact: true }).click();
		await page.getByText('운영진 답변 도착', { exact: true }).waitFor();
		check('운영진 답변을 표시하고 삭제 완료로 오인시키지 않음', await page.getByText(st.inquiries[0].answer, { exact: true }).isVisible() && !await page.getByText('삭제 완료', { exact: true }).count());
		await page.screenshot({ path: `${OUT}/product-deletion.png`, fullPage: true });
		await page.getByRole('link', { name: '계정 문의 보내기', exact: true }).click();
		await page.getByRole('radio', { name: '계정', exact: true }).waitFor();
		check('철회·추가 문의는 계정 종류로 연결', await page.getByRole('radio', { name: '계정', exact: true }).getAttribute('aria-checked') === 'true');
		st.failList = true;
		await page.goto(`${BASE}/settings/delete`);
		await page.getByRole('button', { name: '다시 불러오기', exact: true }).waitFor();
		check('내역 조회 실패 시 중복 요청 방지를 위해 전송 잠금', await submit.isDisabled());
		st.failList = false;
		await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
		await page.getByText('운영진 답변 도착', { exact: true }).waitFor();
		st.failSend = true;
		await page.getByRole('textbox').fill('다시 요청합니다');
		await page.getByRole('checkbox').check();
		await submit.click();
		await page.getByText('요청을 보내지 못했어요. 연결을 확인하고 다시 시도해 주세요', { exact: true }).waitFor();
		check('전송 실패 시 입력 보존·재시도 가능', await page.getByRole('textbox').inputValue() === '다시 요청합니다' && !await submit.isDisabled());
		st.failSend = false;
		await submit.click();
		await page.getByText('접수 · 답변 대기', { exact: true }).waitFor();
		check('재시도 성공 시 요청이 한 건만 추가됨', st.inquiries.length === 2);
		check('삭제 요청 런타임 오류 없음', st.errors.length === 0);
		await ctx.close();
	}
	console.log(`\n${passed} passed, 0 failed`);
} finally { await browser.close(); }

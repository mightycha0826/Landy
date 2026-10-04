import { ROOT, CHROME, OUT, answerDialogs } from './_env.mjs';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';

/** 운영자 화면 전체 점검 — 가짜 Supabase(RPC·Auth) + 실제 SvelteKit 서버 + 실제 브라우저 */
const SP = OUT;
const SECRET = 'e2e-secret-'.padEnd(48, 'z');
const SB = 'http://127.0.0.1:54398';
const PORT = 5195;
const STAFF = '11111111-1111-4111-8111-111111111111';
const id = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const [A, B, ROOM, REP, LREP, BOOM] = ['a', 'b', 'c', 'd', 'e', '9'].map(id);
const t = new Date().toISOString();
let ROLE = 'admin';
let EMPTY_REPORTS = false;
let SUSPENDED = false, BETA = false; // Phase 44 — 정지 풀기 · 특별 업적
let OWNER = false; // Phase 50 — 최고 관리자
let MAINT_ON = false; // Phase 52 — 서버 점검
let MAINT_AT = null; // Phase 53 — 점검 예약
let ROLE_PERMS = { moderator: ['audit', 'inquiry', 'live', 'moderate', 'service'], developer: ['audit', 'inquiry', 'live', 'service', 'settings'], beta: ['live'] };
let STAFF_LIST = [
	{ id: 'o1', no: '20529', nickname: '단단복숭아', display_name: null, role: 'admin', owner: true, created_at: new Date().toISOString(), last_seen: new Date().toISOString() },
	{ id: 'a2', no: '20107', nickname: '얌전한참새', display_name: null, role: 'admin', owner: false, created_at: new Date().toISOString(), last_seen: null }
];
const BADGES = [
	{ code: 'beta', title: '베타 테스터', description: '출시 전 베타 테스트에 함께한 사람', icon: '🧪', category: 'special' },
	{ code: 'cnsa_student', title: 'CNSA 뱃지', description: '충남삼성고 학생임을 증명하는 뱃지', icon: '🏫', category: 'cnsa' },
	{ code: 'club_beatus', title: 'Beatus', description: 'IT 동아리 Beatus의 뱃지', icon: '💻', category: 'cnsa' }
];
const HOLDERS = { club_beatus: [A] }; // Phase 71 — 뱃지마다 가진 학생
// Phase 84 — 학생이 보낸 뱃지 요청 (사진 · 학번 · 이름 — 관리자만)
let BREQ = [
	{ id: 11, user_id: A, kind: 'proof', code: 'cnsa_student', title: null, badge: 'CNSA 뱃지', note: '학생증이랑 같이 찍었어요', member_nos: [], photos: [`${A}/p1.jpg`], status: 'pending', staff_note: null, created_at: t, decided_at: null, name: '홍길동', grade: 2, no: '29999', has: false },
	{ id: 12, user_id: B, kind: 'club', code: null, title: '로봇부', badge: null, note: '', member_nos: [20101, 20102], photos: [`${B}/c1.jpg`, `${B}/c2.jpg`], status: 'pending', staff_note: null, created_at: t, decided_at: null, name: '김기장', grade: 1, no: '19998', has: false }
];
const REMOVED = []; // Storage 에서 지운 사진
const calls = [];

const user = (i, nick) => ({ id: i, nickname: nick, status: 'active', suspended_until: null, strikes: 0, verified: true, onboarded: true, created_at: t, online: false, last_seen: t, staff_role: null, reports_received: 1 });
const RPC = {
	admin_session_valid: () => true,
	admin_session_issue: () => '00000000-0000-4000-8000-000000000009',
	admin_staff_role: () => ROLE,
	// Phase 49 — 역할 확인 + 운영진 현황
	// Phase 50 — 최고 관리자 · 운영진 관리
	admin_staff_list: () => STAFF_LIST,
	// Phase 51 — 역할별 권한 표
	admin_role_perms: () => ROLE_PERMS,
	admin_set_role_perms: (a) => ((ROLE_PERMS = { ...ROLE_PERMS, [a.p_role]: [...a.p_perms].sort() }), ROLE_PERMS),
	admin_staff_set: (a) => {
		if (a.p_role == null) STAFF_LIST = STAFF_LIST.filter((s) => s.no !== a.p_no);
		else if (!STAFF_LIST.some((s) => s.no === a.p_no)) STAFF_LIST.push({ id: 'n' + a.p_no, no: a.p_no, nickname: '새운영', display_name: a.p_name, role: a.p_role, owner: false, created_at: t, last_seen: null });
		else STAFF_LIST = STAFF_LIST.map((s) => (s.no === a.p_no ? { ...s, role: a.p_role, display_name: a.p_name } : s));
		return STAFF_LIST;
	},
	admin_staff_touch: () => ({ role: ROLE, owner: OWNER, maintenance: MAINT_ON, maintenance_at: MAINT_AT, perms: ({ moderator: ['live', 'moderate', 'service', 'inquiry', 'audit'], developer: ['live', 'settings', 'service', 'inquiry', 'audit'], beta: ['live'] })[ROLE] ?? [], team: [
		{ id: STAFF, name: '나운영', role: ROLE, owner: OWNER, last_seen: t, path: '/admin', me: true },
		{ id: 'm1', name: '김운영', role: 'moderator', last_seen: new Date().toISOString(), path: '/admin/reports/x', me: false },
		{ id: 'd1', name: '박개발', role: 'developer', last_seen: new Date(Date.now() - 3 * 3600_000).toISOString(), path: '/admin/settings', me: false }
	] }),
	admin_stats: () => ({ open_reports: 1, reviewing: 0, open_letter_reports: 1, active_rooms: 1, seeking_now: 0, restricted_users: 0, rooms_24h: 3, letters_24h: 2, is_open: true }),
	admin_list_reports: () => EMPTY_REPORTS ? [] : [{ id: REP, created_at: t, reason: 'harassment', note: '욕했어요', status: 'open', reported_id: A, reporter_id: B, reported_30d: 1, evidence_count: 2, reported_status: 'active' }],
	admin_report: () => ({ report: { id: REP, created_at: t, reason: 'harassment', note: '욕했어요', status: 'open', reported_id: A, reporter_id: B, room_id: ROOM, handled_by: null, handled_at: null, action_note: null }, evidence: [{ ord: 1, sender: 2, body: '나쁜 말', sent_at: t }, { ord: 2, sender: 1, body: '그만해', sent_at: t }], reported: { status: 'active', strikes: 0, suspended_until: null, gender: 'm', created_at: t }, history: [], reporter_filed: 1, reporter_dismissed: 0 }),
	admin_set_report: () => null,
	admin_sanction: (a) => ({ status: 'active', strikes: 1, suspended_until: null }),
	admin_log_identity_view: () => null,
	admin_roster_name: (a) => (a.p_email?.startsWith('29999') ? '홍길동' : null),
	admin_list_letter_reports: () => EMPTY_REPORTS ? [] : [{ id: LREP, created_at: t, target_type: 'dm', letter_id: 7, comment_id: null, reason: 'spam', note: '', status: 'open', reported_id: A, reporter_id: B, reported_30d: 1, preview: '광고', reported_status: 'active' }],
	admin_letter_report: () => ({ report: { id: LREP, created_at: t, target_type: 'dm', letter_id: 7, comment_id: null, reason: 'spam', note: '', status: 'open', reported_id: A, reporter_id: B, handled_by: null, handled_at: null, action_note: null }, evidence: [{ ord: 1, kind: 'dm_sender', alias: '맑은 하늘', body: '광고 편지', sent_at: t }], target: { thread_status: 'open' }, reported: { status: 'active', strikes: 0, suspended_until: null, created_at: t }, history: [], chat_reports: 0, reporter_filed: 1, reporter_dismissed: 0 }),
	admin_remove_dm: () => null,
	admin_set_letter_report: () => null,
	admin_find_users: () => [user(A, '푸른고래'), user(B, '작은별')],
	admin_student_labels: () => ({ [A]: '29999 홍길동', [B]: '19998' }),
	admin_user: () => ({ profile: { ...user(A, '푸른고래'), bio: '', interests: [], mbti: null, gender: 'm', want: 'f', ...(SUSPENDED ? { suspended_until: new Date(Date.now() + 3 * 86400_000).toISOString(), strikes: 1 } : {}) }, online: false, last_seen: t, staff_role: null, counts: { rooms: 1, open_rooms: 0, letters: 1, comments: 0, reports_filed: 0, reports_dismissed: 0 }, chat_reports: [], letter_reports: [], history: [] }),
	// Phase 44 — 특별 업적
	admin_user_badges: () => [{ code: 'beta', title: '베타 테스터', description: '출시 전 베타 테스트에 함께한 사람', has: BETA, earned_at: BETA ? t : null }],
	admin_set_badge: (a) => ((BETA = a.p_on), RPC.admin_user_badges()),
	// Phase 71 — 뱃지 화면 (뱃지마다 여러 명에게)
	admin_badges: () => BADGES.map((b) => ({ ...b, holders: (HOLDERS[b.code] ?? []).length })),
	admin_badge_holders: (a) => (HOLDERS[a.p_code] ?? []).map((u) => ({ id: u, nickname: u === A ? '푸른고래' : '작은별', status: 'active', earned_at: t })),
	admin_set_badge_many: (a) => {
		const cur = new Set(HOLDERS[a.p_code] ?? []);
		const before = cur.size;
		a.p_users.forEach((u) => (a.p_on ? cur.add(u) : cur.delete(u)));
		HOLDERS[a.p_code] = [...cur];
		return Math.abs(cur.size - before);
	},
	admin_grant_badge_by_no: (a) => ({ given: 1, found: 1, missing: a.p_nos.filter((n) => n !== 29999) }),
	admin_grant_badge_all: () => 3,
	admin_badge_requests: (a) => BREQ.filter((r) => (r.status === 'pending') === (a.p_pending !== false)),
	admin_badge_request_photo: (a) => BREQ.find((r) => r.id === a.p_id && r.status === 'pending')?.photos[a.p_index] ?? null,
	admin_badge_request_decide: (a) => {
		const r = BREQ.find((x) => x.id === a.p_id);
		if (r.kind === 'club' && a.p_ok && !a.p_code && !r.code) throw { status: 400, body: { message: 'need_code' } };
		const photos = r.photos;
		Object.assign(r, { status: a.p_ok ? 'approved' : 'rejected', staff_note: a.p_note || null, photos: [], decided_at: t });
		return { status: r.status, given: a.p_ok ? (r.kind === 'club' ? 2 : 1) : 0, missing: r.kind === 'club' && a.p_ok ? [20102] : [], photos, notice: 99 };
	},
	personal_notice_push: () => ({ skip: 'no_devices' }),
	admin_user_rooms: () => [],
	admin_get_settings: () => ({ is_open: true, notice: '', room_minutes: 5, extend_minutes: 10, vote_window_sec: 60, max_rounds: 0, rematch_cooldown_days: 7, auto_suspend_reports: 3, max_open_rooms: 5, letters_gate: true, letters_gate_min: 100, maintenance: MAINT_ON, maintenance_msg: '', maintenance_until: null, maintenance_at: MAINT_AT }),
	admin_update_settings: (a) => {
		if (a.p_patch && 'maintenance' in a.p_patch) MAINT_ON = a.p_patch.maintenance; // Phase 52
		if (a.p_patch && 'maintenance_at' in a.p_patch) MAINT_AT = a.p_patch.maintenance_at || null; // Phase 53
		return RPC.admin_get_settings();
	},
	admin_audit: () => [
		{ id: 1, staff_id: STAFF, action: 'remove_letter', target_user: null, report_id: LREP, detail: { letter_id: 7, comment_id: null }, created_at: t },
		{ id: 2, staff_id: null, action: 'roster_import', target_user: null, report_id: null, detail: { grade: 1, count: 373 }, created_at: t },
		{ id: 3, staff_id: STAFF, action: 'update_settings', target_user: null, report_id: null, detail: { is_open: false }, created_at: t },
		{ id: 4, staff_id: STAFF, action: 'view_identity', target_user: null, report_id: null, detail: { users: [A, B], via: 'label' }, created_at: t }
	],
	admin_live_users: () => [{ id: A, nickname: '푸른고래', status: 'active', suspended_until: null, onboarded: true, staff_role: null, online: true, last_seen: t, seeking: false, room_count: 0, rooms: [] }],
	admin_rooms: () => [],
	admin_room: (a) => {
		if (a.p_room === BOOM) throw { status: 500, body: { message: 'boom' } };
		return { room: { id: ROOM, status: 'active', round: 1, created_at: t, armed_at: t, expires_at: t, closed_at: null, close_reason: null, live: true }, members: [], messages: [] };
	},
};

const sb = http.createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
		const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
		if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
		const u = new URL(req.url, SB);
		if (u.pathname === '/auth/v1/token') {
			const now = Math.floor(Date.now() / 1000);
			const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
			const payload = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: STAFF, exp: now + 3600, session_id: '00000000-0000-4000-8000-000000000008' })}`;
			const token = `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
			return send(200, { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: { id: STAFF, aud: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: t } });
		}
		if (u.pathname === '/auth/v1/user') return send(200, { id: STAFF, aud: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: t });
		const au = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
		if (au) return send(200, { id: au[1], email: au[1] === A ? '29999@cnsa.hs.kr' : '19998@cnsa.hs.kr', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: t });
		if (u.pathname === '/rest/v1/signup_stats') return send(200, { students: 42 }); // Phase 44 — 가입한 학생 수
		// Phase 84 — 뱃지 사진: 서명 주소 · 지우기
		if (/^\/storage\/v1\/object\/(authenticated\/)?badge-proofs\//.test(u.pathname)) {
			res.writeHead(200, { 'content-type': 'image/png', ...cors });
			return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=', 'base64'));
		}
		if (u.pathname === '/storage/v1/object/sign/badge-proofs') {
			const { paths } = JSON.parse(body || '{}');
			return send(200, (paths ?? []).map((p) => ({ path: p, signedURL: `/storage/v1/object/sign/badge-proofs/${p}?token=x`, error: null })));
		}
		if (u.pathname.startsWith('/storage/v1/object/sign/badge-proofs/')) {
			res.writeHead(200, { 'content-type': 'image/svg+xml', ...cors });
			return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c33"/></svg>');
		}
		if (u.pathname === '/storage/v1/object/badge-proofs' && req.method === 'DELETE') {
			REMOVED.push(...(JSON.parse(body || '{}').prefixes ?? []));
			return send(200, []);
		}
		const fn = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
		if (!fn || !RPC[fn]) return send(404, { message: `no mock ${req.url}` });
		const args = body ? JSON.parse(body) : {};
		if (fn !== 'admin_staff_role' && fn !== 'admin_staff_touch' && fn !== 'admin_session_valid') calls.push([fn, args]);
		try { send(200, RPC[fn](args)); } catch (e) { send(e.status ?? 500, e.body ?? { message: String(e) }); }
	});
}).listen(54398);

const env = { ...process.env, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxx', PUBLIC_SUPABASE_URL: SB, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest', ADMIN_SESSION_SECRET: SECRET };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
vite.stdout.on('data', (d) => (out += d));
vite.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const cookie = () => { const p = `${STAFF}.00000000-0000-4000-8000-000000000009.${Math.floor(Date.now() / 1000) + 3600}`; return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
const since = () => { const n = calls.length; return () => calls.slice(n).map((c) => c[0]); };
const base = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: CHROME });

async function session(width = 1200) {
	const ctx = await browser.newContext({ viewport: { width, height: 900 } });
	await ctx.addCookies([{ name: 'simbun_admin', value: cookie(), domain: 'localhost', path: '/admin', httpOnly: true, sameSite: 'Strict' }]);
	const page = await ctx.newPage();
	page.errs = [];
	page.on('pageerror', (e) => page.errs.push(String(e)));
	page.go = async (path) => {
		const r = await page.goto(base + path);
		await page.waitForSelector('body.admin', { timeout: 15000 });
	await page.waitForLoadState('networkidle');
		await page.waitForFunction(() => document.querySelector('#app')?.children.length, null, { timeout: 15000 });
		await page.waitForTimeout(150);
		return r;
	};
	return { ctx, page };
}
/** 확인창: answer 에 따라 수락/취소 */
const dialogs = (page, answer) => answerDialogs(page, answer);

try {
	console.log('\n[1] 모든 화면이 열린다 (관리자)');
	const { page } = await session();
	for (const p of ['/admin', '/admin/live', '/admin/letters', '/admin/users', `/admin/users/${A}`, `/admin/reports/${REP}`, `/admin/letters/${LREP}`, '/admin/rooms', `/admin/rooms/${ROOM}`, '/admin/settings', '/admin/audit']) {
		const r = await page.go(p);
		check(`${p} → 200`, r.status() === 200, String(r.status()));
	}
	check('페이지 오류 없음', page.errs.length === 0, page.errs.join(' / '));

	console.log('\n[신고 목록] 종류별 열 · 상세 이동 · 모바일 · 필터와 빈 상태');
	for (const list of [
		{ path: '/admin', detail: `/admin/reports/${REP}`, text: '욕했어요', headers: ['접수', '사유', '신고 내용', '대화', '대상', '누적', '상태'], mobile: ['접수', '사유', '신고 내용', '대상', '상태'], empty: '처리할 신고가 없어요.' },
		{ path: '/admin/letters', detail: `/admin/letters/${LREP}`, text: '광고', headers: ['접수', '대상', '사유', '신고한 글', '작성자', '누적', '상태'], mobile: ['접수', '대상', '사유', '신고한 글', '상태'], empty: '처리할 편지 신고가 없어요.' }
	]) {
		await page.go(list.path);
		check(`${list.path} — 데스크톱 열 순서`, JSON.stringify(await page.locator('thead th:visible').allTextContents()) === JSON.stringify(list.headers));
		await page.getByRole('link', { name: list.text, exact: true }).click();
		await page.waitForURL(base + list.detail);
		check(`${list.path} — 해당 종류의 신고 상세로 이동`, new URL(page.url()).pathname === list.detail);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.go(list.path);
		check(`${list.path} — 모바일 필수 열과 내용 유지`, JSON.stringify(await page.locator('thead th:visible').allTextContents()) === JSON.stringify(list.mobile) && await page.getByRole('link', { name: list.text, exact: true }).isVisible());
		await page.setViewportSize({ width: 1200, height: 900 });
		EMPTY_REPORTS = true;
		await page.go(list.path);
		check(`${list.path} — 미처리 빈 상태`, await page.getByText(list.empty, { exact: true }).isVisible());
		await page.getByRole('navigation', { name: '신고 상태' }).getByRole('link', { name: '검토 중', exact: true }).click();
		await page.waitForURL(base + list.path + '?status=reviewing');
		check(`${list.path} — 필터 이동과 빈 상태`, await page.getByText('해당하는 신고가 없어요.', { exact: true }).isVisible() && await page.locator('.a-tabs a.on').innerText() === '검토 중');
		EMPTY_REPORTS = false;
	}

	// 결과는 누른 버튼 자체(data-ack-msg) 또는 알림(.toast)에 (Phase 48)
	const acked = (t) => page.locator(`[data-ack-msg*="${t}"], .toast:has-text("${t}")`).first();
	console.log('\n[2] ★ 확인창에서 "취소"하면 아무것도 보내지 않는다');
	await page.go(`/admin/reports/${REP}`);
	let answer = false;
	await dialogs(page, () => answer);
	let got = since();
	await page.getByRole('button', { name: '조치하기' }).click();
	await page.waitForTimeout(600);
	check('제재 취소 → admin_sanction 안 부름', !got().includes('admin_sanction'), got().join());
	got = since();
	await page.getByRole('button', { name: '이메일 확인' }).click();
	await page.waitForTimeout(600);
	check('이메일 확인 취소 → 기록·조회 안 함', !got().includes('admin_log_identity_view'), got().join());
	check('취소하면 이메일이 안 보인다', !(await page.getByText('29999@cnsa.hs.kr').count()));

	console.log('\n[3] 수락하면 실행');
	answer = true;
	await page.locator('select[name=action]').selectOption('warn');
	await page.getByRole('radio', { name: '신고자', exact: true }).check();
	got = since();
	await page.getByRole('button', { name: '조치하기' }).click();
	await acked('조치 완료').waitFor({ timeout: 5000 }).catch(() => {});
	const sc = calls.filter((c) => c[0] === 'admin_sanction').at(-1)?.[1];
	check('제재 실행 — 고른 대상·조치 그대로', sc?.p_user === B && sc?.p_action === 'warn', JSON.stringify(sc));
	check('조치 뒤에도 고른 조치·대상이 유지된다', (await page.locator('select[name=action]').inputValue()) === 'warn' && (await page.getByRole('radio', { name: '신고자', exact: true }).isChecked()));
	await page.getByRole('button', { name: '이메일 확인' }).click();
	await page.getByText('29999@cnsa.hs.kr').waitFor({ timeout: 5000 }).catch(() => {});
	const idText = (await page.locator('dl').last().innerText()).replace(/\s+/g, ' ');
	check('이메일 + 명렬표 이름', idText.includes('29999@cnsa.hs.kr') && idText.includes('(홍길동)') && idText.includes('19998@cnsa.hs.kr'), idText);
	check('이름 괄호 앞에 간격', (await page.locator('dl .rname').first().evaluate((e) => parseFloat(getComputedStyle(e).marginLeft))) >= 3);
	check('열람 기록이 먼저', calls.findIndex((c) => c[0] === 'admin_log_identity_view') < calls.findIndex((c) => c[0] === 'admin_roster_name'));
	await page.getByRole('button', { name: '검토 시작' }).click();
	await page.waitForTimeout(600);
	check('상태 변경 버튼', calls.some((c) => c[0] === 'admin_set_report' && c[1].p_status === 'reviewing'));

	console.log('\n[4] 편지 신고 — 내리기 확인창');
	await page.go(`/admin/letters/${LREP}`);
	answer = false;
	got = since();
	await page.getByRole('button', { name: '편지 내리기' }).click();
	await page.waitForTimeout(600);
	check('★ 내리기 취소 → 안 내림', !got().includes('admin_remove_dm'), got().join());
	answer = true;
	await page.getByRole('button', { name: '편지 내리기' }).click();
	await page.waitForTimeout(800);
	check('내리기 수락 → 내림', calls.some((c) => c[0] === 'admin_remove_dm'));

	console.log('\n[6] 운영 설정');
	await page.go('/admin/settings');
	answer = false;
	got = since();
	await page.getByRole('button', { name: '서비스 닫기' }).click();
	await page.waitForTimeout(600);
	check('★ 서비스 닫기 취소 → 안 닫음', !got().includes('admin_update_settings'));
	await page.locator('input[name=room_minutes]').fill('12');
	await page.getByRole('button', { name: '저장', exact: true }).click();
	await acked('저장 완료').waitFor({ timeout: 5000 }).catch(() => {});
	const save = calls.filter((c) => c[0] === 'admin_update_settings').at(-1)?.[1];
	check('저장은 확인창 없이 바로', save?.p_patch?.room_minutes === 12, JSON.stringify(save));

	console.log('\n[6-1] 정지 풀기 · 특별 업적 · 익명편지 잠금 (Phase 44)');
	SUSPENDED = true;
	await page.go(`/admin/users/${A}`);
	check('★ 정지 중이면 조치 칸 위에 "정지 중" · 정지 풀기', (await page.locator('.lift').innerText()).includes('까지 정지') && (await page.getByRole('button', { name: '정지 풀기' }).count()) === 1);
	check('제재 폼에도 "정지 풀기 (제한 해제)"', (await page.locator('select[name=action] option').allInnerTexts()).includes('정지 풀기 (제한 해제)'));
	answer = false;
	got = since();
	await page.getByRole('button', { name: '정지 풀기' }).click();
	await page.waitForTimeout(600);
	check('★ 정지 풀기 취소 → 안 부름', !got().includes('admin_sanction'), got().join());
	answer = true;
	await page.locator('.lift input[name=note]').fill('오해였음');
	await page.getByRole('button', { name: '정지 풀기' }).click();
	await acked('정지를 풀었어요').waitFor({ timeout: 5000 }).catch(() => {});
	const lift = calls.filter((c) => c[0] === 'admin_sanction').at(-1)?.[1];
	check('★ 정지 풀기 → reinstate · 사유 기록', lift?.p_action === 'reinstate' && lift?.p_user === A && lift?.p_note === '오해였음', JSON.stringify(lift));
	SUSPENDED = false;
	await page.go(`/admin/users/${A}`);
	check('정지 중이 아니면 정지 풀기가 없다', (await page.getByRole('button', { name: '정지 풀기' }).count()) === 0
		&& !(await page.locator('select[name=action] option').allInnerTexts()).includes('정지 풀기 (제한 해제)'));
	check('특별 업적 칸 — 베타 테스터 · 없음', (await page.locator('.badges').innerText()).includes('베타 테스터') && (await page.locator('.badges').innerText()).includes('없음'));
	await page.locator('.badges').getByRole('button', { name: '주기' }).click();
	await acked('업적을 줬어요').waitFor({ timeout: 5000 }).catch(() => {});
	const give = calls.filter((c) => c[0] === 'admin_set_badge').at(-1)?.[1];
	check('★ 베타 테스터 주기 → admin_set_badge(on)', give?.p_code === 'beta' && give?.p_on === true && give?.p_user === A, JSON.stringify(give));
	check('준 뒤에는 "거두기"', (await page.locator('.badges').getByRole('button', { name: '거두기' }).count()) === 1);
	await page.screenshot({ path: `${SP}/audit-user-p44.png`, fullPage: true });
	await page.go('/admin/settings');
	check('★ 익명편지 잠금: 지금 잠김 · 가입 42명 · 100명에 열림', (await page.locator('.gate-state').innerText()).replace(/\s+/g, ' ').includes('잠김 · 가입한 학생 42명'));
	await page.locator('input[name=letters_gate]').uncheck();
	await page.locator('input[name=letters_gate_min]').fill('80');
	await page.getByRole('button', { name: '잠금 설정 저장' }).click();
	await acked('익명편지 잠금 끔').waitFor({ timeout: 5000 }).catch(() => {});
	const gate = calls.filter((c) => c[0] === 'admin_update_settings').at(-1)?.[1];
	check('★ 잠금 끄기 · 인원 저장', gate?.p_patch?.letters_gate === false && gate?.p_patch?.letters_gate_min === 80, JSON.stringify(gate));

	console.log('\n[7] 활동 기록 — 원시 JSON 이 보이지 않는다');
	await page.go('/admin/audit');
	const audit = (await page.locator('tbody').innerText()).replace(/\s+/g, ' ');
	check('JSON 없음', !/[{}"]/.test(audit.replace(/"[^"]*"/g, '')), audit);
	check('명렬표 반영 · 1학년 373명', audit.includes('명렬표 반영') && audit.includes('1학년 373명'), audit);
	check('편지 내림 → 옛 편지 #7 (화면은 걷어냄)', audit.includes('옛 편지 #7'), audit);
	check('설정 변경 → "서비스 닫기"', audit.includes('서비스 닫기'), audit);
	check('학번·이름 열람 표시', audit.includes('2명 학번·이름'), audit);

	console.log('\n[8] 오류 화면');
	const er = await page.goto(`${base}/admin/rooms/${BOOM}`);
	await page.waitForTimeout(500);
	const errText = await page.locator('main').innerText();
	check('500 이어도 운영자 메뉴가 남는다', er.status() === 500 && (await page.locator('.side nav').count()) === 1, String(er.status()));
	check('오류 번호 안내', /서버 오류 \([0-9a-f]{8}\)/.test(errText), errText);
	const nf = await page.goto(`${base}/admin/users/not-a-uuid`);
	await page.waitForTimeout(300);
	check('없는 계정 → 404 안내', nf.status() === 404 && (await page.locator('main').innerText()).includes('찾을 수 없'), String(nf.status()));
	check('페이지 오류 없음', page.errs.length === 0, page.errs.join(' / '));

	console.log('\n[9] 서버에서 그릴 때부터 운영자 레이아웃');
	const html = await (await fetch(`${base}/admin/live`, { headers: { cookie: `simbun_admin=${cookie()}` } })).text();
	check('<body class="admin"> 로 내려온다', /<body class="admin"/.test(html));

	console.log('\n[10] 폰 화면 메뉴');
	const m = await session(390);
	await m.page.go('/admin/live');
	const heights = await m.page.locator('.side nav a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
	check('메뉴 글자가 줄바꿈되지 않는다', heights.every((h) => h < 40), heights.join());
	const tabH = await m.page.locator('nav.a-tabs a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
	check('화면 안 탭도 줄바꿈되지 않는다', tabH.length > 0 && tabH.every((h) => h < 48), tabH.join());
	const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	check('페이지가 옆으로 밀리지 않는다', overflow <= 1, String(overflow));
	await m.page.screenshot({ path: `${SP}/audit-mobile.png` });
	await m.page.go(`/admin/reports/${REP}`);
	await m.page.screenshot({ path: `${SP}/audit-mobile-report.png`, fullPage: true });
	await m.ctx.close();
	await page.context().close();

	console.log('\n[11] 운영자 로그인이 학생 앱 로그인을 건드리지 않는다');
	const lctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
	const lp = await lctx.newPage();
	await lp.goto(`${base}/admin/login`);
	await lp.evaluate(() => localStorage.setItem('sb-127-auth-token', 'STUDENT-SESSION'));
	await lp.getByPlaceholder('학교 이메일 앞부분').fill('29999');
	await lp.getByPlaceholder('비밀번호').fill('abcd1234');
	await lp.getByRole('button', { name: '로그인' }).click();
	await lp.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 10000 }).catch(() => {});
	check('로그인 후 운영 화면으로', !lp.url().endsWith('/login'), lp.url());
	check('★ 학생 앱 세션이 그대로', (await lp.evaluate(() => localStorage.getItem('sb-127-auth-token'))) === 'STUDENT-SESSION');
	check('운영자 로그인이 브라우저에 저장되지 않는다', (await lp.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('admin')).length)) === 0);
	await lctx.close();

	console.log('\n[12] 운영진(moderator)');
	ROLE = 'moderator';
	const md = await session();
	for (const p of ['/admin', '/admin/live', '/admin/users', `/admin/users/${A}`, `/admin/reports/${REP}`, '/admin/settings', '/admin/audit']) {
		const r = await md.page.go(p);
		check(`${p} → 200`, r.status() === 200, String(r.status()));
	}
	const r403 = await md.page.goto(`${base}/admin/rooms`);
	await md.page.waitForTimeout(300);
	check('관리자 전용 → 403 안내', r403.status() === 403 && (await md.page.locator('main').innerText()).includes('권한 없음'));
	await md.page.go('/admin/settings');
	check('운영진: 수치 입력칸 잠김', await md.page.locator('input[name=room_minutes]').isDisabled());
	check('페이지 오류 없음', md.page.errs.length === 0, md.page.errs.join(' / '));
	await md.ctx.close();

	console.log('\n[13] 개발자(developer) · 운영진 현황 (Phase 49)');
	ROLE = 'developer';
	const dv = await session(1440); // 오른쪽 현황 판은 넓은 화면(1181~)에서
	await dv.page.go('/admin');
	check('★ 개발자: 첫 화면(채팅 신고) 대신 실시간으로', new URL(dv.page.url()).pathname === '/admin/live', dv.page.url());
	const dnav = await dv.page.locator('.side nav a').allInnerTexts();
	check('★ 개발자 메뉴: 신고 · 사용자 · 전체 대화 없음, 운영 설정 · 문의 · 활동 기록 있음',
		!dnav.some((x) => /신고|사용자|전체 대화/.test(x)) && ['운영 설정', '문의', '활동 기록'].every((l) => dnav.some((x) => x.includes(l))), dnav.join(','));
	for (const p of ['/admin/users', `/admin/reports/${REP}`, '/admin/letters', '/admin/rooms']) {
		const r = await dv.page.goto(`${base}${p}`);
		check(`★ 개발자: ${p} → 403`, r.status() === 403, String(r.status()));
	}
	await dv.page.go('/admin/settings');
	check('★ 개발자: 운영 수치 · 금칙어를 바꿀 수 있다', !(await dv.page.locator('input[name=room_minutes]').isDisabled()) && (await dv.page.getByRole('button', { name: '저장', exact: true }).count()) === 1);
	check('사이드바에 내 역할 "개발자"', (await dv.page.locator('.side .who').innerText()).includes('개발자'));
	const team = dv.page.locator('aside.team');
	const tt = (await team.innerText()).replace(/\s+/g, ' ');
	check('★ 오른쪽 운영진 현황: 역할별 묶음 · 접속 수 · 하는 일 · 오프라인은 마지막 접속', tt.includes('운영진 2') && tt.includes('운영자 — 1') && tt.includes('개발자 — 2')
		&& tt.includes('채팅 신고 보는 중') && tt.includes('3시간 전 접속') && (await team.locator('li.off').count()) === 1, tt);
	await dv.page.screenshot({ path: `${SP}/audit-team-panel.png` });
	check('페이지 오류 없음 (개발자)', dv.page.errs.length === 0, dv.page.errs.join(' / '));
	await dv.ctx.close();

	console.log('\n[14] 최고 관리자 · 운영진 관리 (Phase 50)');
	ROLE = 'admin';
	OWNER = false;
	const na = await session();
	await na.page.go('/admin/live');
	check('★ 그냥 관리자: "운영진 관리" 메뉴 없음', !(await na.page.locator('.side nav a').allInnerTexts()).some((x) => x.includes('운영진 관리')));
	const s403 = await na.page.goto(`${base}/admin/staff`);
	check('★ 그냥 관리자: /admin/staff → 403', s403.status() === 403, String(s403.status()));
	await na.ctx.close();
	OWNER = true;
	const ow = await session(1440);
	let okDialog = true;
	await dialogs(ow.page, () => okDialog);
	await ow.page.go('/admin/staff');
	check('★ 최고 관리자: 메뉴 "운영진 관리" · 사이드바 "최고 관리자"', (await ow.page.locator('.side nav a.on').innerText()).includes('운영진 관리') && (await ow.page.locator('.side .who').innerText()).includes('최고 관리자'));
	check('명단: 최고 관리자 줄은 잠김 · 다른 관리자는 바꾸기/빼기', (await ow.page.locator('.row.owner').innerText()).includes('바꿀 수 없음') && (await ow.page.locator('.row:not(.owner) select').count()) === 1);
	await ow.page.locator('.add input[name=no]').fill('20314');
	await ow.page.locator('.add select[name=role]').selectOption('developer');
	await ow.page.locator('.add input[name=name]').fill('박개발');
	await ow.page.locator('.add').getByRole('button', { name: '지정' }).click();
	await ow.page.locator('.rows li', { hasText: '박개발' }).waitFor({ timeout: 5000 }).catch(() => {});
	const set1 = calls.filter((c) => c[0] === 'admin_staff_set').at(-1)?.[1];
	check('★ 학번으로 개발자 지정 → admin_staff_set · 명단에 보임', set1?.p_no === '20314' && set1?.p_role === 'developer' && set1?.p_name === '박개발' && (await ow.page.locator('.rows li', { hasText: '박개발' }).count()) === 1, JSON.stringify(set1));
	const row = ow.page.locator('.rows li', { hasText: '20107' });
	await row.locator('select[name=role]').selectOption('moderator');
	await row.getByRole('button', { name: '저장' }).click();
	await ow.page.waitForTimeout(700);
	check('★ 역할 바꾸기 → 누른 저장 버튼에 결과', calls.filter((c) => c[0] === 'admin_staff_set').at(-1)?.[1]?.p_role === 'moderator' && (await row.getByRole('button', { name: /저장/ }).getAttribute('data-ack')) === 'ok');
	okDialog = false;
	await row.getByRole('button', { name: '빼기' }).click();
	await ow.page.waitForTimeout(500);
	check('빼기 확인창에서 취소 → 안 뺌', calls.filter((c) => c[0] === 'admin_staff_set').at(-1)?.[1]?.p_role === 'moderator');
	okDialog = true;
	await row.getByRole('button', { name: '빼기' }).click();
	await ow.page.waitForTimeout(800);
	check('★ 빼기 → 역할 없음(null)으로 · 명단에서 사라짐', calls.filter((c) => c[0] === 'admin_staff_set').at(-1)?.[1]?.p_role === null && (await ow.page.locator('.rows li', { hasText: '20107' }).count()) === 0);
	await ow.page.screenshot({ path: `${SP}/audit-staff.png`, fullPage: true });
	check('페이지 오류 없음 (최고 관리자)', ow.page.errs.length === 0, ow.page.errs.join(' / '));

	console.log('\n[15] 베타테스터 · 역할별 권한 표 (Phase 51)');
	await ow.page.go('/admin/staff');
	check('★ 권한 표: 운영자 · 개발자 · 베타테스터 · 관리자(잠김) 열', (await ow.page.locator('.grid thead').innerText()).replace(/\s+/g, ' ').includes('운영자 개발자 베타테스터 관리자')
		&& (await ow.page.locator('.grid input[disabled]').count()) === 8);
	check('베타테스터 처음 권한 = 실시간만', (await ow.page.locator('.grid input[name=beta]:checked').evaluateAll((els) => els.map((e) => e.value))).join() === 'live');
	check('지정할 때 베타테스터를 고를 수 있다', (await ow.page.locator('.add select[name=role] option').allInnerTexts()).includes('베타테스터'));
	await ow.page.getByRole('checkbox', { name: '베타테스터 · 문의 보기 · 답변' }).check();
	await ow.page.getByRole('button', { name: '권한 저장' }).click();
	await ow.page.waitForTimeout(800);
	const rp = calls.filter((c) => c[0] === 'admin_set_role_perms');
	check('★ 권한 저장 → 바뀐 역할(베타테스터)만 admin_set_role_perms', rp.length === 1 && rp[0][1].p_role === 'beta' && JSON.stringify([...rp[0][1].p_perms].sort()) === '["inquiry","live"]', JSON.stringify(rp));
	check('★ 결과는 누른 "권한 저장" 버튼에', (await ow.page.locator('.perms button.save').getAttribute('data-ack')) === 'ok');
	await ow.page.screenshot({ path: `${SP}/audit-perms.png`, fullPage: true });
	ROLE = 'beta';
	OWNER = false;
	const bt = await session();
	await bt.page.go('/admin');
	check('★ 베타테스터: 첫 화면은 실시간', new URL(bt.page.url()).pathname === '/admin/live', bt.page.url());
	check('★ 베타테스터 메뉴: 실시간 · 공지사항만', (await bt.page.locator('.side nav a').allInnerTexts()).map((x) => x.trim()).join() === '실시간,공지사항', (await bt.page.locator('.side nav a').allInnerTexts()).join());
	for (const p of ['/admin/users', '/admin/settings', '/admin/inquiries', '/admin/audit']) {
		const r = await bt.page.goto(`${base}${p}`);
		check(`★ 베타테스터: ${p} → 403`, r.status() === 403, String(r.status()));
	}
	check('사이드바에 "베타테스터"', (await bt.page.locator('.side .who').innerText()).includes('베타테스터'));
	await bt.ctx.close();

	console.log('\n[16] 서버 점검 (Phase 52)');
	ROLE = 'admin';
	OWNER = true;
	await ow.page.go('/admin/settings');
	check('점검 카드: 꺼져 있으면 안내 · 시작 버튼', (await ow.page.locator('section.maint').innerText()).includes('서버 점검') && (await ow.page.getByRole('button', { name: '점검 시작' }).count()) === 1 && (await ow.page.locator('.maint-bar').count()) === 0);
	await ow.page.locator('section.maint textarea[name=msg]').fill('오후 세 시에 다시 만나요');
	await ow.page.locator('section.maint input[name=until]').fill('2026-10-01T15:00');
	okDialog = false;
	await ow.page.getByRole('button', { name: '점검 시작' }).click();
	await ow.page.waitForTimeout(500);
	check('★ 확인창에서 취소 → 점검 안 켬', !MAINT_ON);
	okDialog = true;
	await ow.page.getByRole('button', { name: '점검 시작' }).click();
	await ow.page.getByRole('button', { name: '점검 끝내기' }).waitFor({ timeout: 5000 }).catch(() => {});
	const mp = calls.filter((c) => c[0] === 'admin_update_settings').at(-1)?.[1]?.p_patch;
	check('★ 점검 시작 → 문구 · 끝나는 시각(한국 시간 → UTC)', mp?.maintenance === true && mp.maintenance_msg === '오후 세 시에 다시 만나요' && mp.maintenance_until === '2026-10-01T06:00:00.000Z', JSON.stringify(mp));
	check('★ 점검 중이면 모든 운영 화면 위에 주황 띠', (await ow.page.locator('.maint-bar').innerText()).includes('서버 점검 중'));
	await ow.page.go('/admin/live');
	check('다른 운영 화면에도 띠', (await ow.page.locator('.maint-bar').count()) === 1);
	await ow.page.screenshot({ path: `${SP}/audit-maint.png` });
	await ow.page.go('/admin/settings');
	await ow.page.getByRole('button', { name: '점검 끝내기' }).click();
	await ow.page.getByRole('button', { name: '점검 시작' }).waitFor({ timeout: 5000 }).catch(() => {});
	check('★ 점검 끝내기 → 띠가 걷힌다', !MAINT_ON && (await ow.page.locator('.maint-bar').count()) === 0);

	console.log('\n[17] 점검 예약 (Phase 53)');
	await ow.page.locator('section.maint input[name=at]').fill('2030-01-01T15:00');
	check('시작 시각을 적으면 버튼이 "점검 예약"', (await ow.page.getByRole('button', { name: '점검 예약' }).count()) === 1);
	await ow.page.getByRole('button', { name: '점검 예약' }).click();
	await ow.page.getByRole('button', { name: '예약 취소' }).waitFor({ timeout: 5000 }).catch(() => {});
	const sp = calls.filter((c) => c[0] === 'admin_update_settings').at(-1)?.[1]?.p_patch;
	check('★ 예약 → 아직 안 켜고 시각만 (한국 시간 → UTC)', sp?.maintenance === false && sp.maintenance_at === '2030-01-01T06:00:00.000Z', JSON.stringify(sp));
	check('★ 예약 카드 · 운영 화면 위 파란 예약 띠', (await ow.page.locator('section.maint.soon').innerText()).includes('저절로 점검이 시작돼요') && (await ow.page.locator('.maint-bar.soon').innerText()).includes('서버 점검 예약'));
	await ow.page.getByRole('button', { name: '예약 취소' }).click();
	await ow.page.getByRole('button', { name: '점검 시작' }).waitFor({ timeout: 5000 }).catch(() => {});
	check('★ 예약 취소 → 점검 · 예약 둘 다 지움', MAINT_AT === null && !MAINT_ON && (await ow.page.locator('.maint-bar').count()) === 0);
	await ow.ctx.close();

	console.log('\n[뱃지] 뱃지마다 여러 학생에게 한 번에 주고 거두기 (Phase 71)');
	{
		ROLE = 'admin';
		const { page: bp, ctx: bctx } = await session();
		await dialogs(bp, () => true);
		const done = (txt) => bp.locator(`[data-ack-msg*="${txt}"], .toast:has-text("${txt}")`).first();
		const r = await bp.go('/admin/badges');
		check('/admin/badges → 200 · 사이드바 "뱃지"', r.status() === 200 && (await bp.locator('.side nav a[href="/admin/badges"]').getAttribute('aria-current')) === 'page');
		const list = (await bp.locator('nav.list').innerText()).replace(/\s+/g, ' ');
		check('★ 분류(특별 · CNSA)별 뱃지 · 가진 사람 수', list.includes('특별') && list.includes('CNSA') && list.includes('Beatus 1명') && list.includes('베타 테스터 0명'), list);
		await bp.locator('nav.list a', { hasText: 'Beatus' }).click(); await bp.waitForURL('**/admin/badges?code=club_beatus'); await bp.waitForTimeout(300);
		check('고른 뱃지 — 핀 그림 · 설명 · 가진 학생 (학번 이름은 관리자에게만)', (await bp.locator('section.head .pin-art').count()) === 1 && (await bp.locator('section.head').innerText()).includes('IT 동아리 Beatus의 뱃지')
			&& (await bp.locator('tbody', { hasText: '푸른고래' }).innerText()).includes('29999 홍길동'));
		await bp.getByRole('button', { name: '찾기', exact: true }).click(); await bp.waitForURL(/q=/); await bp.locator('form[action="?/give"]').waitFor();
		check('★ 찾은 학생 중 이미 가진 사람은 "가짐" · 못 고른다', (await bp.getByRole('checkbox', { name: '푸른고래 고르기' }).first().isDisabled()) && (await bp.locator('form[action="?/give"] tr.has').count()) === 1);
		await bp.getByRole('checkbox', { name: '찾은 학생 모두 고르기' }).check();
		await bp.getByRole('button', { name: '고른 1명에게 주기' }).click();
		await done('1명에게 줬어요').waitFor({ timeout: 5000 }).catch(() => {});
		const give = calls.filter((c) => c[0] === 'admin_set_badge_many').at(-1)?.[1];
		check('★ 고른 학생 여럿 → admin_set_badge_many(on) — 이미 가진 사람은 빼고', give?.p_code === 'club_beatus' && give.p_on === true && JSON.stringify(give.p_users) === JSON.stringify([B]), JSON.stringify(give));
		await bp.waitForTimeout(400);
		check('준 뒤 가진 학생 2명', (await bp.locator('form[action="?/take"] tbody tr').count()) === 2);
		await bp.getByRole('checkbox', { name: '보이는 학생 모두 고르기' }).check();
		await bp.getByRole('button', { name: '고른 2명에게서 거두기' }).click();
		await done('2명에게서 거뒀어요').waitFor({ timeout: 5000 }).catch(() => {});
		const take = calls.filter((c) => c[0] === 'admin_set_badge_many').at(-1)?.[1];
		check('★ 가진 학생 골라 한 번에 거두기 → admin_set_badge_many(off)', take?.p_on === false && take.p_users.length === 2, JSON.stringify(take));
		await bp.waitForTimeout(400);
		check('다 거두면 "아직 아무도 없어요"', (await bp.getByText('아직 아무도 없어요').count()) === 1);
		await bp.getByRole('tab', { name: '학번으로' }).click();
		await bp.getByRole('textbox', { name: '학번 목록' }).fill('29999, 20101\n20102 20101');
		await bp.getByRole('button', { name: '학번으로 주기' }).click();
		await done('1명에게 줬어요').waitFor({ timeout: 5000 }).catch(() => {});
		const nos = calls.filter((c) => c[0] === 'admin_grant_badge_by_no').at(-1)?.[1];
		check('★ 학번 목록(쉼표 · 줄바꿈 · 띄어쓰기, 겹친 것 한 번) → admin_grant_badge_by_no', JSON.stringify(nos?.p_nos) === '[29999,20101,20102]' && nos.p_code === 'club_beatus', JSON.stringify(nos));
		await bp.waitForTimeout(300);
		check('못 찾은 학번을 알려 준다', (await bp.locator('.a-warn').innerText()).includes('20101, 20102'));
		await bp.getByRole('tab', { name: '모두에게' }).click();
		await bp.getByRole('button', { name: '모두에게 주기' }).click();
		await done('3명에게 줬어요').waitFor({ timeout: 5000 }).catch(() => {});
		check('★ 모두에게 → admin_grant_badge_all', calls.filter((c) => c[0] === 'admin_grant_badge_all').at(-1)?.[1]?.p_code === 'club_beatus');
		await bp.screenshot({ path: `${SP}/audit-badges.png`, fullPage: true });
		check('페이지 오류 없음 (뱃지)', bp.errs.length === 0, bp.errs.join(' / '));
		await bctx.close();

		ROLE = 'moderator';
		const { page: mp, ctx: mctx } = await session();
		await mp.go('/admin/badges?code=club_beatus');
		check('★ 운영자도 뱃지 화면 — 학번으로 주기는 없다 (학생 신원)', (await mp.getByRole('tab', { name: '학번으로' }).count()) === 0 && (await mp.getByRole('tab', { name: '모두에게' }).count()) === 1);
		await mctx.close();
		ROLE = 'admin';
	}

	console.log('\n[뱃지 요청] 학생이 보낸 뱃지 사진 · 동아리 기장 제출 (Phase 84)');
	{
		ROLE = 'admin';
		const { page: qp, ctx: qctx } = await session();
		await dialogs(qp, () => true);
		const done = (txt) => qp.locator(`[data-ack-msg*="${txt}"], .toast:has-text("${txt}")`).first();
		const r = await qp.go('/admin/badge-requests');
		check('/admin/badge-requests → 200 · 사이드바 "뱃지 요청"', r.status() === 200 && (await qp.locator('.side nav a[href="/admin/badge-requests"]').getAttribute('aria-current')) === 'page');
		const first = qp.locator('li.req').first();
		const t1 = (await first.innerText()).replace(/\s+/g, ' ');
		check('★ 기다리는 요청 — 종류 · 뱃지 · 이름 · 학번 · 메모 · 사진(인증된 같은 출처)', t1.includes('내 뱃지 인증') && t1.includes('CNSA 뱃지') && t1.includes('홍길동') && t1.includes('학번 29999') && t1.includes('학생증이랑')
			&& ((await first.locator('.photos img').first().getAttribute('src')) ?? '').includes('/admin/badge-requests/photo?id='), t1);
		const t2 = (await qp.locator('li.req').nth(1).innerText()).replace(/\s+/g, ' ');
		await qp.waitForFunction(() => document.querySelector('.photos img')?.naturalWidth > 0);
		check('같은 출처 사진이 CSP를 통과해 실제로 표시됨', await first.locator('.photos img').first().evaluate(img => img.complete && img.naturalWidth > 0));
		const photoButton = first.getByRole('button', {name:'사진 1 크게'});
		await photoButton.click();
		const viewer = qp.getByRole('dialog', {name:'제출 사진 확대'});
		await viewer.waitFor();
		await qp.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
		check('확대 사진과 포커스가 dialog 안에 표시됨', await viewer.evaluate(el => el.contains(document.activeElement)));
		await qp.keyboard.press('Escape');
		await viewer.waitFor({state:'detached'});
		check('Escape로 닫고 사진 버튼에 포커스 복원', await photoButton.evaluate(el => document.activeElement === el));
		check('★ 동아리 기장 제출 — 앱에 없는 동아리 · 부원 학번 · 줄 동아리 뱃지 고르기', t2.includes('로봇부') && t2.includes('앱에 없는 동아리') && t2.includes('부원 학번 2명') && t2.includes('20101, 20102')
			&& (await qp.locator('li.req').nth(1).locator('select[name="code"] option').count()) === 2, t2);
		await first.getByRole('button', { name: '승인' }).click();
		await done('1명에게 뱃지를 줬어요').waitFor({ timeout: 5000 }).catch(() => {});
		const d1 = calls.filter((c) => c[0] === 'admin_badge_request_decide').at(-1)?.[1];
		check('★ 승인 → admin_badge_request_decide(ok) · 사진을 Storage 에서 지운다', d1?.p_id === 11 && d1.p_ok === true && REMOVED.includes(`${A}/p1.jpg`), JSON.stringify({ d1, REMOVED }));
		await qp.waitForTimeout(400);
		const club = qp.locator('li.req').first();
		await club.locator('select[name="code"]').selectOption('club_beatus');
		await club.getByRole('textbox', { name: '반려 이유' }).fill('');
		await club.getByRole('button', { name: '승인' }).click();
		await done('2명에게 뱃지를 줬어요').waitFor({ timeout: 5000 }).catch(() => {});
		const d2 = calls.filter((c) => c[0] === 'admin_badge_request_decide').at(-1)?.[1];
		check('★ 동아리 — 고른 동아리 뱃지로 승인 · 못 찾은 학번을 알려 준다', d2?.p_id === 12 && d2.p_code === 'club_beatus' && (await done('못 찾은 학번 20102').count()) === 1 && REMOVED.includes(`${B}/c2.jpg`), JSON.stringify(d2));
		await qp.waitForTimeout(400);
		check('다 결정하면 "기다리는 요청이 없어요"', (await qp.getByText('기다리는 요청이 없어요').count()) === 1);
		await qp.getByRole('tab', { name: '결정한 요청' }).click(); await qp.waitForURL('**/admin/badge-requests?tab=done'); await qp.waitForTimeout(300);
		check('결정한 요청 — 승인 표시 · 사진은 없다', (await qp.locator('li.req .st.approved').count()) === 2 && (await qp.locator('li.req .photos').count()) === 0);
		await qp.screenshot({ path: `${SP}/audit-badge-requests.png`, fullPage: true });
		check('페이지 오류 없음 (뱃지 요청)', qp.errs.length === 0, qp.errs.join(' / '));
		await qctx.close();

		ROLE = 'moderator';
		const { page: mp, ctx: mctx } = await session();
		const r2 = await mp.goto(base + '/admin/badge-requests');
		check('★ 운영자는 뱃지 요청을 볼 수 없다 (학번 · 이름 · 사진 — 관리자만) · 메뉴에도 없다', r2.status() === 403);
		await mp.go('/admin/badges');
		check('운영자 메뉴에 "뱃지 요청" 없음', (await mp.locator('.side nav a[href="/admin/badge-requests"]').count()) === 0);
		await mctx.close();
		ROLE = 'admin';
	}
} catch (e) {
	console.error(out);
	throw e;
} finally {
	await browser.close();
	stopProcess(vite);
	sb.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

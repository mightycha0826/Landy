import { ROOT, CHROME, OUT, answerDialogs } from './_env.mjs';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';

/** 운영자 화면 — AI 자동 감지 신고 · 검열봇/AI 대화 설정 · 금칙어 (가짜 Supabase RPC + 서명 쿠키) */
const SECRET = 'e2e-secret-'.padEnd(48, 'z');
const SB = 'http://127.0.0.1:54395';
const PORT = 5187;
const STAFF = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HUMAN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DMREP = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const t = new Date().toISOString();
const calls = [];
let settings = { is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 90, max_rounds: 0, rematch_cooldown_days: 7, auto_suspend_reports: 3, max_open_rooms: 5,
	ai_moderation: false, ai_mod_daily_cap: 250, ai_chat: false, ai_chat_per_user: 3, ai_chat_daily_cap: 3, ai_chat_minutes: 10, ai_chat_max_turns: 30 };
let terms = ['섹\\s*스', '니\\s*애\\s*미'];
let dmStatus = 'closed';
let exportRange = null;
const row = (id, source, reporter) => ({ id, created_at: t, reason: source === 'auto' ? 'self_harm' : 'harassment', note: source === 'auto' ? '[자동 감지] "요즘 사라지고 싶어" — 위기 신호' : '욕했어요', status: 'open', reported_id: A, reporter_id: reporter, source, reported_30d: 1, evidence_count: 2, reported_status: 'active' });
const RPC = {
	admin_session_valid: () => true,
	admin_staff_role: () => 'admin',
	admin_staff_touch: () => ({ role: 'admin', team: [] }),
	admin_stats: () => ({ open_reports: 2, reviewing: 0, open_letter_reports: 0, active_rooms: 1, seeking_now: 0, restricted_users: 0, rooms_24h: 1, letters_24h: 0, is_open: true }),
	admin_list_reports: () => [row(REP, 'auto', null), row(HUMAN, 'user', B)],
	admin_student_labels: () => ({}),
	admin_report: (a) => ({
		report: { ...row(a.p_id, a.p_id === REP ? 'auto' : 'user', a.p_id === REP ? null : B), room_id: ROOM, handled_by: null, handled_at: null, action_note: null },
		evidence: [{ ord: 1, sender: 1, body: '괜찮아요?', sent_at: t }, { ord: 2, sender: 2, body: '요즘 사라지고 싶어', sent_at: t }],
		reported: { status: 'active', strikes: 0, suspended_until: null, gender: 'm', created_at: t },
		history: [], reporter_filed: 0, reporter_dismissed: 0
	}),
	admin_log_identity_view: (a) => { calls.push(['log', a]); return null; },
	admin_roster_name: () => null,
	admin_rooms: () => [],
	admin_export_start: (a) => { exportRange = a; return { id: '00000000-0000-4000-8000-000000000001' }; },
	admin_export_chunk: (a) => {
		a = { ...a, ...exportRange };
		calls.push(['export', a]);
		// 5,000줄 조각 두 개 + 마지막 빈 조각을 흉내 — 첫 조각은 꽉 차 있고(다음이 있음), 두 번째는 덜 차 있다
		if (a.p_after === 0) return { job_id: '00000000-0000-4000-8000-000000000001', csv: Array.from({ length: 5000 }, (_, i) => `${i + 1},${ROOM},closed,1,"여우",2026-09-24 10:00:00,"안녕 ${i + 1}",`).join('\n'), last_id: 5000, count: 5000 };
		if (a.p_after === 5000) return { job_id: '00000000-0000-4000-8000-000000000001', csv: `5001,${ROOM},closed,2,"곰",2026-09-24 10:01:00,"'=1+1",5000`, last_id: 5001, count: 1 };
		return { job_id: '00000000-0000-4000-8000-000000000001', csv: '', last_id: null, count: 0 };
	},
	// 이름 편지 신고 (Phase 23) — letter_id = 편지 줄기 id
	admin_letter_report: () => ({
		report: { id: DMREP, created_at: t, target_type: 'dm', letter_id: 42, comment_id: null, reason: 'harassment', note: '누군지 모를 사람이 계속', status: 'open',
			reported_id: A, reporter_id: B, source: 'user', handled_by: null, handled_at: null, action_note: null },
		evidence: [{ ord: 1, kind: 'dm_sender', alias: '푸른 우표', body: '너 진짜 별로야', sent_at: t }, { ord: 2, kind: 'dm_recipient', alias: '박받음', body: '누구세요?', sent_at: t }],
		target: { thread_status: dmStatus }, reported: { status: 'active', strikes: 0, suspended_until: null, created_at: t },
		history: [], chat_reports: 0, reporter_filed: 1, reporter_dismissed: 0
	}),
	admin_remove_dm: (a) => { calls.push(['remove_dm', a]); dmStatus = 'removed'; return null; },
	admin_set_letter_report: (a) => { calls.push(['letter_status', a]); return null; },
	admin_get_settings: () => settings,
	admin_ai_usage: () => ({ mod_checked_today: 12, mod_flagged_today: 2, mod_pending: 3, ai_chats_today: 1, day_start: t }),
	admin_banned_terms: () => terms,
	admin_update_settings: (a) => { calls.push(['settings', a.p_patch]); settings = { ...settings, ...a.p_patch }; return settings; },
	admin_set_banned_terms: (a) => {
		calls.push(['terms', a.p_terms]);
		if (a.p_terms.some((x) => x.includes('('))) throw { status: 400, body: { message: 'bad_pattern:(깨진' } };
		terms = a.p_terms; return terms;
	}
};
const sb = http.createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
		if (req.url.startsWith('/auth/v1/admin/users/')) return send(200, { id: A, email: 'x@cnsa.hs.kr' });
		const fn = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
		if (!fn || !RPC[fn]) return send(404, { message: `no mock ${req.url}` });
		try { send(200, RPC[fn](body ? JSON.parse(body) : {})); } catch (e) { send(e.status ?? 500, e.body ?? { message: String(e) }); }
	});
}).listen(54395);

const env = { ...process.env, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxx', PUBLIC_SUPABASE_URL: SB, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest', ADMIN_SESSION_SECRET: SECRET };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = '';
vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 120 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const payload = `${STAFF}.00000000-0000-4000-8000-000000000009.${Math.floor(Date.now() / 1000) + 3600}`;
const cookie = `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
const browser = await chromium.launch({ executablePath: CHROME });
try {
	const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
	await ctx.addCookies([{ name: 'simbun_admin', value: cookie, domain: 'localhost', path: '/admin', httpOnly: true, sameSite: 'Strict' }]);
	const page = await ctx.newPage();
	const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
	await answerDialogs(page, () => true);
	const U = (p) => `http://localhost:${PORT}${p}`;

	console.log('[자동 감지 신고]');
	await page.goto(U('/admin/reports'));
	const rows = page.locator('tbody tr');
	await rows.first().waitFor();
	check('목록: 자동 감지에 "자동" 표시 · 위기 신호 사유', (await rows.nth(0).innerText()).includes('자동') && (await rows.nth(0).innerText()).includes('위기 신호'), await rows.nth(0).innerText());
	check('목록: 사람 신고에는 표시 없음', !(await rows.nth(1).innerText()).includes('자동'));

	await page.goto(U(`/admin/reports/${REP}`));
	await page.locator('.rnote').waitFor();
	check('상세: "AI 판정" 메모', (await page.locator('.rnote').innerText()).startsWith('AI 판정'));
	check('상세: 사본의 1 = "상대" (신고자 아님)', (await page.locator('.msgs .who').allInnerTexts()).join() === '상대,피신고자');
	check('상세: 신고자 칸 대신 AI 자동 감지 안내', (await page.getByText('AI 자동 감지 — 사람이 신고한 것이 아니에요').count()) === 1);
	check('상세: 신고자 계정 링크 없음', (await page.getByRole('link', { name: '신고자 계정 →', exact: true }).count()) === 0);
	check('상세: 조치 대상은 피신고자만', (await page.getByRole('radio', { name: '신고자' }).count()) + (await page.locator('option', { hasText: '신고자' }).count()) === 0);
	await page.getByRole('button', { name: '이메일 확인' }).click();
	const idCard = page.locator('section.a-card', { hasText: '신원 확인' });
	await idCard.locator('dt').first().waitFor();
	check('신원 확인: 피신고자 한 명만 기록 · 표시', calls.find((c) => c[0] === 'log')?.[1].p_users.length === 1 &&
		(await idCard.locator('dt').allInnerTexts()).join() === '피신고자', JSON.stringify(calls.find((c) => c[0] === 'log')));
	await page.screenshot({ path: `${OUT}/admin-ai-report.png`, fullPage: true });

	await page.goto(U(`/admin/reports/${HUMAN}`));
	await page.locator('.rnote').waitFor();
	check('사람 신고는 그대로 (신고자 메모 · 신고자 계정)', (await page.locator('.rnote').innerText()).startsWith('신고자 메모') && (await page.getByRole('link', { name: '신고자 계정 →', exact: true }).count()) === 1);

	console.log('[운영 설정 — AI]');
	await page.goto(U('/admin/settings'));
	await page.getByText('검열봇 · AI 대화 상대').waitFor();
	await page.waitForLoadState('networkidle'); // 하이드레이션 전에 누르면 체크가 되돌려진다
	check('오늘 사용량', (await page.locator('.usage').innerText()).replace(/\s+/g, ' ').includes('오늘 AI 검토 12건'));
	await page.getByLabel(/AI 검토 \(검열봇 2단\)/).check();
	await page.getByLabel(/대화 봇/).check();
	await page.locator('input[name=ai_chat_daily_cap]').fill('5');
	await page.getByRole('button', { name: 'AI 설정 저장' }).click();
	// 결과는 누른 버튼 자체(data-ack-msg) 또는 알림(.toast)에 (Phase 48)
	const acked = (t) => page.locator(`[data-ack-msg*="${t}"], .toast:has-text("${t}")`).first();
	await acked('AI 설정 저장 완료').waitFor();
	const p = calls.filter((c) => c[0] === 'settings').at(-1)?.[1];
	check('AI 설정 저장 (켜기 · 한도)', p?.ai_moderation === true && p.ai_chat === true && p.ai_chat_daily_cap === 5 && p.ai_mod_daily_cap === 250, JSON.stringify(p));
	check('AI 저장이 다른 운영 수치를 건드리지 않는다', p && !('room_minutes' in p) && !('notice' in p));

	await page.getByRole('button', { name: 'AI 연결 확인' }).click();
	const res = page.locator('.ai-result');
	await res.waitFor({ timeout: 15000 });
	const rt = await res.innerText();
	// 개발 서버엔 진짜 Workers AI 가 없다 — 어느 쪽이든 "왜 안 되는지"가 화면에 나와야 한다
	check('AI 연결 확인 → 결과 (연결됨 / 바인딩 없음 / Cloudflare 오류 그대로)', /연결됨|AI 연결\(바인딩\)이 없어요|AI 호출 실패/.test(rt), rt);

	console.log('[금칙어]');
	const ta = page.locator('textarea[name=terms]');
	check('금칙어 목록이 한 줄에 하나', (await ta.inputValue()) === '섹\\s*스\n니\\s*애\\s*미');
	await ta.fill('섹\\s*스\n니\\s*애\\s*미\n  바보멍청이  \n\n');
	await page.getByRole('button', { name: '금칙어 저장' }).click();
	await acked('금칙어 3개 저장 완료').waitFor();
	check('저장: 빈 줄 · 앞뒤 공백 정리', JSON.stringify(calls.filter((c) => c[0] === 'terms').at(-1)?.[1]) === JSON.stringify(['섹\\s*스', '니\\s*애\\s*미', '바보멍청이']));
	await ta.fill('(깨진');
	await page.getByRole('button', { name: '금칙어 저장' }).click();
	await page.getByText('올바른 패턴이 아니에요').waitFor();
	check('틀린 패턴은 안내', (await page.getByText('"(깨진" 는 올바른 패턴이 아니에요').count()) === 1);
	await page.screenshot({ path: `${OUT}/admin-ai-settings.png`, fullPage: true });
	console.log('[이름 편지 신고]');
	await page.goto(U(`/admin/letters/${DMREP}`));
	await page.getByText('신고 시점 사본').waitFor();
	await page.waitForLoadState('networkidle');
	check('제목: 이름 편지 · 사유', (await page.locator('h1').first().innerText()).includes('이름 편지 · 욕설·괴롭힘'), await page.locator('h1').first().innerText());
	const ev = await page.locator('.m .kind').allInnerTexts();
	check('★ 증거: 보낸 사람(받는 사람에게는 익명) · 받는 사람 구분', ev[0].includes('보낸 사람') && ev[0].includes('익명') && ev[1] === '받는 사람', JSON.stringify(ev));
	check('안내: 보낸 사람 확인은 신원 확인(기록)으로', (await page.locator('.a-hint').first().innerText()).includes('신원 확인'));
	check('예전 편지용 "편지 전체 보기" 링크는 없다', (await page.getByRole('link', { name: /편지 전체/ }).count()) === 0);
	check('상태: 끝남', (await page.locator('.now').innerText()).includes('끝남'));
	await page.getByRole('button', { name: '편지 내리기' }).click();
	await acked('편지 내림').waitFor();
	const rd = calls.filter((c) => c[0] === 'remove_dm').at(-1)?.[1];
	check('★ 편지 내리기 → 그 줄기 · 신고 · 운영자 기록으로', rd?.p_thread === 42 && rd?.p_report === DMREP && rd?.p_staff === STAFF, JSON.stringify(rd));
	check('신고는 조치 완료로', calls.some((c) => c[0] === 'letter_status' && c[1].p_status === 'actioned'));
	await page.screenshot({ path: `${OUT}/admin-dm-report.png`, fullPage: true });

	console.log('[대화 백업 (CSV)]');
	await page.goto(U('/admin/rooms'));
	await page.getByRole('button', { name: 'CSV 내려받기' }).waitFor();
	await page.waitForLoadState('networkidle');
	await page.locator('.backup input[type=date]').first().fill('2026-09-24');
	await page.locator('.backup input[type=date]').last().fill('2026-09-24');
	const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV 내려받기' }).click()]);
	const file = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
	const lines = file.replace(/^\ufeff/, '').trimEnd().split('\n');
	check('파일 이름에 기간', dl.suggestedFilename() === 'landy-chats-2026-09-24_2026-09-24.csv', dl.suggestedFilename());
	check('엑셀용 BOM + 머리줄', file.startsWith('\ufeff메시지번호,대화방'));
	check('조각을 이어 붙여 전부 (5,001줄)', lines.length === 5002 && lines.at(-1).startsWith('5001,'), String(lines.length));
	const ex = calls.filter((c) => c[0] === 'export').map((c) => c[1]);
	check('이어 받기: after 0 → 5000, 덜 찬 조각에서 멈춤', ex.map((x) => x.p_after).join() === '0,5000', JSON.stringify(ex.map((x) => x.p_after)));
	check('한국 날짜 하루 = UTC 전날 15시 ~ 당일 15시', ex[0].p_from === '2026-09-23T15:00:00.000Z' && ex[0].p_to === '2026-09-24T15:00:00.000Z', JSON.stringify(ex[0]));
	check('다 받았다는 안내', (await page.locator('.backup [role=status]').innerText()).includes('5,001줄'));
	const bad = await page.evaluate(async () => (await fetch('/admin/rooms/export?from=x&to=y')).status);
	check('날짜가 이상하면 400', bad === 400);

	check('페이지 오류 없음', errs.length === 0, errs.join(' | '));
} catch (e) { fail++; console.error(e); }
finally {
	await browser.close();
	stopProcess(vite);
	sb.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

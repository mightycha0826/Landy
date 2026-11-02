import { ROOT, CHROME, OUT, answerDialogs } from './_env.mjs';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
const SP = OUT;
const ROLE = process.env.ROLE ?? 'admin';
const SECRET = 'e2e-secret-'.padEnd(48, 'z'), SB = 'http://127.0.0.1:54399', PORT = 5198, STAFF = '11111111-1111-4111-8111-111111111111';
let seq = 1;
let notices = [{ id: 1, title: '기존 공지', body: '본문', created_at: new Date().toISOString() }];
const calls = [];
const audit = [];
const RPC = {
	admin_session_valid: () => true,
	admin_staff_role: () => ROLE,
	admin_staff_touch: () => ({ role: ROLE, perms: ({ moderator: ['live', 'moderate', 'service', 'inquiry', 'audit'], developer: ['live', 'settings', 'service', 'inquiry', 'audit'], beta: ['live'] })[ROLE] ?? [], team: [] }),
	admin_notices: () => notices.filter((n) => !n.removed).sort((a, b) => b.id - a.id),
	admin_post_notice: (a) => { calls.push(['post', a]); if (ROLE !== 'admin') throw { status: 400, body: { message: 'admin_only' } }; const id = ++seq; notices.push({ id, title: a.p_title, body: a.p_body, created_at: new Date().toISOString() }); audit.push({ id: audit.length + 1, staff_id: STAFF, action: 'post_notice', target_user: null, report_id: null, detail: { notice: id, title: a.p_title }, created_at: new Date().toISOString() }); return id; },
	admin_remove_notice: (a) => { calls.push(['remove', a]); const n = notices.find((x) => x.id === a.p_id && !x.removed); if (!n) throw { status: 400, body: { message: 'notice_not_found' } }; n.removed = true; return null; },
	admin_release: (a) => { calls.push(['release', a]); const id = a.p_body.trim() ? ++seq : null; if (id) notices.push({ id, title: a.p_title || '업데이트 소식', body: a.p_body, created_at: new Date().toISOString(), release: true }); return id; },
	admin_audit: () => audit,
	// 문의 (Phase 37)
	admin_inquiries: () => ({ open: inquiries.filter((q) => !q.answered_at).length, items: [...inquiries].sort((a, b) => (!!a.answered_at - !!b.answered_at) || a.id - b.id) }),
	admin_answer_inquiry: (a) => { calls.push(['answer', a]); const q = inquiries.find((x) => x.id === a.p_id); if (q.answered_at) throw { status: 400, body: { message: 'already_answered' } }; q.answer = a.p_answer; q.answered_at = new Date().toISOString(); return 900 + q.id; },
	admin_student_labels: (a) => { calls.push(['labels', a]); return Object.fromEntries(a.p_users.map((u) => [u, '20101 김문의'])); },
	personal_notice_push: () => ({ skip: 'no_subscription' })
};
const U1 = '22222222-2222-4222-8222-222222222222';
const inquiries = [
	{ id: 1, user_id: U1, kind: 'bug', body: '편지 봉투가 안 열려요', created_at: new Date().toISOString(), answer: null, answered_at: null },
	{ id: 2, user_id: U1, kind: 'use', body: '예전 문의', created_at: new Date().toISOString(), answer: '답했어요', answered_at: new Date().toISOString() }
];
// 가짜 Cloudflare API (Phase 94) — 배포된 #11, 대기 중 #12 · #13
const CF = { live: 'v11', versions: [11, 12, 13].map((n) => ({ id: `v${n}`, number: n, metadata: { created_on: new Date().toISOString() }, annotations: n === 13 ? { 'workers/message': '사진 보내기' } : {} })) };
const sb = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
	if (req.url.startsWith('/cf/')) {
		const ok = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, result })); };
		if (req.headers.authorization !== 'Bearer cf-test-token' || !req.url.includes('/accounts/acc1/workers/scripts/cnsatinder/')) { res.writeHead(403); return res.end('{}'); }
		if (req.url.endsWith('/versions')) return ok({ items: CF.versions });
		if (req.method === 'POST') { const d = JSON.parse(b); calls.push(['deploy', d]); CF.live = d.versions[0].version_id; return ok({}); }
		return ok({ deployments: [{ versions: [{ version_id: CF.live, percentage: 100 }] }] });
	}
 const fn = req.url.match(/rpc\/([a-z_]+)/)?.[1]; const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); }; if (!RPC[fn]) return send(404, { message: 'no ' + fn }); try { send(200, RPC[fn](JSON.parse(b || '{}'))); } catch (e) { send(e.status ?? 500, e.body ?? { message: String(e) }); } }); }).listen(54399);
const env = { ...process.env, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxx', PUBLIC_SUPABASE_URL: SB, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest', ADMIN_SESSION_SECRET: SECRET, CF_API_BASE: `${SB}/cf`, CF_API_TOKEN: 'cf-test-token', CF_ACCOUNT_ID: 'acc1' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
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
	let answer = true; await answerDialogs(page, () => answer);
	const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(300); };
	// 결과는 누른 버튼 자체(data-ack-msg) 또는 버튼이 사라졌으면 알림(.toast)에 (Phase 48)
	const acked = () => page.evaluate(() => [...document.querySelectorAll('[data-ack]')].map((b) => b.dataset.ackMsg).join(' ') + ' ' + [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '));
	console.log(`\n[${ROLE}]`);
	await page.goto(`http://localhost:${PORT}/admin`); await settle();
	await page.locator('.side nav a', { hasText: '공지사항' }).click(); await page.waitForURL('**/admin/notices', { timeout: 10000 }).catch(() => {}); await settle();
	check('메뉴 "공지사항" → 목록', page.url().endsWith('/admin/notices') && (await page.getByText('기존 공지').count()) === 1);
	if (ROLE === 'admin') {
		await page.getByPlaceholder('제목 (80자까지)').fill('  ');
		await page.getByPlaceholder(/내용/).fill('x');
		answer = true; await page.getByRole('button', { name: '공지 올리기' }).click(); await settle();
		check('빈 제목 → 안 올라감', calls.filter((c) => c[0] === 'post').length === 0);
		await page.getByPlaceholder('제목 (80자까지)').fill('축제 안내');
		await page.getByPlaceholder(/내용/).fill('금요일 오후\n운동장');
		answer = false; await page.getByRole('button', { name: '공지 올리기' }).click(); await settle();
		check('★ 확인창 취소 → 안 올라감', calls.filter((c) => c[0] === 'post').length === 0);
		answer = true; await page.getByRole('button', { name: '공지 올리기' }).click(); await settle();
		check('올리기 → 서버에 제목·내용', JSON.stringify(calls.at(-1)?.[1]).includes('축제 안내') && calls.at(-1)[1].p_body === '금요일 오후\n운동장');
		check('목록에 새 공지가 맨 위', (await page.locator('.list li').first().innerText()).includes('축제 안내'));
		check('★ 완료 안내는 누른 버튼에 + 입력칸 비움', (await acked()).includes('✓') && (await acked()).includes('공지 올림') &&(await page.getByPlaceholder('제목 (80자까지)').inputValue()) === '');
		await page.screenshot({ path: `${SP}/admin-notices.png`, fullPage: true });
		answer = false; await page.locator('.list li', { hasText: '기존 공지' }).getByRole('button', { name: '내리기' }).click(); await settle();
		check('★ 내리기 취소 → 그대로', calls.filter((c) => c[0] === 'remove').length === 0 && (await page.getByText('기존 공지').count()) === 1);
		answer = true; await page.locator('.list li', { hasText: '기존 공지' }).getByRole('button', { name: '내리기' }).click(); await settle();
		check('내리기 → 목록에서 빠짐', (await page.getByText('기존 공지').count()) === 0 && calls.at(-1)?.[1].p_id === 1);
		await page.locator('.side nav a', { hasText: '활동 기록' }).click(); await settle();
		check('활동 기록: "공지 올림 · 제목"', /공지 올림[\s\S]*"축제 안내"/.test(await page.locator('main').innerText()));
	} else {
		check('운영진: 올리기 폼 없음 · 안내', (await page.locator('form.post').count()) === 0 && (await page.getByText('관리자만 올리고 내릴 수').count()) === 1);
		check('운영진: 내리기 버튼 없음', (await page.getByRole('button', { name: '내리기' }).count()) === 0);
		const r = await page.request.post(`http://localhost:${PORT}/admin/notices?/post`, { form: { title: '몰래', body: '' }, headers: { origin: `http://localhost:${PORT}`, 'x-sveltekit-action': 'true' } });
		check('★ 운영진이 직접 요청해도 서버가 막음', calls.length === 0 && (await r.text()).includes('관리자만'), String(r.status()));
	}
	console.log('  [업데이트 (Phase 94)]');
	if (ROLE === 'admin') {
		await page.locator('.side nav a', { hasText: '업데이트' }).click(); await page.waitForURL('**/admin/update', { timeout: 10000 }).catch(() => {}); await settle();
		check('★ 메뉴 "업데이트" → 지금 버전 · 대기 중 2개 (새것 위)', (await page.locator('.now').innerText()).includes('#11') && (await page.locator('.list li').first().innerText()).includes('#13')
			&& (await page.locator('.list li').first().innerText()).includes('사진 보내기') && (await page.getByText('대기 중인 버전 2개').count()) === 1);
		await page.getByPlaceholder(/업데이트 공지/).fill('사진을 보낼 수 있어요');
		answer = false; await page.getByRole('button', { name: '업데이트', exact: true }).click(); await settle();
		check('★ 확인창 취소 → 배포 안 함', !calls.some((c) => c[0] === 'deploy'));
		CF.versions.push({ id: 'v14', number: 14, metadata: { created_on: new Date().toISOString() }, annotations: {} });
		answer = true; await page.getByRole('button', { name: '업데이트', exact: true }).click(); await settle();
		check('★ 화면을 연 뒤 또 푸시됐으면 → 배포 안 하고 다시 보라고', !calls.some((c) => c[0] === 'deploy') && /바뀌었어요/.test(await acked()), await acked());
		await page.reload(); await settle();
		await page.getByPlaceholder(/업데이트 공지/).fill('사진을 보낼 수 있어요');
		answer = true; await page.getByRole('button', { name: '업데이트', exact: true }).click(); await settle();
		const dep = calls.find((c) => c[0] === 'deploy')?.[1];
		check('★ 업데이트 → 맨 위 버전을 100% 배포', dep?.versions?.[0]?.version_id === 'v14' && dep.versions[0].percentage === 100, JSON.stringify(dep));
		check('★ 그다음 공지를 업데이트 공지로', calls.find((c) => c[0] === 'release')?.[1].p_version === 'v14' && calls.find((c) => c[0] === 'release')[1].p_body === '사진을 보낼 수 있어요');
		await page.reload(); await settle();
		check('반영 뒤: 대기 없음 · 최근 업데이트 공지에', (await page.getByText('대기 중인 새 버전이 없어요').count()) === 1 && (await page.locator('main').innerText()).includes('사진을 보낼 수 있어요'));
		await page.screenshot({ path: `${SP}/admin-update.png`, fullPage: true });
	} else {
		check('운영진: "업데이트" 메뉴 없음', (await page.locator('.side nav a', { hasText: '업데이트' }).count()) === 0);
		const r = await page.request.post(`http://localhost:${PORT}/admin/update?/release`, { form: { version: 'v13', body: '' }, headers: { origin: `http://localhost:${PORT}`, 'x-sveltekit-action': 'true' } });
		check('★ 운영진이 직접 요청해도 배포 안 됨', !calls.some((c) => c[0] === 'deploy') && (await r.text()).includes('관리자만'), String(r.status()));
	}
	console.log('  [문의]');
	await page.locator('.side nav a', { hasText: '문의' }).click(); await page.waitForURL('**/admin/inquiries', { timeout: 10000 }).catch(() => {}); await settle();
	check('★ 메뉴 "문의" → 답변 대기 · 답변한 문의', page.url().endsWith('/admin/inquiries') && (await page.locator('h1').innerText()).includes('답변 대기 1개')
		&& (await page.locator('.list li').first().innerText()).includes('편지 봉투가 안 열려요') && (await page.locator('.a-card.done').innerText()).includes('답했어요'));
	check(ROLE === 'admin' ? '관리자: 보낸 학생 이름표 (기록에 남음)' : '운영진: 이름표 없이 "보낸 학생 보기"',
		ROLE === 'admin' ? (await page.locator('.list li').first().locator('a.who').innerText()) === '20101 김문의' : (await page.locator('.list li').first().locator('a.who').innerText()) === '보낸 학생 보기' && !calls.some((c) => c[0] === 'labels'));
	const reply = page.locator('.list li', { hasText: '편지 봉투가 안 열려요' });
	await reply.locator('textarea').fill('새로고침 후 다시 열어 보세요');
	answer = false; await reply.getByRole('button', { name: '답변 보내기' }).click(); await settle();
	check('확인창 취소 → 안 보냄', !calls.some((c) => c[0] === 'answer'));
	answer = true; await reply.getByRole('button', { name: '답변 보내기' }).click(); await settle();
	check('★ 답변 → 서버에 문의 번호 · 답변', calls.find((c) => c[0] === 'answer')?.[1].p_id === 1 && calls.find((c) => c[0] === 'answer')[1].p_answer === '새로고침 후 다시 열어 보세요');
	check('★ 답변하면 답변한 문의로 옮겨 간다', (await page.locator('h1').innerText()).includes('답변 대기 0개') && (await acked()).includes('답변을 보냈어요')
		&& (await page.locator('.a-card.done').count()) === 2);
	await page.screenshot({ path: `${SP}/admin-inquiries-${ROLE}.png`, fullPage: true });
	check('페이지 오류 없음', errs.length === 0, errs.join(' / '));
} finally {
	await browser.close(); stopProcess(vite); sb.close();

}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

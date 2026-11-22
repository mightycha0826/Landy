// 운영자 폼 · 점검 예약 · 검열 · 요청 가드 회귀 검사. 실제 환경변수·DB·푸시 서버를 사용하지 않는다.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { isRedirect } from '@sveltejs/kit';
import { badgeCode, integerFields, noticeError, noticeInput } from '../src/lib/server/adminForms.ts';
import { AI_INTEGER_FIELDS, INTEGER_FIELDS, maintenanceInput } from '../src/lib/server/adminSettings.ts';
import { moderateBatch } from '../src/lib/server/moderationBatch.ts';
import { bearerToken, jsonObject, positiveId } from '../src/lib/server/request.ts';
import { isStaffRole } from '../src/lib/adminRoles.ts';
import { exportDay } from '../src/lib/server/adminExport.ts';

let passed = 0;
const test = async (name, fn) => {
	await fn();
	passed++;
	console.log(`  PASS  ${name}`);
};
const form = (values) => {
	const result = new FormData();
	for (const [key, value] of Object.entries(values)) result.set(key, String(value));
	return result;
};
const jsonRequest = (body) => new Request('https://landy.test/api', { method: 'POST', body });

await test('앱 복귀 새로 읽기 — 방금 읽었으면 건너뛰고 15초가 지나면 다시 읽는다', async () => {
	const { whileVisible } = await import('../src/lib/visible.ts');
	const realDocument = globalThis.document, realNow = Date.now;
	let onVisible, now = 1_000_000, calls = 0;
	globalThis.document = { visibilityState: 'visible', addEventListener: (_, fn) => (onVisible = fn), removeEventListener() {} };
	Date.now = () => now;
	try {
		const stop = whileVisible(() => calls++, 60_000);
		onVisible();
		assert.equal(calls, 1);
		now += 14_999;
		onVisible();
		assert.equal(calls, 1);
		now += 1;
		onVisible();
		assert.equal(calls, 2);
		document.visibilityState = 'hidden';
		now += 60_000;
		onVisible();
		assert.equal(calls, 2);
		stop();
	} finally {
		globalThis.document = realDocument;
		Date.now = realNow;
	}
});

await test('전체·개인 공지의 공백 정리와 기존 길이 경계', () => {
	assert.deepEqual(noticeInput(form({ title: ' 제목 ', body: '\n내용\n' })), { title: '제목', body: '내용' });
	assert.equal(noticeError({ title: '', body: '' }), '제목을 적어 주세요');
	assert.equal(noticeError({ title: '가'.repeat(80), body: '나'.repeat(2000) }), null);
	assert.equal(noticeError({ title: '가'.repeat(81), body: '' }), '제목은 80자까지');
	assert.equal(noticeError({ title: '제목', body: '나'.repeat(2001) }), '내용은 2000자까지');
});
await test('뱃지 코드 제한은 요청·지급 폼에서 동일하다', () => {
	assert.equal(badgeCode(form({ code: 'cnsa_club' })), 'cnsa_club');
	for (const code of ['', 'CNSA', '../cnsa', 'club1', 'a'.repeat(41)]) assert.equal(badgeCode(form({ code })), null);
});
await test('운영·AI 수치의 양 끝은 허용하고 범위 밖·소수는 거절한다', () => {
	for (const fields of [INTEGER_FIELDS, AI_INTEGER_FIELDS]) {
		const valid = Object.fromEntries(fields.map(([key, min]) => [key, min]));
		assert.deepEqual(integerFields(form(valid), fields), { values: valid });
		for (const [key, min, max] of fields) {
			for (const value of [min, max]) assert.ok('values' in integerFields(form({ ...valid, [key]: value }), fields));
			for (const value of [min - 1, max + 1, min + 0.5, 'oops', 'Infinity']) {
				assert.deepEqual(integerFields(form({ ...valid, [key]: value }), fields), { error: `${key} 는 ${min}~${max} 사이의 정수여야 해요` });
			}
		}
	}
});

const now = Date.parse('2026-10-02T00:00:00Z');
await test('한국 시각 예약은 UTC 패치로 바뀌고 아직 점검을 켜지 않는다', () => {
	const input = maintenanceInput(form({ on: true, at: '2026-10-02T10:00', until: '2026-10-02T11:00', msg: ' 점검 ' }), now);
	assert.ok('patch' in input);
	assert.deepEqual(input.patch, { maintenance: false, maintenance_at: '2026-10-02T01:00:00.000Z', maintenance_msg: '점검', maintenance_until: '2026-10-02T02:00:00.000Z' });
	assert.equal(input.startsAt.toISOString(), '2026-10-02T01:00:00.000Z');
});
await test('가까운 시작·빈 시작은 즉시 켜고, 끄기는 예약도 해제한다', () => {
	const immediate = maintenanceInput(form({ on: true, at: '2026-10-02T09:00', msg: 'x'.repeat(301) }), now);
	assert.equal(immediate.patch.maintenance, true);
	assert.equal(immediate.patch.maintenance_at, '');
	assert.equal(immediate.patch.maintenance_msg.length, 300);
	assert.equal(immediate.startsAt, null);
	assert.equal(maintenanceInput(form({ on: true }), now).patch.maintenance, true);
	assert.deepEqual(maintenanceInput(form({ on: false, at: '2026-10-02T10:00' }), now).patch, { maintenance: false, maintenance_at: '' });
});
await test('잘못된 날짜·예약보다 이른 종료는 저장 패치를 만들지 않는다', () => {
	assert.deepEqual(maintenanceInput(form({ on: true, at: 'oops' }), now), { error: '시각을 확인해 주세요' });
	assert.deepEqual(maintenanceInput(form({ on: true, at: '2026-10-02T10:00', until: '2026-10-02T10:00' }), now), { error: '끝나는 시각은 시작 시각보다 뒤여야 해요' });
});
await test('요청 본문은 객체만 받고 ID는 양의 안전한 정수만 허용한다', async () => {
	assert.deepEqual(await jsonObject(jsonRequest('{"message_id":1}')), { message_id: 1 });
	for (const raw of ['', 'oops', 'null', '[]', '3', '"text"']) assert.deepEqual(await jsonObject(jsonRequest(raw)), {});
	for (const value of [1, Number.MAX_SAFE_INTEGER]) assert.equal(positiveId(value), true);
	for (const value of [0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(positiveId(value), false);
	const request = new Request('https://landy.test', { headers: { authorization: 'bEaReR   signed-token' } });
	assert.equal(bearerToken(request), 'signed-token');
	assert.equal(bearerToken(new Request('https://landy.test')), '');
});
await test('알려진 운영진 역할만 인정한다', () => {
	for (const role of ['admin', 'moderator', 'developer', 'beta']) assert.equal(isStaffRole(role), true);
	for (const role of ['owner', 'toString', null, 1, {}]) assert.equal(isStaffRole(role), false);
});
await test('Content-Length 없는 큰 스트림도 제한하고 긴 토큰·다른 출처를 거부한다', async () => {
	await assert.rejects(jsonObject(jsonRequest(JSON.stringify({ text: '가'.repeat(30_000) }))), (e) => e.status === 413);
	assert.equal(bearerToken(new Request('https://landy.test', { headers: { authorization: 'Bearer ' + 'x'.repeat(8193) } })), '');
});

const items = [1, 2, 3, 4].map((id) => ({ id, kind: 'message', text: '가짜 글', context: [] }));
await test('검열은 순서대로 기록하고 알 수 없는 답만 재시도에 남긴다', async () => {
	const saved = [], reviewed = [], released = [];
	const result = await moderateBatch(items, {
		review: async (item) => { reviewed.push(item.id); return item.id === 2 ? '???' : JSON.stringify({ flag: item.id === 3, category: 'spam', reason: '테스트' }); },
		save: async (id, verdict) => { saved.push([id, verdict.flag]); },
		release: async (ids) => { released.push(ids); }
	});
	assert.deepEqual(result, { checked: 3, flagged: 1 });
	assert.deepEqual(reviewed, [1, 2, 3, 4]);
	assert.deepEqual(saved, [[1, false], [3, true], [4, false]]);
	assert.deepEqual(released, []);
});
await test('AI 중단은 이미 처리한 글을 남기고 현재·남은 글만 돌려놓는다', async () => {
	const saved = [], released = [], reviewed = [];
	const result = await moderateBatch(items, {
		review: async ({ id }) => { reviewed.push(id); return id === 3 ? null : '{"flag":false,"category":"none"}'; },
		save: async (id) => { saved.push(id); },
		release: async (ids) => { released.push(ids); }
	});
	assert.deepEqual(result, { checked: 2, flagged: 0 });
	assert.deepEqual(saved, [1, 2]);
	assert.deepEqual(reviewed, [1, 2, 3]);
	assert.deepEqual(released, [[3, 4]]);
});
await test('예상하지 않은 AI·DB 실패는 가짜 성공으로 세지 않는다', async () => {
	for (const failAt of ['review', 'save', 'release']) {
		const work = {
			review: async () => failAt === 'release' ? null : '{"flag":false}',
			save: async () => {},
			release: async () => {}
		};
		work[failAt] = async () => { throw new Error(`fake ${failAt} failed`); };
		await assert.rejects(moderateBatch(items, work), new RegExp(`fake ${failAt} failed`));
	}
});

// Vite 기본 설정·env 파일을 전혀 읽지 않는 격리 서버. DB/인증/발송 경계만 가짜로 바꾼다.
const context = { uid: 'fake-staff', rpc: async () => null, push: async () => ({ status: 201, gone: false }), sent: [], email: async () => null, roster: async () => null };
globalThis.__serverRefactorTest = context;
const modules = {
	'\0test:rpc': 'export const adminRpc = (...args) => globalThis.__serverRefactorTest.rpc(...args); export const userFromBearer = async () => globalThis.__serverRefactorTest.uid; export const emailOf = (...args) => globalThis.__serverRefactorTest.email(...args); export const rosterNameOf = (...args) => globalThis.__serverRefactorTest.roster(...args);',
	'\0test:session': 'export const readSessionDetails = async () => ({ userId: globalThis.__serverRefactorTest.uid, sessionId: "fake-session" }); export const clearSession = () => {};',
	'\0test:private': 'export const env = { VAPID_PRIVATE_KEY: "fake-private" };',
	'\0test:public': 'export const env = { PUBLIC_VAPID_KEY: "fake-public" };',
	'\0test:app': 'export const dev = false;',
	'\0test:push': 'export const isPushEndpoint = (endpoint) => endpoint.startsWith("https://fcm.googleapis.com/"); export const sendPush = (...args) => { globalThis.__serverRefactorTest.sent.push(args); return globalThis.__serverRefactorTest.push(...args); };'
};
const vite = await createServer({
	configFile: false,
	envFile: false,
	server: { middlewareMode: true, hmr: false, ws: false },
	appType: 'custom',
	logLevel: 'error',
	resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	plugins: [{
		name: 'server-refactor-boundaries',
		enforce: 'pre',
		resolveId(source) {
			const normalized = source.replace(/\\/g, '/');
			if (source === '$lib/server/supabaseAdmin' || source === './supabaseAdmin' || /\/src\/lib\/server\/supabaseAdmin(?:\.ts)?$/.test(normalized)) return '\0test:rpc';
			if (source === '$lib/server/adminSession' || /\/src\/lib\/server\/adminSession(?:\.ts)?$/.test(normalized)) return '\0test:session';
			if (source === '$env/dynamic/private') return '\0test:private';
			if (source === '$env/dynamic/public') return '\0test:public';
			if (source === '$app/environment') return '\0test:app';
			if (source === './webpush') return '\0test:push';
		},
		load: (id) => modules[id]
	}]
});

try {
	const { POST: aiTurn } = await vite.ssrLoadModule('/src/routes/api/ai-chat/+server.ts');
	await test('AI는 승인·캐시·lease 만료·모델 실패에도 같은 요청과 lease로만 완료한다', async () => {
		const chat = '00000000-0000-4000-8000-000000000001';
		const requestId = '00000000-0000-4000-8000-000000000002';
		for (const mode of ['success', 'cached', 'denied', 'lost_lease', 'unavailable', 'finish_error']) {
			const calls = []; let modelCalls = 0;
			context.rpc = async (name, args) => {
				calls.push([name, args]);
				if (name === 'api_rate_take') return { allowed: true };
				if (name === 'ai_chat_claim') {
					if (mode === 'cached') return { status: 'ok', cached: true, reply: '캐시 답' };
					if (mode === 'denied') return { status: 'restricted' };
					return { status: 'ok', lease: 'approved-lease', turns: 1, max_turns: 5 };
				}
				if (mode === 'finish_error' && args.p_reply !== null) throw new Error('fake finish failure');
				return mode !== 'lost_lease';
			};
			const event = {
				request: jsonRequest(JSON.stringify({ chat_id: chat, request_id: requestId, messages: [{ role: 'user', content: '안녕' }] })),
				platform: { env: mode === 'unavailable' ? {} : { AI: { run: async () => { modelCalls++; return { response: '010-1234-5678 @test_id' }; } } } }
			};
			if (mode === 'finish_error') await assert.rejects(aiTurn(event), /fake finish failure/);
			else {
				const response = await aiTurn(event);
				assert.equal(response.status, mode === 'lost_lease' ? 202 : mode === 'unavailable' ? 503 : 200);
				const result = await response.json();
				assert.equal(result.status, { lost_lease: 'pending', unavailable: 'ai_unavailable', denied: 'restricted' }[mode] ?? 'ok');
				if (mode === 'success') assert.equal(result.reply, '(번호 가림) (아이디 가림)');
			}
			assert.equal(modelCalls, ['cached', 'denied', 'unavailable'].includes(mode) ? 0 : 1);
			const completed = calls.filter(([name]) => name === 'ai_chat_finish').map(([, args]) => args);
			assert.equal(completed.length, ['cached', 'denied'].includes(mode) ? 0 : mode === 'finish_error' ? 2 : 1);
			for (const args of completed) assert.deepEqual({ ...args, p_reply: null }, { p_chat: chat, p_request: requestId, p_lease: 'approved-lease', p_reply: null });
			if (mode === 'unavailable' || mode === 'finish_error') assert.equal(completed.at(-1).p_reply, null);
		}
	});
	const { GET: exportChunk } = await vite.ssrLoadModule('/src/routes/admin/rooms/export/+server.ts');
	await test('CSV는 달력 날짜·최대 31일·첫 커서를 검사하고 작업 ID를 이어간다', async () => {
		assert.equal(exportDay('2026-02-30'), null);
		assert.equal(exportDay('2024-02-29').toISOString(), '2024-02-28T15:00:00.000Z');
		const staff = { id: 'staff', role: 'admin', perms: ['identity'] };
		for (const query of ['from=2026-02-30&to=2026-03-01', 'from=2026-01-01&to=2026-03-01', 'from=2026-01-01&to=2026-01-02&after=1']) {
			await assert.rejects(exportChunk({ url: new URL('https://landy.test/admin/rooms/export?' + query), locals: { staff } }), (e) => e.status === 400);
		}
		const calls = []; const id = '00000000-0000-4000-8000-000000000001';
		context.rpc = async (name, args) => { calls.push([name, args]); return name === 'admin_export_start' ? { id } : { job_id: id, count: 0 }; };
		await exportChunk({ url: new URL('https://landy.test/admin/rooms/export?from=2026-10-01&to=2026-10-02'), locals: { staff } });
		assert.equal(calls[0][0], 'admin_export_start');
		assert.deepEqual(calls[1], ['admin_export_chunk', { p_staff: 'staff', p_job: id, p_after: 0 }]);
	});
	const { handle } = await vite.ssrLoadModule('/src/hooks.server.ts');
	const event = (path, method = 'GET') => ({ request: new Request(`https://landy.test${path}`, { method }), url: new URL(`https://landy.test${path}`), locals: {}, cookies: {} });
	const resolve = async () => new Response('ok');
	await test('운영자 데이터 요청은 명단·권한을 재확인하고 한국 점검 상태를 넘긴다', async () => {
		const calls = [];
		context.rpc = async (...args) => { if (args[0] === 'admin_session_valid') return true; calls.push(args); return { role: 'developer', perms: ['settings'], team: [], maintenance: true, maintenance_at: '2026-10-02T01:00:00Z' }; };
		const e = event('/admin/settings/__data.json');
		const response = await handle({ event: e, resolve });
		assert.deepEqual(calls, [['admin_staff_touch', { p_uid: 'fake-staff', p_path: '/admin/settings' }]]);
		assert.deepEqual(e.locals.staff, { id: 'fake-staff', role: 'developer', owner: false, perms: ['settings'] });
		assert.equal(e.locals.maintenance, true);
		assert.equal(e.locals.maintenanceAt, '2026-10-02T01:00:00Z');
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
		assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
	});
	await test('현황 폴링·CSV·POST는 마지막 활동 화면을 덮지 않는다', async () => {
		for (const [path, method] of [['/admin/live/status', 'GET'], ['/admin/team', 'GET'], ['/admin/rooms/export', 'GET'], ['/admin/users', 'POST']]) {
			const calls = [];
			context.rpc = async (...args) => { if (args[0] === 'admin_session_valid') return true; calls.push(args); return { role: 'admin', team: [] }; };
			await handle({ event: event(path, method), resolve });
			assert.equal(calls[0][1].p_path, null);
		}
	});
	await test('명단에서 빠진 사용자·알 수 없는 역할은 기존 쿠키가 있어도 차단한다', async () => {
		for (const result of [null, { role: 'owner', team: [] }]) {
			context.rpc = async () => result;
			await assert.rejects(handle({ event: event('/admin/users'), resolve }), (error) => isRedirect(error) && error.status === 303 && error.location === '/admin/login');
		}
	});
	await test('학생 경로는 운영진 인증을 부르지 않고 공통 보안 헤더를 유지한다', async () => {
		context.rpc = async () => { throw new Error('학생 요청에서 호출하면 안 됨'); };
		const e = event('/chat');
		const response = await handle({ event: e, resolve });
		assert.equal(e.locals.staff, null);
		assert.equal(response.headers.get('x-frame-options'), 'DENY');
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
	});
	const { revealIdentity, runSanction } = await vite.ssrLoadModule('/src/lib/server/adminAuth.ts');
	await test('신원 감사가 실패하면 이메일·이름 조회를 시작하지 않는다', async () => {
		context.rpc = async () => { throw new Error('fake audit failed'); };
		context.email = async () => { throw new Error('감사가 먼저여야 함'); };
		await assert.rejects(revealIdentity({ staff: { id: 'fake-staff' } }, ['fake-user'], null), /fake audit failed/);
		const steps = [];
		context.rpc = async (name) => { steps.push(name); };
		context.email = async () => { steps.push('email'); return 'fake@landy.test'; };
		context.roster = async () => { steps.push('roster'); return '가짜 이름'; };
		assert.deepEqual(await revealIdentity({ staff: { id: 'fake-staff' } }, ['fake-user'], null), [{ email: 'fake@landy.test', name: '가짜 이름' }]);
		assert.deepEqual(steps, ['admin_log_identity_view', 'email', 'roster']);
	});
	await test('신원 권한을 줘도 긴 정지 한도는 관리자 역할에만 적용된다', async () => {
		for (const [role, expected] of [['moderator', 7], ['developer', 7], ['beta', 7], ['admin', 365]]) {
			const calls = [];
			context.rpc = async (...args) => { calls.push(args); };
			const result = await runSanction({ staff: { id: 'fake-staff', role, perms: ['identity'] } }, 'fake-user', form({ action: 'suspend', days: 500 }), null);
			assert.equal(result, 'suspend');
			assert.equal(calls[0][1].p_days, expected);
		}
	});

	const { notifyPersonalNotice } = await vite.ssrLoadModule('/src/lib/server/pushSend.ts');
	const { deliver } = await vite.ssrLoadModule('/src/lib/server/pushSend.ts');
	await test('푸시 전송 실패·성공을 기록하고 내부 작업 ID는 알림에 싣지 않는다', async () => {
		const calls = []; context.sent = [];
		context.rpc = async (...args) => { calls.push(args); return true; };
		context.push = async () => { throw new Error('offline'); };
		const note = { kind: 'notice', title: '공지', body: '내용', job: 'internal-job', lease: 'lease', subs: [{ endpoint: 'https://fcm.googleapis.com/fake' }] };
		assert.deepEqual(await deliver(note), { sent: 0 });
		assert.deepEqual(calls[0], ['push_complete', { p_job: 'internal-job', p_lease: 'lease', p_sent: 0, p_failed: 1, p_skip: false }]);
		context.push = async () => ({ status: 201, gone: false });
		assert.deepEqual(await deliver(note), { sent: 1 });
		assert.ok(!context.sent[0][1].includes('internal-job'));
	});
	await test('개인 공지 푸시의 조회·발송 실패는 완료한 조치를 실패로 바꾸지 않는다', async () => {
		context.rpc = async () => { throw new Error('fake payload failure'); };
		await notifyPersonalNotice(10);
		context.rpc = async () => ({ title: '공지', body: '가짜 내용', subs: [{ endpoint: 'https://fcm.googleapis.com/fake' }] });
		context.push = async () => { throw new Error('fake push failure'); };
		await notifyPersonalNotice(10);
	});
	await test('개인 공지 payload skip은 발송하지 않고 정상 알림은 notice 종류로 보낸다', async () => {
		context.sent = [];
		context.rpc = async () => ({ skip: 'no_device' });
		await notifyPersonalNotice(10);
		assert.equal(context.sent.length, 0);
		context.rpc = async () => ({ title: '공지', body: '가짜 내용', subs: [{ endpoint: 'https://fcm.googleapis.com/fake' }] });
		context.push = async () => ({ status: 201, gone: false });
		await notifyPersonalNotice(10);
		assert.equal(JSON.parse(context.sent[0][1]).kind, 'notice');
	});

	const { actions } = await vite.ssrLoadModule('/src/routes/admin/notices/+page.server.ts');
	await test('공지를 쓸 권한 없거나 입력이 잘못되면 RPC를 호출하지 않는다', async () => {
		context.rpc = async () => { throw new Error('거절한 입력은 호출하면 안 됨'); };
		const request = (values) => new Request('https://landy.test/admin/notices', { method: 'POST', body: form(values) });
		const denied = await actions.post({ request: request({ title: '제목' }), locals: { staff: { role: 'beta', perms: [] } } });
		assert.equal(denied.status, 403);
		const invalid = await actions.post({ request: request({ title: ' ', body: ' 입력 내용 ' }), locals: { staff: { role: 'admin' } } });
		assert.equal(invalid.status, 400);
		assert.deepEqual(invalid.data, { error: '제목을 적어 주세요', title: '', body: '입력 내용' });
	});
	await test('공지 저장에는 토큰에서 얻은 운영진 ID와 정리한 본문만 보낸다', async () => {
		const calls = [];
		context.rpc = async (...args) => { calls.push(args); };
		const request = new Request('https://landy.test/admin/notices', { method: 'POST', body: form({ title: ' 제목 ', body: ' 내용 ', p_staff: 'forged-staff' }) });
		await actions.post({ request, locals: { staff: { id: 'fake-staff', role: 'admin' } } });
		assert.deepEqual(calls, [['admin_post_notice', { p_staff: 'fake-staff', p_title: '제목', p_body: '내용' }]]);
	});
} finally {
	delete globalThis.__serverRefactorTest;
	await vite.close();
}

console.log(`\n${passed} passed, 0 failed`);

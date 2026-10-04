import { compileModule } from 'svelte/compiler';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * ChatRoom 클라이언트 로직 테스트 — 가짜 전송 계층으로 네트워크 경쟁 상황을 재현한다.
 * Supabase 불필요.
 *
 *   npm run test:chat
 *
 * Svelte 클라이언트 모듈로 직접 컴파일한다 — 실제 $state 프록시를 검사하고 .env 는 읽지 않는다.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(root, 'scripts', '.chat-test-'));
const modules = new Map();
const temporaryFiles = [];

function write(name, source) {
	const path = join(temporary, name + '.mjs');
	writeFileSync(path, source);
	temporaryFiles.push(path);
	const url = pathToFileURL(path).href;
	modules.set(name, url);
	return url;
}

function build(path, name, imports = {}) {
	let source = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'), { mode: 'transform' });
	for (const [specifier, target] of Object.entries(imports)) {
		source = source.replaceAll("'" + specifier + "'", JSON.stringify(modules.get(target)));
	}
	if (path.endsWith('.svelte.ts')) source = compileModule(source, { generate: 'client', filename: path, dev: false }).js.code;
	write(name, source);
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
	ok ? pass++ : fail++;
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// open() 이 거는 이벤트 리스너용 최소 DOM 스텁
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };

try {
	write('supabase', 'export const supabase = {};');
	write('rpc', 'export const rpc = () => { throw new Error("unexpected RPC in unit test"); };');
	write('push', 'export const notifyReaction = () => {}; export const notifySent = () => {};');
	write('moderation', 'export const requestModeration = () => {};');
	write('manner', 'export const ratePartner = () => { throw new Error("unexpected rating in unit test"); };');
	write('haptics', 'export const match = () => {};');
	build('src/lib/chat/message-ledger.svelte.ts', 'ledger');
	build('src/lib/chat/supabase-transport.ts', 'transport', {
		'../supabase': 'supabase', '../rpc': 'rpc', '../push': 'push', '../moderation': 'moderation', '../manner': 'manner'
	});
	build('src/lib/chat/room.svelte.ts', 'room', { './supabase-transport': 'transport', './message-ledger.svelte': 'ledger' });
	build('src/lib/pollSeeker.svelte.ts', 'pollSeeker');
	build('src/lib/seeker.svelte.ts', 'seeker', { './haptics': 'haptics', './supabase': 'supabase', './pollSeeker.svelte': 'pollSeeker' });
	const { ChatRoom } = await import(modules.get('room'));

	const ROOM = '00000000-0000-0000-0000-00000000000r';
	const now = () => new Date().toISOString();
	let nextId = 100;
	const row = (seat, body, cid = crypto.randomUUID(), id = ++nextId) => ({
		id,
		room_id: ROOM,
		sender_seat: seat,
		body,
		client_msg_id: cid,
		created_at: now()
	});
	const snap = (over = {}) => ({
		room_id: ROOM,
		status: 'active',
		my_seat: 1,
		my_alias: '말랑복숭아',
		partner_alias: '새벽수달',
		expires_at: new Date(Date.now() + 600_000).toISOString(),
		round: 1,
		max_rounds: 0,
		extend_minutes: 10,
		vote_window_sec: 90,
		my_vote: null,
		partner_vote: null,
		partner_joined: true,
		their_read_id: null,
		close_reason: null,
		server_now: now(),
		...over
	});

	/** 테스트마다 동작을 바꿔 끼우는 가짜 전송 계층 */
	function fake() {
		const t = {
			server: [], // 서버에 커밋된 행
			snap: snap(),
			handlers: null,
			sendImpl: null,
			calls: { snapshot: 0, fetchAfter: 0, fetchRecent: 0, fetchReactions: 0 },
			connect(_r, _s, h) {
				t.handlers = h;
			},
			disconnect() {},
			async send(roomId, seat, body, cid, replyTo = null) {
				return t.sendImpl(roomId, seat, body, cid, replyTo);
			},
			async fetchAfter(_r, after) {
				t.calls.fetchAfter++;
				return t.server.filter((m) => m.id > after).sort((a, b) => a.id - b.id);
			},
			async fetchRecent(_r, n) {
				t.calls.fetchRecent++;
				return [...t.server].sort((a, b) => b.id - a.id).slice(0, n);
			},
			async snapshot() {
				t.calls.snapshot++;
				return { ...t.snap, server_now: now() };
			},
			async closeIfExpired() {
				t.calls.snapshot++;
				return { ...t.snap, server_now: now() };
			},
			async ack() {
				t.acked = true;
				return { ...t.snap, server_now: now() };
			},
			voteImpl: null,
			async vote(_r, agree) {
				return t.voteImpl(agree);
			},
			async leave(_r, skip) {
				t.snap = { ...t.snap, status: 'closed', close_reason: skip ? 'skipped' : 'left' };
				return { ...t.snap, server_now: now() };
			},
			async markRead() {},
			typing() {},
			// 공감 — 서버에 있는 행 / 요청 처리 방식은 테스트마다 바꿔 끼운다
			reactionRows: [],
			reactImpl: null,
			async react(_r, id, emoji) {
				return t.reactImpl ? t.reactImpl(id, emoji) : 'ok';
			},
			async fetchReactions() {
				t.calls.fetchReactions++;
				return t.reactionRows.filter((x) => x.emoji);
			}
		};
		return t;
	}

	async function mk(t) {
		const r = new ChatRoom(ROOM, t);
		r.snap = t.snap; // open() 은 DOM 이벤트를 걸기 때문에 여기선 스냅샷만 주입
		return r;
	}
	const bodies = (r) => r.msgs.map((m) => m.body).join(',');

	console.log('\n[1] 낙관적 전송');
	{
		const t = fake();
		let release;
		t.sendImpl = (_r, seat, body, cid) =>
			new Promise((res) => {
				release = () => {
					const x = row(seat, body, cid);
					t.server.push(x);
					res({ ok: true, row: x });
				};
			});
		const r = await mk(t);
		const p = r.send('안녕');
		check('보내는 즉시 화면에 나타난다 (sending)', r.msgs.length === 1 && r.msgs[0].state === 'sending');
		check('확정 전에는 id 가 없다', r.msgs[0].id === null);
		release();
		await p;
		check('응답 후 sent 로 바뀌고 서버 id 를 받는다', r.msgs[0].state === 'sent' && r.msgs[0].id != null);
		check('여전히 1개', r.msgs.length === 1);
	}

	console.log('\n[2] ★ realtime 에코가 insert 응답보다 먼저 도착');
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async (_r, seat, body, cid) => {
			const x = row(seat, body, cid);
			t.server.push(x);
			r.upsert(x, 'sent'); // 에코가 먼저 온다
			await sleep(5);
			return { ok: true, row: x };
		};
		await r.send('에코 먼저');
		check('중복 없이 1개', r.msgs.length === 1, `실제 ${r.msgs.length}`);
		check('sent 상태', r.msgs[0].state === 'sent');
	}

	console.log('\n[3] 같은 행이 여러 번 와도 결과가 같다 (멱등)');
	{
		const t = fake();
		const r = await mk(t);
		const x = row(2, '반가워');
		for (let i = 0; i < 3; i++) r.upsert(x, 'sent');
		check('3번 받아도 1개', r.msgs.length === 1);
	}

	console.log('\n[4] 순서 — 늦게 커밋된 낮은 id 도 제자리로');
	{
		const t = fake();
		const r = await mk(t);
		r.upsert(row(2, 'a', undefined, 1), 'sent');
		r.upsert(row(2, 'c', undefined, 3), 'sent');
		r.upsert(row(2, 'b', undefined, 2), 'sent');
		check('id 순서대로 정렬 (a,b,c)', bodies(r) === 'a,b,c', bodies(r));
	}

	console.log('\n[5] 미확정 메시지는 항상 맨 아래');
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = () => new Promise(() => {}); // 영원히 응답 없음
		void r.send('내 것(대기중)');
		r.upsert(row(2, '상대 새 메시지', undefined, 50), 'sent');
		check('상대 메시지가 와도 내 대기 메시지는 아래', bodies(r) === '상대 새 메시지,내 것(대기중)', bodies(r));
	}

	console.log('\n[6] 실패와 재전송');
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async () => ({ ok: false, reason: 'network' });
		await r.send('끊겼을 때');
		check('네트워크 실패 → failed', r.msgs[0].state === 'failed');

		const cidFirst = r.msgs[0].client_msg_id;
		let usedCid = null;
		t.sendImpl = async (_r, seat, body, cid) => {
			usedCid = cid;
			const x = row(seat, body, cid);
			t.server.push(x);
			return { ok: true, row: x };
		};
		await r.retry(r.msgs[0]);
		check('재전송은 같은 client_msg_id 를 쓴다 (서버 unique 가 중복 방지)', usedCid === cidFirst);
		check('재전송 성공 → sent, 1개', r.msgs.length === 1 && r.msgs[0].state === 'sent');
	}

	console.log('\n[7] ★ 타임아웃 후 재전송했는데 사실 서버엔 이미 들어가 있었다');
	{
		const t = fake();
		const r = await mk(t);
		let cid;
		t.sendImpl = async (_r, seat, body, c) => {
			cid = c;
			t.server.push(row(seat, body, c)); // 서버엔 들어갔는데
			return { ok: false, reason: 'network' }; // 응답을 못 받음
		};
		await r.send('유령');
		check('일단 failed 로 보인다', r.msgs[0].state === 'failed');
		t.sendImpl = async () => ({ ok: false, reason: 'duplicate' });
		await r.retry(r.msgs[0]);
		check('duplicate 응답 → 서버 행을 읽어 sent 로 확정', r.msgs[0].state === 'sent' && r.msgs[0].id != null);
		check('여전히 1개', r.msgs.length === 1);
	}
	{
		const t = fake();
		const r = new ChatRoom(ROOM, t);
		await r.open();
		t.sendImpl = async (_r, seat, body, cid) => {
			t.server.push(row(seat, body, cid));
			return { ok: false, reason: 'network' };
		};
		await r.send('종료 전에 저장됨');
		let release;
		t.sendImpl = async () => ({ ok: false, reason: 'duplicate' });
		t.fetchRecent = () => new Promise((resolve) => (release = resolve));
		const retrying = r.retry(r.msgs[0]);
		await sleep(0);
		t.handlers.onRoom({ ...t.snap, id: ROOM, status: 'closed', close_reason: 'left', read1: null, read2: null });
		release([...t.server]);
		await retrying;
		check('★ 중복 전송 확인 중 상대가 종료해도 저장된 행은 sent로 확정한다', r.closed && r.msgs.length === 1 && r.msgs[0].state === 'sent' && r.msgs[0].id === t.server[0].id);
		r.dispose();
	}
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async (_r, seat, body, cid) => {
			t.server.push(row(seat, body, cid));
			return { ok: false, reason: 'network' };
		};
		await r.send('화면 이탈 전 저장됨');
		let release;
		t.sendImpl = async () => ({ ok: false, reason: 'duplicate' });
		t.fetchRecent = () => new Promise((resolve) => (release = resolve));
		const retrying = r.retry(r.msgs[0]);
		await sleep(0);
		r.dispose();
		release([...t.server]);
		await retrying;
		check('중복 전송 확인 중 화면을 떠나면 늦은 확정 · 실패 모두 반영하지 않는다', r.msgs[0].id == null && r.msgs[0].state === 'sending');
	}

	console.log('\n[8] 방이 만료된 뒤 전송');
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async () => ({ ok: false, reason: 'network' });
		await r.send('확인 응답을 놓침');
		t.sendImpl = async () => ({ ok: false, reason: 'duplicate' });
		t.fetchRecent = async () => { throw new Error('offline'); };
		await r.retry(r.msgs[0]);
		check('중복 확인을 위한 조회가 실패해도 다시 보내기 상태로 남는다', r.msgs[0].state === 'failed');
	}
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async () => ({ ok: false, reason: 'closed' });
		t.snap = snap({ status: 'closed', close_reason: 'expired' });
		await r.send('늦음');
		await sleep(10);
		check('실패 표시', r.msgs[0].state === 'failed');
		check('스냅샷을 다시 받아 종료 상태로 전환', r.closed === true && r.snap.close_reason === 'expired');
		const before = r.msgs.length;
		await r.send('닫힌 방에 또');
		check('닫힌 방에서는 전송 시도 자체를 하지 않는다', r.msgs.length === before);
	}

	console.log('\n[9] ★ 재연결 갭 메우기 + 커밋 순서 역전 보정');
	{
		const t = fake();
		const r = await mk(t);
		// 연결돼 있던 동안 받은 것
		const m1 = row(2, 'm1', undefined, 1);
		t.server.push(m1);
		r.upsert(m1, 'sent');
		// 끊겨 있는 동안 서버에 쌓인 것 (realtime 으로는 안 옴)
		t.server.push(row(2, 'm2', undefined, 2), row(2, 'm4', undefined, 4));
		await r.resync();
		check('재연결 직후 놓친 메시지가 채워진다', bodies(r) === 'm1,m2,m4', bodies(r));
		// id=3 을 먼저 받은 트랜잭션이 이제서야 커밋됨 → gt(maxId=4) 로는 영영 못 본다
		t.server.push(row(2, 'm3', undefined, 3));
		await sleep(1700);
		check('잠시 뒤 tail sweep 이 늦게 커밋된 id=3 을 제자리에 넣는다', bodies(r) === 'm1,m2,m3,m4', bodies(r));
		check('놓친 것 없이 정확히 한 번씩', r.msgs.length === 4);
	}

	console.log('\n[10] 서버 시계 보정');
	{
		const t = fake();
		t.snap = snap({ server_now: new Date(Date.now() + 5 * 60_000).toISOString() });
		t.snapshot = async () => ({ ...t.snap });
		t.closeIfExpired = async () => ({ ...t.snap });
		const r = await mk(t);
		await r.resync();
		const skewMin = Math.round(r.skew / 60_000);
		check('기기 시계가 5분 느려도 skew 로 보정된다', skewMin === 5, `skew=${skewMin}분`);
		check('serverNow() 가 서버 기준 시각을 준다', Math.abs(r.serverNow() - (Date.now() + 5 * 60_000)) < 2000);
	}
	console.log('\n[11] 입장 확인 — 화면을 여는 것이 곧 ack');
	{
		const t = fake();
		t.snap = snap({ status: 'pending', partner_joined: false });
		const r = new ChatRoom(ROOM, t);
		await r.open();
		check('open() 이 ack_room 을 부른다', t.acked === true);
		check('pending 상태로 시작', r.snap.status === 'pending');
		t.handlers.onRoom({ id: ROOM, status: 'active', round: 1, expires_at: new Date(Date.now() + 600_000).toISOString(), close_reason: null, alias1: 'a', alias2: 'b', read1: null, read2: null });
		check('상대가 들어와 active 가 되면 Realtime 으로 즉시 반영', r.snap.status === 'active' && r.snap.partner_joined === true);
		r.dispose();
	}

	console.log('\n[12] 연장 투표');
	{
		const t = fake();
		const r = new ChatRoom(ROOM, t);
		await r.open();
		t.handlers.onVote({ room_id: ROOM, round: 1, seat: 2, agree: true });
		check('상대의 동의가 Realtime 으로 오면 partner_vote=true', r.snap.partner_vote === true);
		t.handlers.onVote({ room_id: ROOM, round: 1, seat: 1, agree: true });
		check('내 표도 반영', r.snap.my_vote === true);
		t.handlers.onVote({ room_id: ROOM, round: 0, seat: 2, agree: false });
		check('이전 라운드의 늦은 표는 무시', r.snap.partner_vote === true);

		const later = new Date(Date.parse(r.snap.expires_at) + 600_000).toISOString();
		t.handlers.onRoom({ id: ROOM, status: 'active', round: 2, expires_at: later, close_reason: null, alias1: 'a', alias2: 'b', read1: null, read2: null });
		check('★ 연장되어 round 가 바뀌면 표가 초기화된다', r.snap.round === 2 && r.snap.my_vote === null && r.snap.partner_vote === null);
		check('마감 시각이 늘어난다', r.snap.expires_at === later);

		t.voteImpl = async (agree) => ({ result: 'waiting', snap: { ...t.snap, round: 2, my_vote: agree, server_now: now() } });
		const res = await r.vote(true);
		check('vote() 는 결과를 돌려주고 스냅샷을 흡수한다', res === 'waiting' && r.snap.my_vote === true);

		let calls = 0;
		t.voteImpl = async () => {
			calls++;
			await sleep(30);
			return { result: 'waiting', snap: { ...t.snap, server_now: now() } };
		};
		await Promise.all([r.vote(true), r.vote(true), r.vote(true)]);
		check('연타해도 요청은 한 번만 나간다', calls === 1, `${calls}회`);

		t.voteImpl = async () => ({ result: 'declined', snap: { ...t.snap, status: 'closed', close_reason: 'declined', server_now: now() } });
		await r.vote(false);
		check('그만하기 → 즉시 종료 상태', r.closed && r.snap.close_reason === 'declined');
		r.dispose();
	}

	console.log('\n[13] ★ 만료 판정은 서버에게 묻는다');
	{
		const t = fake();
		const r = new ChatRoom(ROOM, t);
		await r.open();
		const before = t.calls.snapshot;
		t.snap = snap({ status: 'closed', close_reason: 'expired' });
		await r.checkExpiry();
		check('카운트다운 0 → close_if_expired 로 서버 판정을 받아 종료', r.closed && r.snap.close_reason === 'expired');
		await r.checkExpiry();
		await r.checkExpiry();
		check('닫힌 뒤에는 더 묻지 않는다', t.calls.snapshot === before + 1);
		r.dispose();
	}
	{
		const t = fake();
		const r = new ChatRoom(ROOM, t);
		await r.open();
		// 기기 시계가 2분 빨라서 먼저 0 이 됐지만 서버는 아직 1분 남았다고 한다
		const serverNow = Date.now() - 120_000;
		t.snap = snap({ expires_at: new Date(serverNow + 60_000).toISOString() });
		t.closeIfExpired = async () => ({ ...t.snap, server_now: new Date(serverNow).toISOString() });
		await r.checkExpiry();
		const remain = Date.parse(r.snap.expires_at) - r.serverNow();
		check('★ 서버가 아직이라고 하면 skew 가 보정되어 카운트다운이 되살아난다', r.snap.status === 'active' && Math.abs(remain - 60_000) < 2000, `남은 ${Math.round(remain / 1000)}초`);
		const n = t.calls.snapshot;
		await r.checkExpiry();
		check('3초 안에 다시 묻지 않는다 (throttle)', t.calls.snapshot === n);
		r.dispose();
	}

	console.log('\n[15] ★ Realtime 이 연결된 채로 메시지를 조용히 떨어뜨릴 때');
	{
		const t = fake();
		const r = new ChatRoom(ROOM, t, { safetySyncMs: 200 });
		await r.open();
		t.handlers.onSubscribed();
		await sleep(50);
		t.server.push(row(2, '떨어진 메시지', undefined, 500)); // 서버엔 있는데 Realtime 으로는 안 옴
		check('처음엔 화면에 없다', !r.msgs.some((m) => m.body === '떨어진 메시지'));
		await sleep(350);
		check('★ 안전망 동기화가 재연결 없이도 채운다', r.msgs.some((m) => m.body === '떨어진 메시지'));
		check('★ 주기 안전망은 가볍게 — 공감 전체 목록 · tail sweep 은 안 부른다', t.calls.fetchReactions <= 1 && t.calls.fetchRecent <= 1,
			JSON.stringify(t.calls));
		r.dispose();
		const n = t.calls.snapshot;
		await sleep(450);
		check('dispose 후에는 더 동기화하지 않는다', t.calls.snapshot === n);
	}

	console.log('\n[14] 나가기');
	{
		const t = fake();
		const r = new ChatRoom(ROOM, t);
		await r.open();
		await r.leave(false);
		check('나가기 → left 로 종료', r.closed && r.snap.close_reason === 'left');
		r.dispose();
	}

	console.log('\n[15] 공감 — 바로 보이고, 거절되면 되돌리고, 늦은 에코에 흔들리지 않는다');
	{
		const t = fake();
		const r = await mk(t);
		r.upsert(row(2, '공감할 메시지', 'c1', 900), 'sent');
		const mine = () => r.reactions[900]?.[1];

		let release;
		t.reactImpl = () => new Promise((res) => (release = res));
		const p1 = r.toggleReaction(900, 'heart');
		check('누르자마자 화면에 ❤️ (서버 응답 전)', mine() === 'heart');
		release('ok');
		check('서버가 받으면 그대로', (await p1) === 'ok' && mine() === 'heart');

		t.reactImpl = async () => 'ok';
		await r.toggleReaction(900, 'heart');
		check('같은 걸 또 누르면 취소', mine() === undefined);

		t.reactImpl = async () => 'closed';
		const res = await r.toggleReaction(900, 'fire');
		check('★ 시간이 끝나 거절되면 되돌린다', res === 'closed' && mine() === undefined);

		t.handlers = null;
		const room = new ChatRoom(ROOM, t);
		await room.open();
		room.upsert(row(1, '내 메시지', 'c2', 901), 'sent');
		t.handlers.onReaction({ message_id: 901, room_id: ROOM, seat: 2, emoji: 'laugh' });
		check('상대 공감이 실시간으로 온다', room.reactions[901]?.[2] === 'laugh');
		t.handlers.onReaction({ message_id: 901, room_id: ROOM, seat: 2, emoji: null });
		check('상대가 취소하면 사라진다', room.reactions[901]?.[2] === undefined);

		// ❤️ → 😂 를 빨리 누르는 사이 ❤️ 에코가 늦게 도착
		let rel2;
		t.reactImpl = () => new Promise((res) => (rel2 = res));
		const p2 = room.react(901, 'laugh');
		t.handlers.onReaction({ message_id: 901, room_id: ROOM, seat: 1, emoji: 'heart' });
		check('★ 보내는 중엔 내 자리의 옛 에코를 무시', room.reactions[901]?.[1] === 'laugh');
		rel2('ok');
		await p2;

		// 재연결 동기화: 서버 목록으로 통째로 맞추되, 보내는 중인 내 공감은 지킨다
		t.reactionRows = [
			{ message_id: 901, room_id: ROOM, seat: 1, emoji: 'laugh' },
			{ message_id: 900, room_id: ROOM, seat: 2, emoji: 'wow' }
		];
		let rel3;
		t.reactImpl = () => new Promise((res) => (rel3 = res));
		const p3 = room.react(900, 'sad');
		await room.resync();
		check('동기화로 놓친 상대 공감이 채워진다', room.reactions[900]?.[2] === 'wow');
		check('★ 동기화가 보내는 중인 내 공감을 되돌리지 않는다', room.reactions[900]?.[1] === 'sad');
		rel3('ok');
		await p3;
		t.fetchReactions = async () => {
			throw new Error('network');
		};
		await room.resync();
		check('목록을 못 받으면 화면의 공감을 지우지 않는다', room.reactions[901]?.[1] === 'laugh');
		room.dispose();
	}

	console.log('\n[16] 답장 — 대상 id 가 전송까지 가고, 실패 후 다시 보내도 유지된다');
	{
		const t = fake();
		const r = await mk(t);
		r.upsert(row(2, '원래 메시지', 'o1', 950), 'sent');
		const sent = [];
		t.sendImpl = async (_r, seat, body, cid, replyTo) => {
			sent.push(replyTo);
			if (sent.length === 1) return { ok: false, reason: 'network' };
			const x = { ...row(seat, body, cid), reply_to: replyTo };
			t.server.push(x);
			return { ok: true, row: x };
		};
		await r.send('답장이에요', 950);
		const m = r.msgs.find((x) => x.body === '답장이에요');
		check('보내기 전부터 화면의 메시지에 답장 대상', m.reply_to === 950);
		check('첫 전송에 대상 id 가 실린다', sent[0] === 950 && m.state === 'failed');
		await r.retry(m);
		check('★ 다시 보내도 같은 대상으로', sent[1] === 950 && m.state === 'sent' && m.reply_to === 950);
		await r.send('그냥 메시지');
		check('답장이 아니면 null', sent[2] === null && r.msgs.at(-1).reply_to === null);
	}
	console.log('\n[17] 검열 1단에 막힌 메시지 — 화면에서 지우고 이유를 돌려준다');
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async () => ({ ok: false, reason: 'blocked', code: 'personal_info' });
		const before = r.msgs.length;
		const res = await r.send('내 번호 01012345678');
		check('이유 코드를 돌려준다', res?.blocked === 'personal_info');
		check('★ 화면에 "실패"로 남지 않는다 (다시 보내도 똑같이 막히므로)', r.msgs.length === before && !r.msgs.some((m) => m.body.includes('0101')));
		t.sendImpl = async (_r, seat, body, cid) => {
			const x = { ...row(seat, body, cid), reply_to: null };
			t.server.push(x);
			return { ok: true, row: x };
		};
		check('막힌 뒤에도 다음 메시지는 보내진다', (await r.send('안녕하세요')) === null && r.msgs.at(-1).body === '안녕하세요');
	}
	console.log('\n[18] 찾는 중 폴링 — 오래 기다릴수록 천천히, 서버 풀 TTL(15초) 안쪽');
	{
		const { waitingPollMs } = await import(modules.get('seeker'));
		check('처음 30초는 서버 간격 그대로', waitingPollMs(4000, 10_000) === 4000);
		check('30초 넘으면 8초', waitingPollMs(4000, 45_000) === 8000);
		check('2분 넘으면 10초', waitingPollMs(4000, 150_000) === 10_000);
		check('서버 간격이 더 길면 그걸 따른다', waitingPollMs(12_000, 150_000) === 12_000);
		check('★ 늘 풀 TTL 15초보다 짧다 (지터 0.6초 포함)', [0, 45_000, 999_999].every((w) => waitingPollMs(4000, w) + 600 < 15_000));
	}

	console.log('\n[19] 첫 동기화 중 실시간 메시지가 먼저 와도 전체 과거 기록을 읽는다');
	{
		const t = fake();
		t.server = Array.from({ length: 101 }, (_, i) => row(2, `history-${i + 1}`, `history-${i + 1}`, i + 1));
		let release;
		t.closeIfExpired = () => new Promise((resolve) => (release = resolve));
		const r = await mk(t);
		const syncing = r.resync();
		r.upsert(t.server.at(-1), 'sent'); // 스냅샷을 기다리는 동안 높은 id 방송
		release(snap());
		await syncing;
		check('★ 최근 50개에 가려지던 과거 메시지도 모두 가져온다', r.msgs.length === 101 && r.msgs[0].id === 1);
		check('실시간과 조회가 겹쳐도 중복은 없다', new Set(r.msgs.map((m) => m.id)).size === 101);
		r.dispose();
	}

	console.log('\n[20] 뒤 메시지가 실시간으로 와도 중간 유실은 주기 안전망이 메운다');
	{
		const t = fake();
		t.server = [row(2, 'before-gap', 'before-gap', 1000)];
		const r = new ChatRoom(ROOM, t, { safetySyncMs: 30 });
		await r.open();
		t.handlers.onSubscribed();
		await sleep(10);
		const missed = row(2, 'missed-middle', 'missed-middle', 1001);
		const later = row(2, 'received-later', 'received-later', 1002);
		t.server.push(missed, later);
		t.handlers.onMessage(later);
		check('중간 메시지는 처음엔 없고 뒤 메시지만 보인다', !r.msgs.some((m) => m.id === 1001) && r.msgs.some((m) => m.id === 1002));
		await sleep(100);
		check('★ 재연결 없이도 중간 메시지가 채워진다', bodies(r) === 'before-gap,missed-middle,received-later');
		r.dispose();
	}

	console.log('\n[21] 조회 실패와 중첩 동기화 — 조회 완료 전에는 커서를 확정하지 않는다');
	{
		const t = fake();
		const cursors = [];
		const fetch = t.fetchAfter;
		let failOnce = true;
		t.fetchAfter = async (id, after) => {
			cursors.push(after);
			if (failOnce) { failOnce = false; throw new Error('page failed'); }
			return fetch(id, after);
		};
		const r = await mk(t);
		r.upsert(row(2, 'live-first', 'live-first', 1101), 'sent');
		t.server.push(row(2, 'older', 'older', 1100), row(2, 'live-first', 'live-first', 1101));
		await r.resync();
		await r.resync();
		check('실패한 첫 조회는 같은 커서 0으로 다시 시작한다', cursors.join(',') === '0,0');
		check('★ 방송보다 오래된 행도 실패 후 재조회로 복구한다', bodies(r) === 'older,live-first');
		r.dispose();
	}
	{
		const t = fake();
		let release;
		let calls = 0;
		t.fetchAfter = () => { calls++; return new Promise((resolve) => (release = resolve)); };
		const r = await mk(t);
		const first = r.resync();
		await sleep(0);
		const second = r.resync();
		await sleep(0);
		check('중첩 동기화는 같은 메시지 조회를 기다린다', calls === 1);
		release([row(2, 'shared-fetch', 'shared-fetch', 1200)]);
		await Promise.all([first, second]);
		check('중첩 응답도 메시지는 한 번만 보인다', r.msgs.length === 1);
		r.dispose();
	}

	console.log('\n[22] 읽음 실패 재시도 · 아직 안 본 새 메시지 보호 · dispose 정리');
	{
		// 읽음의 2초 스로틀만 단축한다. 재시도는 실제 ChatRoom 타이머를 거친다.
		const originalTimeout = globalThis.setTimeout;
		globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 2000 ? 10 : ms, ...args);
		try {
			const t = fake();
			const reads = [];
			t.markRead = async (_id, last) => {
				reads.push(last);
				if (reads.length === 1) throw new Error('offline');
			};
			const r = await mk(t);
			r.upsert(row(2, 'seen', 'seen', 1300), 'sent');
			r.markRead();
			// 읽음을 예약한 뒤 위로 스크롤했다면 이 새 메시지는 아직 읽지 않았다.
			r.upsert(row(2, 'unseen', 'unseen', 1301), 'sent');
			await sleep(60);
			check('★ 실패한 읽음은 같은 목표로 다시 보낸다', reads.join(',') === '1300,1300');
			r.markRead();
			await sleep(30);
			check('새 메시지를 실제로 봤을 때 다음 읽음이 저장된다', reads.join(',') === '1300,1300,1301');
			r.markRead();
			await sleep(30);
			check('성공한 목표는 중복 전송하지 않는다', reads.length === 3);
			r.upsert(row(2, 'after', 'after', 1302), 'sent');
			r.markRead();
			r.dispose();
			await sleep(30);
			check('화면을 떠나면 예약된 읽음은 보내지 않는다', reads.length === 3);

			// 서버가 계속 거절하면 — 간격을 벌리다 멈춘다 (2초마다 끝없이 묻지 않는다)
			globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, [2000, 4000, 8000, 16000].includes(ms) ? 5 : ms, ...args);
			const t2 = fake();
			let tries = 0;
			t2.markRead = async () => {
				tries++;
				throw new Error('down');
			};
			const r2 = await mk(t2);
			r2.upsert(row(2, 'down', 'down', 1400), 'sent');
			r2.markRead();
			await sleep(300);
			check('★ 읽음이 계속 실패하면 다섯 번에서 멈춘다 (요청이 끝없이 나가지 않는다)', tries === 5, String(tries));
			r2.dispose();
		} finally {
			globalThis.setTimeout = originalTimeout;
		}
	}

	console.log('\n[23] DB 방송과 학생의 타이핑 · 접속 채널을 분리한다');
	{
		const { SupabaseTransport } = await import(modules.get('transport'));
		const channels = [];
		const removed = [];
		const client = {
			channel(topic, options) {
				const ch = {
					topic, options, listeners: new Map(), sent: [], tracked: [], callback: null,
					on(type, filter, handler) { this.listeners.set(`${type}:${filter.event}`, handler); return this; },
					subscribe(callback) { this.callback = callback; return this; },
					async track(payload) { this.tracked.push(payload); return 'ok'; },
					presenceState: () => ({ 1: [{ seat: 1 }], 2: [{ seat: 2 }] }),
					async send(payload) { this.sent.push(payload); return 'ok'; },
					emit(type, event, payload) { this.listeners.get(`${type}:${event}`)?.({ payload }); }
				};
				channels.push(ch);
				return ch;
			},
			async removeChannel(ch) { removed.push(ch); }
		};
		const received = { messages: [], rooms: [], votes: [], reactions: [], typing: [], presence: [], subscribed: 0, down: 0 };
		const handlers = {
			onMessage: (x) => received.messages.push(x), onRoom: (x) => received.rooms.push(x),
			onVote: (x) => received.votes.push(x), onReaction: (x) => received.reactions.push(x),
			onTyping: (x) => received.typing.push(x), onPresence: (x) => received.presence.push(x),
			onSubscribed: () => received.subscribed++, onDown: () => received.down++
		};
		const t = new SupabaseTransport(client);
		t.connect(ROOM, 1, handlers);
		const [db, peer] = channels;
		check('DB와 학생 채널 모두 비공개이며 서로 다른 주제다', db.topic === `room:${ROOM}` && peer.topic === `peer:${ROOM}` && db.options.config.private && peer.options.config.private);
		await db.callback('SUBSCRIBED');
		check('peer 접속이 완료되기 전에는 연결 완료로 알리지 않는다', received.subscribed === 0);
		await peer.callback('SUBSCRIBED');
		check('둘 다 구독하고 자리만 presence로 보낸다', received.subscribed === 1 && JSON.stringify(peer.tracked) === '[{"seat":1}]' && db.tracked.length === 0);
		peer.emit('broadcast', 'msg', row(0, 'forged-system', 'forged-system', 1400));
		peer.emit('broadcast', 'room', { id: ROOM, status: 'closed' });
		peer.emit('broadcast', 'vote', { room_id: ROOM, seat: 1, agree: true });
		peer.emit('broadcast', 'reaction', { room_id: ROOM, seat: 1, emoji: 'heart' });
		check('★ 학생 채널에서 보낸 메시지 · 종료 · 표 · 공감은 무시한다', ['messages', 'rooms', 'votes', 'reactions'].every((key) => received[key].length === 0));
		db.emit('broadcast', 'msg', row(2, 'db-message', 'db-message', 1401));
		check('DB 읽기 채널의 정상 메시지는 받는다', received.messages.length === 1 && received.messages[0].body === 'db-message');
		t.typing(1);
		peer.emit('broadcast', 'typing', { seat: 2 });
		peer.emit('presence', 'sync');
		check('타이핑은 peer 채널에서만 보내고 받는다', db.sent.length === 0 && peer.sent[0]?.event === 'typing' && received.typing.join(',') === '2');
		check('접속 상태는 자리만으로 읽는다', received.presence.at(-1).join(',') === '1,2');
		t.connect(ROOM, 1, handlers);
		db.emit('broadcast', 'msg', row(2, 'stale', 'stale', 1402));
		await db.callback('CLOSED');
		check('교체한 옛 채널의 늦은 메시지 · 종료 콜백은 무시한다', received.messages.length === 1 && received.down === 0);
		const [nextDb, nextPeer] = channels.slice(2);
		let finishTrack;
		nextPeer.track = () => new Promise((resolve) => (finishTrack = resolve));
		await nextDb.callback('SUBSCRIBED');
		const tracking = nextPeer.callback('SUBSCRIBED');
		await nextPeer.callback('CHANNEL_ERROR');
		finishTrack('ok');
		await tracking;
		check('★ peer가 끊긴 뒤 늦은 presence 성공이 연결 완료로 되돌리지 않는다', received.subscribed === 1 && received.down === 1);
		nextPeer.track = async () => 'ok';
		await nextPeer.callback('SUBSCRIBED');
		check('새 peer 구독의 presence가 완료돼야 다시 연결됨을 알린다', received.subscribed === 2);
		t.disconnect();
		check('연결을 닫으면 두 채널 모두 해제한다', removed.length === 4);
	}

	console.log('\n[24] 전송 계층은 읽음 실패와 부분 페이지 조회 실패를 숨기지 않는다');
	{
		const { SupabaseTransport } = await import(modules.get('transport'));
		const pages = [];
		const networkError = { message: 'temporary network outage' };
		const client = {
			async rpc() { return { data: null, error: networkError }; },
			from() {
				return {
					select() { return this; }, eq() { return this; }, order() { return this; },
					gt(_key, id) { pages.push(id); return this; },
					async limit() {
						return pages.length === 1
							? { data: Array.from({ length: 200 }, (_, i) => row(2, `page-${i}`, `page-${i}`, i + 1)), error: null }
							: { data: null, error: networkError };
					}
				};
			}
		};
		const t = new SupabaseTransport(client);
		let readError;
		try { await t.markRead(ROOM, 10); } catch (e) { readError = e; }
		check('읽음 RPC 오류를 호출자에게 전달한다', readError === networkError);
		let fetchError;
		try { await t.fetchAfter(ROOM, 0); } catch (e) { fetchError = e; }
		check('★ 첫 페이지가 성공해도 다음 페이지 오류는 전체 조회 실패다', fetchError === networkError && pages.join(',') === '0,200');
	}

	console.log('\n[25] 메시지 확정 · 삭제는 늦은 응답으로 되돌리지 않는다');
	{
		const t = fake();
		const r = await mk(t);
		t.sendImpl = async (_id, seat, body, cid) => {
			r.upsert(row(seat, body, cid), 'sent');
			return { ok: false, reason: 'network' }; // 커밋 에코 뒤에 HTTP 응답만 실패
		};
		await r.send('서버에 들어간 메시지');
		const message = r.msgs[0];
		check('★ 확정 에코가 먼저 오면 늦은 전송 실패에도 sent 상태', message.id != null && message.state === 'sent');
		let attempts = 0;
		t.sendImpl = async () => { attempts++; return { ok: false, reason: 'network' }; };
		await r.retry(message);
		check('이미 확정한 메시지는 재전송하지 않는다', attempts === 0 && message.state === 'sent');
		r.upsert({ client_msg_id: message.client_msg_id, deleted_at: now(), body: '삭제된 메시지입니다' }, 'sent');
		r.upsert({ ...message, deleted_at: null, body: '옛 본문' }, 'sent');
		check('삭제 뒤 옛 방송을 받아도 본문을 되살리지 않는다', message.deleted_at != null && message.body === '삭제된 메시지입니다');
		r.dispose();
	}

	console.log('\n[26] 방 수명 — 중복 open · 입장 중 이탈 · 늦은 동기화 응답');
	{
		const t = fake();
		let release;
		let acks = 0;
		let connects = 0;
		const views = [];
		t.ack = () => { acks++; return new Promise((resolve) => (release = resolve)); };
		t.connect = () => { connects++; };
		t.view = async (_id, on) => { views.push(on); return snap(); };
		const r = new ChatRoom(ROOM, t);
		const first = r.open();
		const second = r.open();
		check('입장 중 다시 열어도 같은 입장 요청을 기다린다', acks === 1 && first === second);
		r.dispose();
		release(snap());
		await Promise.all([first, second]);
		check('★ 입장 중 떠나면 응답이 와도 구독 · 상태를 만들지 않는다', connects === 0 && r.snap === null && !r.connected);
		check('늦은 입장 확인 뒤에도 보고 있음 신호를 끈다', views.join(',') === 'false,false');
		await r.open();
		await r.resync();
		check('이탈한 방은 다시 열거나 동기화하지 않는다', acks === 1 && t.calls.snapshot === 0);
	}
	{
		const t = fake();
		let release;
		t.closeIfExpired = () => new Promise((resolve) => (release = resolve));
		const r = await mk(t);
		const syncing = r.resync();
		r.dispose();
		release(snap({ round: 2 }));
		await syncing;
		check('늦은 스냅샷은 상태를 바꾸거나 메시지 · 공감을 추가 조회하지 않는다', r.snap.round === 1 && t.calls.fetchAfter === 0 && t.calls.fetchReactions === 0);
	}
	{
		const t = fake();
		let release;
		t.fetchReactions = () => new Promise((resolve) => (release = resolve));
		const r = await mk(t);
		const syncing = r.resync();
		await sleep(0);
		r.dispose();
		release([{ message_id: 1500, room_id: ROOM, seat: 2, emoji: 'heart' }]);
		await syncing;
		check('이탈 뒤 늦은 공감 목록은 반영하지 않는다', r.reactions[1500] === undefined);
	}
	{
		const t = fake();
		let connects = 0;
		const connect = t.connect;
		t.connect = (...args) => { connects++; connect(...args); };
		const r = new ChatRoom(ROOM, t);
		await r.open();
		await r.open();
		check('이미 열린 방을 다시 열어도 구독은 하나', connects === 1);
		t.handlers.onSubscribed();
		await sleep(0);
		await r.leave(false);
		t.handlers.onSubscribed();
		t.handlers.onPresence([1, 2]);
		check('종료된 방은 늦은 구독 · 접속 신호에도 끊긴 상태', r.closed && !r.connected && !r.partnerHere);
		r.dispose();
	}

	console.log('\n[28] 나가기 실패와 큰 고정 채팅의 조회 범위');
	{
		const t = fake(), r = await mk(t);
		t.leave = async () => { throw new Error('offline'); };
		check('나가기 실패는 화면과 방을 종료하지 않는다', !(await r.leave(false)) && !r.closed && !r.endedByMe);
		r.dispose();
	}
	for (const size of [100, 1000, 10000]) {
		const t = fake(); t.snap = snap({ pinned: true });
		t.server = Array.from({ length: size }, (_, i) => row(1, '본문', 'message-' + i, i + 1));
		t.fetchBefore = async (_r, before, n) => t.server.filter((m) => m.id < before).sort((a, b) => b.id - a.id).slice(0, n);
		const r = await mk(t); await r.resync();
		check(size + '개 고정 채팅도 초기 조회는 최대 200개', r.msgs.length === Math.min(size, 200) && t.calls.fetchAfter === 0);
		if (size > 200) {
			await r.loadOlder(); check('이전 대화는 중복 없이 200개씩 추가 (' + size + ')', r.msgs.length === 400 && r.msgs[0].id === size - 399);
		} else check('짧은 대화는 더 보기 없음', !r.hasOlder);
		r.dispose();
	}
	console.log('\n[27] 기록 병합 비용 — 순서가 바뀔 때만 정렬');
	{
		const { MessageLedger } = await import(modules.get('ledger'));
		const ledger = new MessageLedger(ROOM, () => 1, Date.now);
		const history = Array.from({ length: 10000 }, (_, i) => row(1, '본문', 'perf-' + i, i + 10));
		ledger.merge(history, 'sent');
		let sorts = 0;
		const sort = Array.prototype.sort;
		Array.prototype.sort = function (...args) { if (this === ledger.rows) sorts++; return sort.apply(this, args); };
		try {
			for (let i = 0; i < 100; i++) ledger.merge([], 'sent');
			ledger.merge([history.at(-1), row(2, '새 말', 'perf-new', 10010)], 'sent');
			check('10,000개 기록의 빈 동기화 100회·순차 추가는 전체 정렬 0회', sorts === 0 && ledger.rows.at(-1).id === 10010);
			ledger.merge([row(2, '이전 말', 'perf-older', 2), row(2, '이전 말', 'perf-oldest', 1)], 'sent');
			check('과거 메시지는 묶음 전체를 한 번 정렬', sorts === 1 && ledger.rows[0].id === 1 && ledger.rows[1].id === 2, JSON.stringify({sorts, ids: ledger.rows.slice(0, 3).map(m => m.id)}));
			ledger.upsert({ client_msg_id: 'perf-pending', id: null }, 'sending');
			ledger.merge([row(1, '확정', 'perf-pending', 7)], 'sent');
			check('낙관적 메시지 확정도 실제 id 순서로 이동', sorts === 2 && ledger.get('perf-pending').state === 'sent' && ledger.rows.findIndex(m => m.client_msg_id === 'perf-pending') < ledger.rows.length - 1, JSON.stringify({sorts, state: ledger.get('perf-pending').state, index: ledger.rows.findIndex(m => m.client_msg_id === 'perf-pending')}));
		} finally { Array.prototype.sort = sort; }
	}
	console.log('\n[28] 찾기 수명 — 취소한 요청이 새 찾기를 끝내지 않는다');
	{
		const { PollSeeker } = await import(modules.get('pollSeeker'));
		class TestSeeker extends PollSeeker {
			requests = [];
			handled = [];
			request() { return new Promise((resolve) => this.requests.push(resolve)); }
			handle(result) { this.handled.push(result); this.halt(); }
		}
		const seeker = new TestSeeker(() => {});
		seeker.start();
		await sleep(5);
		seeker.cancel();
		seeker.start();
		await sleep(5);
		check('이전 요청이 끝날 때까지 서버 요청을 겹치지 않는다', seeker.requests.length === 1);
		seeker.requests[0]('old-match');
		await sleep(5);
		check('★ 이전 응답은 버리고 새 찾기 요청을 이어 간다', seeker.handled.length === 0 && seeker.seeking && seeker.requests.length === 2);
		seeker.requests[1]('current-match');
		await sleep(5);
		check('새 요청의 결과만 반영한다', seeker.handled.join(',') === 'current-match' && !seeker.seeking);
	}
	console.log('\n[29] 계정 전환 — 이전 매칭 응답을 폐기하고 새 계정에 취소 요청을 보내지 않는다');
	{
		const { Seeker } = await import(modules.get('seeker'));
		const { supabase } = await import(modules.get('supabase'));
		const calls = [];
		supabase.rpc = (fn) => { calls.push(fn); return Promise.resolve({ data: null }); };
		class AccountSeeker extends Seeker {
			requests = [];
			request() { return new Promise((resolve) => this.requests.push(resolve)); }
		}
		const matched = [];
		const seeker = new AccountSeeker((id) => matched.push(id), () => {});
		seeker.start(); await sleep(5);
		seeker.reset();
		seeker.requests[0]({ status: 'matched', room_id: 'previous-account' }); await sleep(5);
		check('계정 전환 후 늦은 매칭으로 화면을 이동하지 않는다', !seeker.seeking && matched.length === 0);
		check('계정 전환 정리는 새 인증 세션으로 RPC를 보내지 않는다', calls.length === 0);
		seeker.start(); await sleep(5);
		seeker.requests[1]({ status: 'matched', room_id: 'current-account' }); await sleep(5);
		check('새 계정 찾기는 정상적으로 연결된다', matched.join(',') === 'current-account' && !seeker.seeking);
	}
	console.log('\n[30] 실제 서버 취소 — thenable 실행과 재시작 순서');
	{
		const { Seeker } = await import(modules.get('seeker'));
		const { supabase } = await import(modules.get('supabase'));
		const calls = []; let release;
		supabase.rpc = (fn) => ({ then(resolve) {
			calls.push(fn);
			if (fn === 'stop_seeking') release = () => resolve({ data: null });
			else resolve({ data: { status: 'waiting', reason: 'empty', poll_ms: 4000 } });
		} });
		const seeker = new Seeker(() => {}, () => {});
		seeker.start(); await sleep(5); seeker.cancel(); await sleep(5);
		check('취소 RPC thenable을 실제 실행한다', calls.join(',') === 'request_match,stop_seeking');
		seeker.start(); await sleep(5);
		check('취소 응답 전에는 새 찾기 요청을 보내지 않는다', calls.length === 2);
		release(); await sleep(5);
		check('취소 완료 후 새 대기를 갱신한다', calls.join(',') === 'request_match,stop_seeking,request_match' && seeker.seeking);
		seeker.reset();
	}
} catch (e) {
	fail++;
	console.error(e);
} finally {
	for (const path of temporaryFiles) rmSync(path, { force: true });
	rmdirSync(temporary);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

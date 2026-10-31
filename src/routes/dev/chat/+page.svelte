<script lang="ts">
	/**
	 * 개발 전용 — 대화방 화면 미리보기. Supabase 없이 가짜 전송 계층으로 상태를 재현한다.
	 * 연장 배너처럼 실계정으로는 8분 넘게 기다려야 보이는 화면을 바로 확인하기 위한 것.
	 *
	 *   /dev/chat?s=chat | fresh | vote | waiting | pending | ended | paused | hints | question | pin | pinned | rate | pinrate   (&sheet=menu|report|block|profile 로 시트 열기, &matched 로 연결 화면, &incoming 으로 상대 새 메시지)
	 *
	 * 배포 빌드에서는 dev/+layout.ts 가 404 로 막는다.
	 */
	import { page } from '$app/state';
	import { ChatRoom } from '$lib/chat/room.svelte';
	import ChatView from '$lib/chat/ChatView.svelte';
	import { toast } from '$lib/state.svelte';
	import type { ChatTransport, TransportHandlers } from '$lib/chat/transport';
	import type { Hint, MsgRow, ReactionKey, ReactionRow, RoomSnap } from '$lib/chat/types';
	import type { Reason, Score } from '$lib/manner';

	const ROOM = 'preview-room';
	// 주소는 들어올 때 한 번만 읽는다 — page.url 은 창(고르기 · 시트)을 닫을 때마다(history.back) 새 객체가 되어,
	// 아래 $effect 가 그것을 추적하면 방을 새로 만들어 보낸 메시지 · 공감이 사라진다
	const q = page.url.searchParams;
	const scenario = q.get('s') ?? 'chat';

	const sec = (n: number) => new Date(Date.now() + n * 1000).toISOString();
	const base: RoomSnap = {
		room_id: ROOM,
		status: 'active',
		my_seat: 1,
		my_alias: '말랑복숭아',
		partner_alias: '새벽수달',
		expires_at: sec(372),
		round: 1,
		max_rounds: 0,
		extend_minutes: 10,
		vote_window_sec: 90,
		my_vote: null,
		partner_vote: null,
		partner_joined: true,
		partner_online: true,
		their_read_id: 7,
		close_reason: null,
		server_now: new Date().toISOString()
	};
	const HINTS2 = {
		partner: [
			{ kind: 'grade', label: '학년', value: '2학년' },
			{ kind: 'q1', label: '요즘 빠져 있는 것', value: '밴드 음악' }
		],
		mine: [
			{ kind: 'grade', label: '학년', value: '1학년' },
			{ kind: 'q1', label: '요즘 빠져 있는 것', value: '러닝' }
		]
	} satisfies Record<string, Hint[]>;
	const HINTS5: Hint[] = [
		...HINTS2.partner,
		{ kind: 'diploma', label: '디플로마', value: 'IB' },
		{ kind: 'q2', label: '좋아하는 계절', value: '가을' },
		{ kind: 'club', label: '동아리', value: '밴드부' }
	];
	const SNAPS: Record<string, Partial<RoomSnap>> = {
		chat: {},
		fresh: { their_read_id: null },
		vote: { expires_at: sec(72), partner_vote: true },
		waiting: { expires_at: sec(48), my_vote: true },
		pending: { status: 'pending', expires_at: sec(47), partner_joined: false, their_read_id: null },
		ended: { status: 'closed', close_reason: 'expired', expires_at: sec(-1) },
		// 상대가 화면을 안 보고 있어 시간이 멈춤 (Phase 28) — 남은 5:00 그대로
		paused: { paused: true, expires_at: sec(300) },
		// 두 번 연장해 학년 · 공통 질문 답이 공개됐고, 다음(디플로마)은 연장할 때 직접 적는 차례 (Phase 29 순서)
		hints: {
			round: 3,
			expires_at: sec(70),
			partner_hints: HINTS2.partner,
			my_hints: HINTS2.mine,
			next_hint: { kind: 'diploma', label: '디플로마', typed: true }
		},
		// 20분 째 — 공통 질문에 답하면서 연장하는 차례
		question: {
			round: 2,
			expires_at: sec(70),
			partner_hints: HINTS2.partner.slice(0, 1),
			my_hints: HINTS2.mine.slice(0, 1),
			next_hint: { kind: 'q1', label: '요즘 빠져 있는 것', typed: true }
		},
		// 60분 째 — 동아리까지 다 공개됐고, 연장 대신 "이 채팅을 고정하시겠습니까?"
		pin: { round: 6, expires_at: sec(70), partner_vote: true, partner_hints: HINTS5, my_hints: HINTS5, next_hint: null, pin_next: true },
		// 둘 다 고정한 대화 — 타이머 없이 "고정됨"
		pinned: { round: 7, expires_at: 'infinity', partner_hints: HINTS5, my_hints: HINTS5, next_hint: null, pinned: true },
		// 끝난 대화 — 매너 평가 카드 (Phase 30)
		rate: { status: 'closed', close_reason: 'expired', expires_at: sec(-1), can_rate: true, rated: false },
		// 고정한 대화 — 위쪽 "평가하기" 막대
		pinrate: { round: 7, expires_at: 'infinity', partner_hints: HINTS5, my_hints: HINTS5, next_hint: null, pinned: true, can_rate: true, rated: false }
	};

	let id = 0;
	/** minAgo 분 전에 보낸 메시지. replyTo = 답장 대상 id */
	const m = (seat: 0 | 1 | 2, body: string, minAgo = 0, replyTo: number | null = null): MsgRow => ({
		id: ++id,
		room_id: ROOM,
		sender_seat: seat,
		body,
		client_msg_id: crypto.randomUUID(),
		created_at: new Date(Date.now() - minAgo * 60_000).toISOString(),
		reply_to: replyTo
	});
	// 앞쪽은 8분 전, 뒤쪽은 방금 — 사이에 시간 구분선. 6번은 5번("실리카겔 좋아하세요?")에 대한 답장.
	// &s=fresh : 상대 인사만 있고 내가 아직 말을 안 한 상태 (첫마디 도우미)
	const MSGS: MsgRow[] =
		scenario === 'pending'
			? []
			: scenario === 'fresh'
				? [m(0, '10분 동안 이야기할 수 있어요. 이름·학번·SNS는 묻지도 말하지도 않기로 해요.'), m(2, '안녕하세요!')]
				: [
						m(0, '10분 동안 이야기할 수 있어요. 이름·학번·SNS는 묻지도 말하지도 않기로 해요.', 8),
						m(2, '안녕하세요!', 8),
						m(2, '혹시 요즘 뭐 듣는 노래 있어요?', 8),
						m(1, '저 요즘 밴드 음악만 들어요', 7),
						m(1, '실리카겔 좋아하세요?', 1),
						m(2, '헐 저도 좋아해요 ㅋㅋㅋ 무드 좋던데', 1, 5),
						m(1, '와 진짜요? 반갑네요'),
						m(2, '공연도 가봤어요?'),
						m(1, '아직이요… 이번에 가보고 싶어요')
					];

	/** 인메모리 가짜 전송 — 보내면 바로 성공, 상대는 이따금 타이핑 */
	class PreviewTransport implements ChatTransport {
		snap: RoomSnap = { ...base, ...SNAPS[scenario] };
		rows = [...MSGS];
		h: TransportHandlers | null = null;
		connect(_r: string, _s: 1 | 2, h: TransportHandlers) {
			this.h = h;
			setTimeout(() => {
				h.onSubscribed();
				h.onPresence(scenario === 'pending' ? [1] : [1, 2]);
				if (scenario === 'chat') h.onTyping(2);
			}, 50);
			// &incoming : 1.2초 뒤 상대가 새 메시지를 보낸다 (화면 낭독기 안내 확인용)
			if (q.has('incoming'))
				setTimeout(() => {
					const row = m(2, '방금 온 메시지예요');
					this.rows.push(row);
					h.onMessage(row);
				}, 1200);
		}
		disconnect() {}
		async send(_r: string, seat: 1 | 2, body: string, cid: string, replyTo: number | null = null) {
			// 검열 1단 흉내 — 전화번호는 서버(DB 트리거)가 막는다
			if (/01[016789]\d{7,8}/.test(body.replace(/[\s.-]/g, ''))) return { ok: false as const, reason: 'blocked' as const, code: 'personal_info' };
			const row: MsgRow = { ...m(seat, body), client_msg_id: cid, reply_to: replyTo };
			this.rows.push(row);
			// &read : 보낸 메시지를 상대가 1초 뒤 읽음 ("읽음" 표시가 화면 안으로 따라오는지 확인용)
			if (q.has('read')) {
				setTimeout(() => {
					this.snap = { ...this.snap, their_read_id: row.id };
					this.h?.onRoom({
						id: ROOM, status: this.snap.status, round: this.snap.round, expires_at: this.snap.expires_at,
						close_reason: null, alias1: this.snap.my_alias, alias2: this.snap.partner_alias, read1: null, read2: row.id
					});
				}, 1000);
			}
			return { ok: true as const, row };
		}
		async fetchAfter(_r: string, after: number) {
			return this.rows.filter((x) => x.id > after);
		}
		async fetchRecent() {
			return this.rows.slice(-50);
		}
		#s() {
			return { ...this.snap, server_now: new Date().toISOString() };
		}
		async snapshot() {
			return this.#s();
		}
		async ack() {
			return this.#s();
		}
		async closeIfExpired() {
			return this.#s();
		}
		votes: { agree: boolean; hint: string | null }[] = [];
		async vote(_r: string, agree: boolean, hint: string | null = null) {
			this.votes.push({ agree, hint });
			(window as unknown as { __votes: unknown }).__votes = this.votes;
			if (agree && this.snap.next_hint?.typed && !hint?.trim()) return { result: 'need_hint' as const, snap: this.#s() };
			this.snap = agree
				? { ...this.snap, my_vote: true }
				: { ...this.snap, status: 'closed', close_reason: 'declined' };
			return { result: agree ? ('waiting' as const) : ('declined' as const), snap: this.#s() };
		}
		rates: { score: string; reasons: string[] }[] = [];
		async rate(_r: string, score: Score, reasons: Reason[]) {
			this.rates.push({ score, reasons });
			(window as unknown as { __rates: unknown }).__rates = this.rates;
			this.snap = { ...this.snap, can_rate: false, rated: true };
			return 'ok' as const;
		}
		async leave(_r: string, skip: boolean) {
			this.snap = { ...this.snap, status: 'closed', close_reason: skip ? 'skipped' : 'left' };
			return this.#s();
		}
		async report() {
			this.snap = { ...this.snap, status: 'closed', close_reason: 'reported' };
			return { status: 'ok' as const, snap: this.#s() };
		}
		async block() {
			this.snap = { ...this.snap, status: 'closed', close_reason: 'blocked' };
			return this.#s();
		}
		async markRead() {}
		views: boolean[] = [];
		async view(_r: string, on: boolean) {
			this.views.push(on);
			(window as unknown as { __views: unknown }).__views = this.views;
			return this.#s();
		}
		async deleteMessage(id: number) {
			if (this.snap.status === 'closed') return 'closed' as const;
			const row = this.rows.find((x) => x.id === id);
			if (!row || row.sender_seat !== 1) return 'not_found' as const;
			Object.assign(row, { body: '삭제된 메시지입니다', deleted_at: new Date().toISOString() });
			setTimeout(() => this.h?.onMessage({ ...row }), 80); // 실시간 UPDATE 에코
			return 'ok' as const;
		}
		// 공감 — 상대가 내 메시지 하나에 ❤️ 를 달아 둔 상태로 시작. 내 공감은 실시간처럼 조금 뒤 에코된다.
		reactions: ReactionRow[] = this.rows
			.filter((x) => x.sender_seat === 1 && x.body.startsWith('실리카겔'))
			.map((x) => ({ message_id: x.id, room_id: ROOM, seat: 2 as const, emoji: 'heart' as const }));
		async react(_r: string, messageId: number, emoji: ReactionKey | null) {
			if (this.snap.status !== 'active') return 'closed' as const;
			const row: ReactionRow = { message_id: messageId, room_id: ROOM, seat: 1, emoji };
			this.reactions = [...this.reactions.filter((x) => !(x.message_id === messageId && x.seat === 1)), row];
			setTimeout(() => this.h?.onReaction(row), 120);
			return 'ok' as const;
		}
		async fetchReactions() {
			return this.reactions.filter((x) => x.emoji);
		}
		async partnerProfile() {
			return {
				nickname: this.snap.partner_alias,
				bio: '밴드 음악 좋아해요. 공연 같이 얘기해요',
				interests: ['밴드', '기타', '영화'],
				mbti: 'INFP',
				manner_temp: 42.3,
				badges: [
					{ code: 'warm', title: '따뜻한 사람', icon: '🌡️', tier: 2 as const },
					{ code: 'pin', title: '고정 친구', icon: '📌', tier: 1 as const },
					{ code: 'fun', title: '이야기꾼', icon: '🎉', tier: 3 as const }
				],
				badge_count: 7,
				online: true
			};
		}
		typing() {}
	}

	let room = $state<ChatRoom | null>(null);
	let loading = $state(true);

	$effect(() => {
		if (!import.meta.env.DEV) return;
		const r = new ChatRoom(ROOM, new PreviewTransport());
		room = r;
		void r.open().then(() => (loading = false));
		// &toast : 알림이 2.4초 뒤 사라지는지 확인용
		if (q.has('toast')) toast('테스트 알림'); // toast() 는 내부에서 untrack
		return () => r.dispose();
	});
</script>

{#if import.meta.env.DEV}
	<ChatView {room} {loading} initialSheet={q.get('sheet') as never} matched={q.has('matched')} />
{/if}

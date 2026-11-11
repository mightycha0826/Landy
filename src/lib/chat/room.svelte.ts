import type { ChatTransport } from './transport';
import { SupabaseTransport } from './supabase-transport';
import { MessageLedger, type MessageUpdate } from './message-ledger.svelte';
import type {
	Msg,
	PartnerProfile,
	ReactResult,
	ReactionKey,
	ReactionRow,
	ReportReason,
	RoomRow,
	RoomSnap,
	VoteResult,
	VoteRow
} from './types';
import type { Reason, RateStatus, Score } from '../manner';

const TYPING_SHOW_MS = 3000;
const TYPING_SEND_EVERY_MS = 1500;
const TAIL_SWEEP_DELAY_MS = 1500;
const BG_RECREATE_MS = 10_000;
/**
 * 안전망 동기화 주기. Supabase Realtime 은 전달을 보장하지 않는다 —
 * 소켓이 멀쩡히 연결된 채로 메시지 하나가 조용히 빠질 수 있고, 그러면 재연결 전까지 안 보인다.
 * 실서버 E2E 에서 10건 중 1건이 2초 안에 오지 않은 적이 있어서 추가했다.
 */
const SAFETY_SYNC_MS = 90_000;
/** "보고 있음" 신호 간격 — 서버는 45초 동안 보고 있는 것으로 친다 (Phase 28 · 36). 떠날 때는 곧바로 알린다 */
const VIEW_PING_MS = 20_000;

/**
 * 대화방 하나의 상태 전부.
 *
 * 화면은 이 클래스의 $state 만 읽는다. 실시간 세부는 transport 에 갇혀 있다.
 *
 * 핵심 불변식:
 *  1. upsert() 가 유일한 진입점 — 낙관적 행 / insert 응답 / realtime 에코가 전부 여기로 온다.
 *     realtime 에코가 insert 응답보다 먼저 오는 일이 흔하므로 도착 순서에 무관해야 한다.
 *  2. 구독을 먼저 붙이고 그 다음에 조회한다. 반대로 하면 그 사이의 메시지가 영원히 사라진다.
 *  3. SUBSCRIBED 는 재연결마다 다시 온다 — 갭 메우기를 그 콜백 안에서 한다.
 */
export class ChatRoom {
	snap = $state<RoomSnap | null>(null);
	partnerTypingUntil = $state(0);
	partnerHere = $state(false);
	connected = $state(false);
	hasOlder = $state(false);
	loadingOlder = $state(false);
	#historyStarted = false;
	#historyFloor = Infinity;
	/** serverNow - clientNow (ms). 모든 서버 응답의 server_now 로 갱신. */
	skew = $state(0);
	/** 메시지 id → 자리별 공감 { 1?: 'heart', 2?: 'laugh' } */
	reactions = $state<Record<number, Partial<Record<1 | 2, ReactionKey>>>>({});

	#t: ChatTransport;
	#messages: MessageLedger;
	/** 조회가 끝난 메시지까지만 전진한다. 실시간 도착은 과거 갭을 메웠다는 증거가 아니다. */
	#fetchedId = 0;
	#fetching: Promise<void> | null = null;
	#retry = 0;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#tailTimer: ReturnType<typeof setTimeout> | null = null;
	#hiddenAt = 0;
	#lastTypingSent = 0;
	#disposed = false;
	#opening: Promise<void> | null = null;
	#opened = false;
	#onVisibility = () => this.#visibility();
	#onOnline = () => this.#reconnectNow();

	#safetyTimer: ReturnType<typeof setInterval> | null = null;
	#safetyMs: number;

	constructor(
		readonly roomId: string,
		transport: ChatTransport = new SupabaseTransport(),
		opts: { safetySyncMs?: number } = {}
	) {
		this.#t = transport;
		this.#safetyMs = opts.safetySyncMs ?? SAFETY_SYNC_MS;
		this.#messages = new MessageLedger(roomId, () => this.seat, () => this.serverNow());
	}

	get msgs() {
		return this.#messages.rows;
	}

	get seat() {
		return this.snap?.my_seat ?? 1;
	}

	async loadOlder() {
		if (!this.hasOlder || this.loadingOlder || !this.#t.fetchBefore || this.#disposed) return false;
		this.loadingOlder = true;
		try {
			const rows = await this.#t.fetchBefore(this.roomId, this.#historyFloor, 200);
			if (this.#disposed) return false;
			this.#messages.merge(rows, 'sent');
			for (const row of rows) this.#historyFloor = Math.min(this.#historyFloor, row.id);
			this.hasOlder = rows.length === 200;
			return true;
		} catch { return false; }
		finally { this.loadingOlder = false; }
	}
	get closed() {
		return this.snap?.status === 'closed';
	}

	serverNow(clientNow = Date.now()) {
		return clientNow + this.skew;
	}

	// ── 수명 ─────────────────────────────────────────────────────
	open(): Promise<void> {
		if (this.#disposed || this.#opened) return Promise.resolve();
		if (this.#opening) return this.#opening;
		const opening = this.#open();
		this.#opening = opening;
		void opening.finally(() => {
			if (this.#opening === opening) this.#opening = null;
		}).catch(() => {});
		return opening;
	}

	async #open() {
		// 화면을 연 것 자체가 입장 확인. 양쪽이 모두 열어야 10분 타이머가 시작된다.
		const snap = await this.#t.ack(this.roomId);
		if (this.#disposed) {
			// 떠남 신호보다 ack 가 늦게 끝났으면 서버의 "보고 있음"도 다시 끈다.
			void this.#t.view?.(this.roomId, false).catch(() => {});
			return;
		}
		this.#opened = true;
		this.#absorb(snap);
		if (this.closed) return;
		this.#connect();
		document.addEventListener('visibilitychange', this.#onVisibility);
		window.addEventListener('online', this.#onOnline);
		this.#safetyTimer = setInterval(() => {
			// 연결돼 있고 화면을 보고 있을 때만 — 백그라운드는 복귀 시 resync 가 처리한다
			if (this.connected && !this.closed && document.visibilityState === 'visible') void this.#lightSync();
		}, this.#safetyMs);
		// "보고 있음" 신호 — 둘 다 이 화면을 보고 있을 때만 시간이 흐른다 (Phase 28)
		this.#viewTimer = setInterval(() => {
			if (!this.closed && document.visibilityState === 'visible') void this.#view(true);
		}, VIEW_PING_MS);
	}

	#viewTimer: ReturnType<typeof setInterval> | null = null;
	async #view(on: boolean) {
		try {
			const s = await this.#t.view?.(this.roomId, on);
			if (s && !this.#disposed) this.#absorb(s);
		} catch {
			/* Phase 28 전 DB · 네트워크 — 시간은 예전처럼 흐른다 */
		}
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		if (!this.closed) void this.#t.view?.(this.roomId, false).catch(() => {}); // 떠났다 → 상대 쪽 시간도 멈춘다
		this.#stopLiveUpdates();
	}

	/** 종료 · 화면 이탈 때 구독과 타이머를 한 곳에서 정리한다. */
	#stopLiveUpdates() {
		this.#t.disconnect();
		this.connected = false;
		this.partnerHere = false;
		this.partnerTypingUntil = 0;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		if (this.#tailTimer) clearTimeout(this.#tailTimer);
		if (this.#safetyTimer) clearInterval(this.#safetyTimer);
		if (this.#viewTimer) clearInterval(this.#viewTimer);
		if (this.#readTimer) clearTimeout(this.#readTimer);
		this.#reconnectTimer = this.#tailTimer = this.#readTimer = null;
		this.#safetyTimer = this.#viewTimer = null;
		document.removeEventListener('visibilitychange', this.#onVisibility);
		window.removeEventListener('online', this.#onOnline);
	}

	#connect() {
		if (this.#disposed || this.closed) return;
		this.connected = false;
		this.partnerHere = false;
		this.#t.connect(this.roomId, this.seat, {
			onMessage: (row) => this.upsert(row, 'sent'),
			onRoom: (row) => this.#applyRoom(row),
			onVote: (v) => this.#applyVote(v),
			onReaction: (r) => {
				if (this.#disposed || this.closed) return;
				// 내가 방금 바꾸는 중인 공감의 옛 에코는 건너뛴다 (❤️→😂 를 빨리 누르면 ❤️ 에코가 늦게 온다)
				if (r.seat === this.seat && this.#pendingReact.has(r.message_id)) return;
				this.#applyReaction(r);
			},
			onTyping: (s) => {
				if (this.#disposed || this.closed) return;
				if (s !== this.seat) this.partnerTypingUntil = Date.now() + TYPING_SHOW_MS;
			},
			onPresence: (seats) => {
				if (this.#disposed || this.closed) return;
				this.partnerHere = seats.some((s) => s !== this.seat);
			},
			onSubscribed: () => {
				if (this.#disposed || this.closed) return;
				this.connected = true;
				this.#retry = 0;
				void this.resync();
			},
			onDown: () => {
				if (this.#disposed || this.closed) return;
				this.connected = false;
				this.#scheduleReconnect();
			}
		});
	}

	#scheduleReconnect() {
		if (this.#disposed || this.closed || this.#reconnectTimer) return;
		// 지수 백오프 + 지터 (0.5s → 30s)
		const delay = Math.min(30_000, 500 * 2 ** this.#retry++) + Math.random() * 300;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			this.#connect();
		}, delay);
	}

	#reconnectNow() {
		if (this.#disposed || this.closed) return;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = null;
		this.#retry = 0;
		this.#connect();
	}

	/**
	 * iOS Safari 는 백그라운드에서 웹소켓을 조용히 죽이고 status 콜백도 주지 않는다.
	 * 오래 나가 있었으면 채널을 통째로 재생성, 잠깐이면 갭만 메운다.
	 */
	#visibility() {
		if (document.visibilityState !== 'visible') {
			this.#hiddenAt = Date.now();
			if (!this.closed) void this.#view(false); // 앱을 내렸다 → 시간 멈춤
			return;
		}
		if (!this.closed) void this.#view(true);
		this.#scheduleRead();
		if (this.#hiddenAt && Date.now() - this.#hiddenAt > BG_RECREATE_MS) this.#reconnectNow();
		else void this.resync();
	}

	// ── 동기화 ───────────────────────────────────────────────────
	/** 방 상태 + 메시지 갭을 한꺼번에 메운다. 재연결·포그라운드 복귀 때마다 호출. */
	async resync() {
		if (!(await this.#refreshSnapshot())) return;
		try {
			await this.#fetchMessages();
		} catch {
			return; // 조회가 실패하면 커서는 그대로 — 다음 동기화가 같은 갭을 다시 읽는다
		}
		if (this.#disposed || this.closed) return;
		// 끊겨 있던 동안 바뀐 공감도 — 방 전체를 다시 읽어 통째로 맞춘다 (방 하나에 많아야 메시지 수 × 2)
		try {
			const rows = await this.#t.fetchReactions(this.roomId);
			if (this.#disposed || this.closed) return;
			this.#setReactions(rows);
		} catch {
			/* 다음 동기화 때 */
		}

		// ★ 커밋 순서 역전 보정
		// identity 는 id 를 먼저 받은 트랜잭션이 나중에 커밋될 수 있다.
		// id=101 이 먼저 보이고 id=100 이 0.2초 뒤 커밋되면 gt(maxId=101) 로는 100 을 영영 못 본다.
		// upsert 가 멱등이므로 잠시 뒤 최근 50개를 무조건 다시 읽어 병합한다.
		if (this.#disposed || this.closed) return;
		if (this.#tailTimer) clearTimeout(this.#tailTimer);
		this.#tailTimer = setTimeout(async () => {
			this.#tailTimer = null;
			if (this.#disposed || this.closed) return;
			try {
				await this.#fetchRecent();
			} catch {
				/* 다음 동기화 때 다시 읽는다 */
			}
		}, TAIL_SWEEP_DELAY_MS);
	}

	/**
	 * 주기 안전망 — 연결이 멀쩡한 동안 조용히 빠진 것만 메운다: 방 상태(만료·연장) + 새 메시지. 요청 2개.
	 * 공감 전체 목록과 tail sweep(커밋 순서 역전 보정)은 재연결·화면 복귀 때의 resync 에서만 — 그때가 실제로 빠질 수 있는 때다.
	 * (예전엔 30초마다 4개씩, Phase 36 전에는 45초마다 보냈다)
	 */
	async #lightSync() {
		if (!(await this.#refreshSnapshot())) return;
		try {
			await this.#fetchMessages();
		} catch {
			/* 다음 안전망 · 재연결 때 같은 커서로 다시 읽는다 */
		}
	}

	/** 오프라인 동안 만료됐으면 서버가 닫는다. 응답 뒤에도 화면 수명을 확인한다. */
	async #refreshSnapshot() {
		if (this.#disposed || this.closed) return false;
		try {
			this.#absorb(await this.#t.closeIfExpired(this.roomId));
			return !this.#disposed && !this.closed;
		} catch {
			return false; // 다음 안전망 · 재연결 때 다시 확인
		}
	}

	async #fetchRecent(allowClosed = false) {
		const rows = await this.#t.fetchRecent(this.roomId, 50);
		if (this.#disposed || (this.closed && !allowClosed)) return;
		for (const row of rows) this.upsert(row, 'sent');
	}

	/** 중첩 동기화도 같은 조회를 기다린다. 페이지 전부를 받은 뒤에만 커서를 확정한다. */
	#fetchMessages(): Promise<void> {
		if (this.#fetching) return this.#fetching;
		const after = this.#fetchedId;
		const fetch = (async () => {
			const initialWindow = !this.#historyStarted && !!this.snap?.pinned && !!this.#t.fetchBefore;
			const rows = initialWindow ? await this.#t.fetchRecent(this.roomId, 200) : await this.#t.fetchAfter(this.roomId, after);
			if (this.#disposed || this.closed) return;
			this.#historyStarted = true;
			if (initialWindow) this.hasOlder = rows.length === 200;
			this.#messages.merge(rows, 'sent');
			for (const r of rows) {
				this.#historyFloor = Math.min(this.#historyFloor, r.id);
				this.#fetchedId = Math.max(this.#fetchedId, r.id);
			}
		})();
		this.#fetching = fetch;
		void fetch.finally(() => {
			if (this.#fetching === fetch) this.#fetching = null;
		}).catch(() => {});
		return fetch;
	}

	#absorb(s: RoomSnap) {
		if (this.#disposed || (this.closed && s.status !== 'closed')) return;
		this.skew = Date.parse(s.server_now) - Date.now();
		this.snap = s;
		if (s.status === 'closed') this.#stopLiveUpdates();
	}

	#applyRoom(r: RoomRow) {
		if (!this.snap || this.#disposed || this.closed) return;
		const s = this.snap;
		const wasPending = s.status === 'pending';
		if (r.round !== s.round) {
			// 새 라운드 — 이전 표는 의미가 없다
			s.my_vote = null;
			s.partner_vote = null;
		}
		if (wasPending && r.status === 'active') s.partner_joined = true;
		// 새 라운드(힌트 공개 · 고정) · 시간이 멈추거나 다시 흐름 — 행에는 남은 시간 · 힌트가 없으니 스냅샷을 다시 받는다
		// 고정한 대화도 expires_at 이 'infinity' 지만 멈춘 게 아니다 (Phase 29)
		const pinned = !!r.pinned;
		const paused = !pinned && (r.paused_left != null || Number.isNaN(Date.parse(r.expires_at)));
		if (r.round !== s.round || paused || !!s.paused !== paused || pinned !== !!s.pinned) void this.#lightSync();
		s.status = r.status;
		s.round = r.round;
		if (pinned) {
			s.pinned = true;
			s.pin_next = false;
			s.paused = false;
		} else if (!paused) {
			s.expires_at = r.expires_at;
			s.paused = false;
		}
		s.close_reason = r.close_reason;
		s.their_read_id = s.my_seat === 1 ? r.read2 : r.read1;
		if (r.status === 'closed') {
			this.#stopLiveUpdates();
			// 방송된 행에는 "평가할 수 있는지"(can_rate)가 없다 — 닫힌 뒤의 스냅샷을 한 번 받는다.
			// 안 받으면 상대가 끝낸 대화(나감 · 넘김 · 연장 거절)에서 방 안의 매너 평가 칸이 뜨지 않는다. 못 받아도 홈의 평가 창이 다시 묻는다
			void this.#t.snapshot(this.roomId).then((snap) => this.#absorb(snap), () => {});
		}
	}

	#applyVote(v: VoteRow) {
		const s = this.snap;
		if (!s || this.#disposed || this.closed || v.round !== s.round) return;
		if (v.seat === s.my_seat) s.my_vote = v.agree;
		else s.partner_vote = v.agree;
	}

	// ── 타임박스 ─────────────────────────────────────────────────
	voting = $state(false);

	/** hint = 디플로마 · 동아리 · 공통 질문 차례에 연장하면서 적은 내 값. 고정을 묻는 차례면 agree = 고정하기 */
	async vote(agree: boolean, hint: string | null = null): Promise<VoteResult | null> {
		if (!this.snap || this.voting || this.#disposed) return null;
		this.voting = true;
		try {
			const { result, snap } = await this.#t.vote(this.roomId, agree, hint);
			this.#absorb(snap);
			return result;
		} catch {
			return null;
		} finally {
			this.voting = false;
		}
	}

	/** 내가 보낸 메시지 지우기 — 서버가 지우면 바로 화면에도 (상대에게는 실시간 UPDATE 로) */
	async deleteMessage(m: Msg): Promise<'ok' | 'closed' | 'not_found' | null> {
		if (m.id == null) return null;
		try {
			const r = await this.#t.deleteMessage(m.id);
			if (r === 'ok') this.upsert({ client_msg_id: m.client_msg_id, deleted_at: new Date(this.serverNow()).toISOString(), body: '삭제된 메시지입니다' }, 'sent');
			return r;
		} catch {
			return null;
		}
	}

	#checking = false;
	#lastCheck = 0;
	/**
	 * 카운트다운이 0 이 됐을 때 화면이 부른다. 클라는 만료를 "판정"하지 않고 서버에 "질문"한다.
	 * 서버가 아직 아니라고 하면 skew 가 재동기화되어 카운트다운이 되살아난다.
	 */
	async checkExpiry() {
		if (this.#checking || this.closed || this.#disposed || Date.now() - this.#lastCheck < 3000) return;
		this.#checking = true;
		this.#lastCheck = Date.now();
		try {
			this.#absorb(await this.#t.closeIfExpired(this.roomId));
		} catch {
			/* 다음 틱에 다시 */
		} finally {
			this.#checking = false;
		}
	}

	/** 내가 끝냈는지 — 종료 문구를 다르게 보여주기 위해 (상대에게는 사유를 숨긴다) */
	endedByMe = $state(false);
	reported = $state(false);

	async report(reason: ReportReason, note: string): Promise<boolean> {
		try {
			const { snap } = await this.#t.report(this.roomId, reason, note);
			this.endedByMe = true;
			this.reported = true;
			this.#absorb(snap);
			return true;
		} catch {
			return false;
		}
	}

	async block(): Promise<boolean> {
		try {
			const snap = await this.#t.block(this.roomId);
			this.endedByMe = true;
			this.#absorb(snap);
			return true;
		} catch {
			return false;
		}
	}

	async leave(skip: boolean): Promise<boolean> {
		try {
			const snap = await this.#t.leave(this.roomId, skip);
			this.endedByMe = true;
			this.#absorb(snap);
			return true;
		} catch {
			return false;
		}
	}

	// ── 메시지 ───────────────────────────────────────────────────
	/** 유일한 진입점. 멱등 — 같은 행이 몇 번 와도 결과가 같다. */
	upsert(row: MessageUpdate, state: Msg['state']) {
		if (!this.#disposed) this.#messages.upsert(row, state);
	}

	/**
	 * replyTo = 답장 대상 메시지 id (없으면 그냥 메시지).
	 * 검열 1단에 막히면 화면에서 지우고 이유 코드를 돌려준다 (화면이 입력창에 글을 되돌려 놓는다).
	 */
	async send(raw: string, replyTo: number | null = null): Promise<{ blocked: string } | null> {
		const body = raw.trim();
		if (!body || !this.snap || this.closed || this.#disposed) return null;
		const cid = crypto.randomUUID();
		this.upsert({ client_msg_id: cid, sender_seat: this.seat, body, reply_to: replyTo }, 'sending');
		return this.#flush(cid, body, replyTo);
	}

	/** 재전송 — 같은 client_msg_id 로 보내므로 unique index 가 중복을 막는다 */
	async retry(m: Msg) {
		if (m.id != null || m.state === 'sending' || this.closed || this.#disposed) return null;
		m.state = 'sending';
		return this.#flush(m.client_msg_id, m.body, m.reply_to ?? null);
	}

	async #flush(cid: string, body: string, replyTo: number | null): Promise<{ blocked: string } | null> {
		const res = await this.#t.send(this.roomId, this.seat, body, cid, replyTo);
		if (this.#disposed) return null;
		if (res.ok) {
			this.upsert(res.row, 'sent');
			return null;
		}
		if (res.reason === 'blocked') {
			// 서버에 남지 않았다 — "실패(다시 보내기)"로 두면 몇 번을 눌러도 똑같이 막히므로 아예 지운다
			this.#messages.remove(cid);
			return { blocked: res.code };
		}
		if (res.reason === 'duplicate') {
			// 타임아웃 후 재시도였는데 서버엔 이미 들어가 있다 → 그 행을 읽어 확정
			try {
				// 기다리는 사이 방이 종료돼도 이미 저장된 전송 결과는 확정한다.
				await this.#fetchRecent(true);
			} catch {
				/* 읽기가 실패하면 다시 보내기 상태로 남긴다 */
			}
			if (this.#disposed) return null;
			this.#messages.fail(cid);
			return null;
		}
		this.#messages.fail(cid, res.reason === 'rate_limited' ? 'rate_limited' : 'failed');
		if (res.reason === 'closed') void this.resync(); // 만료/종료 — 스냅샷으로 확인
		return null;
	}

	// ── 공감 ─────────────────────────────────────────────────────
	/** 보내는 중인 내 공감 (메시지 id → 바라는 값). 그 사이 온 옛 목록이 화면을 되돌리지 않게. */
	#pendingReact = new Map<number, ReactionKey | null>();

	#applyReaction(r: Pick<ReactionRow, 'message_id' | 'seat' | 'emoji'>) {
		const cur = { ...this.reactions[r.message_id] };
		if (r.emoji) cur[r.seat] = r.emoji;
		else delete cur[r.seat];
		this.reactions[r.message_id] = cur;
	}

	#setReactions(rows: ReactionRow[]) {
		const next: typeof this.reactions = {};
		for (const r of rows) if (r.emoji) (next[r.message_id] ??= {})[r.seat] = r.emoji;
		this.reactions = next;
		for (const [id, emoji] of this.#pendingReact) this.#applyReaction({ message_id: id, seat: this.seat, emoji });
	}

	/** 내 공감을 바꾼다 (null = 취소). 화면에는 바로 반영하고, 서버가 거절하면 되돌린다. */
	async react(messageId: number, emoji: ReactionKey | null): Promise<ReactResult> {
		if (this.closed || this.#disposed) return 'closed';
		const seat = this.seat;
		const before = this.reactions[messageId]?.[seat] ?? null;
		if (before === emoji) return 'ok';
		this.#pendingReact.set(messageId, emoji);
		this.#applyReaction({ message_id: messageId, seat, emoji });
		const res = await this.#t.react(this.roomId, messageId, emoji).catch((): ReactResult => 'network');
		if (this.#pendingReact.get(messageId) === emoji) this.#pendingReact.delete(messageId);
		if (res !== 'ok' && (this.reactions[messageId]?.[seat] ?? null) === emoji) {
			this.#applyReaction({ message_id: messageId, seat, emoji: before });
			if (res === 'closed') void this.resync(); // 시간이 끝났다 — 스냅샷으로 확인
		}
		return res;
	}

	/** 같은 공감을 다시 누르면 취소, 다른 걸 누르면 바꾸기 */
	toggleReaction(messageId: number, emoji: ReactionKey) {
		return this.react(messageId, this.reactions[messageId]?.[this.seat] === emoji ? null : emoji);
	}

	// ── 매너 온도 평가 (Phase 30) ────────────────────────────────
	/** 끝났거나 고정한 대화에서 상대를 평가 — 됐으면(또는 이미 했으면) 화면에서 평가 칸을 거둔다 */
	async rate(score: Score, reasons: Reason[]): Promise<RateStatus | null> {
		try {
			const r = await this.#t.rate(this.roomId, score, reasons);
			if (this.snap && (r === 'ok' || r === 'already' || r === 'not_eligible')) {
				this.snap.rated = r !== 'not_eligible';
				this.snap.can_rate = false;
			}
			return r;
		} catch {
			return null;
		}
	}

	// ── 부가 ─────────────────────────────────────────────────────
	/** 상대 기본 정보 — 프로필 시트를 열 때 한 번 불러온다 */
	async partnerProfile(): Promise<PartnerProfile | null> {
		try {
			return await this.#t.partnerProfile(this.roomId);
		} catch {
			return null;
		}
	}

	onInput() {
		if (this.#disposed || this.closed) return;
		const now = Date.now();
		if (now - this.#lastTypingSent < TYPING_SEND_EVERY_MS) return;
		this.#lastTypingSent = now;
		this.#t.typing(this.seat);
	}

	#readSent = 0;
	#readTarget = 0;
	#reading = false;
	/** 잇달아 실패한 횟수 — 간격을 벌리고(2 · 2 · 4 · 8 · 16초) 다섯 번이면 멈춘다. 서버가 계속 거절하는데 2초마다 묻지 않게 */
	#readFails = 0;
	#readTimer: ReturnType<typeof setTimeout> | null = null;
	/** 스크롤이 맨 아래일 때만 호출. 2초 스로틀 — rooms UPDATE 브로드캐스트 폭증 방지. */
	markRead() {
		if (this.#disposed || this.closed) return;
		// 기다리는 사이 위로 스크롤해도, 그 뒤에 온 아직 안 본 메시지를 읽음 처리하지 않는다.
		this.#readTarget = Math.max(this.#readTarget, this.#messages.maxId);
		this.#scheduleRead();
	}

	/** retry = 실패한 뒤 저절로 다시 — 다섯 번 실패하면 그만둔다 (그 뒤로는 새 메시지를 보거나 화면에 돌아올 때 한 번씩만) */
	#scheduleRead(retry = false) {
		if (this.#disposed || this.closed || this.#reading || this.#readTimer || this.#readTarget <= this.#readSent) return;
		if (retry && this.#readFails >= 5) return;
		this.#readTimer = setTimeout(async () => {
			this.#readTimer = null;
			if (this.#disposed || this.closed || document.visibilityState !== 'visible') return;
			const last = this.#readTarget;
			this.#reading = true;
			try {
				await this.#t.markRead(this.roomId, last);
				this.#readSent = Math.max(this.#readSent, last);
				this.#readFails = 0;
			} catch {
				/* 같은 읽음 목표를 다시 보낸다 — 실패를 성공으로 기억하지 않는다 */
				this.#readFails++;
			} finally {
				this.#reading = false;
				this.#scheduleRead(true);
			}
		}, Math.min(30_000, 2000 * 2 ** Math.max(0, this.#readFails - 1)));
	}
}

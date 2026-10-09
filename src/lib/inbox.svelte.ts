import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { S } from './state.svelte';
import { whileVisible } from './visible';
import { accountIsCurrent, accountToken, currentAccountId, onAccountChange } from './accountScope';

/** my_rooms() 의 한 줄. ★ uuid 는 room_id 뿐. */
export type InboxRoom = {
	room_id: string;
	status: 'pending' | 'active' | 'closed';
	my_seat: 1 | 2;
	partner_alias: string;
	expires_at: string;
	round: number;
	/** 한쪽이라도 대화 화면을 안 봐서 시간이 멈춤 (Phase 28) — 남은 시간 = expires_at - server_now */
	paused?: boolean;
	/** 둘 다 고정한 대화 (Phase 29) — 시간 제한 없음(expires_at = infinity), 목록 맨 위, 동시 대화 개수에 안 셈 */
	pinned?: boolean;
	/** 내가 이 방 화면을 한 번이라도 열었는지 — 아니면 "새 대화" */
	joined: boolean;
	partner_online: boolean;
	last_body: string | null;
	last_seat: 0 | 1 | 2 | null;
	last_at: string | null;
	unread: number;
};

const POLL_MS = 60_000;
const DEBOUNCE_MS = 300;
const MIN_REFRESH_MS = 3000;

/**
 * 대화 목록 (인스타 DM 받은편지함).
 *
 * 실시간: 내 목록 채널(inbox:<내 id>, 비공개) 하나 — DB 가 내 방의 새 메시지 · 방 상태 변화 · 새로 잡힌 대화를 알린다 (Phase 55).
 *   "바뀌었다"는 신호로만 쓴다 — 목록은 언제나 my_rooms() 한 번으로 다시 그린다.
 *   열린 대화가 있을 때만 듣는다 — 대화가 없는 학생까지 Realtime 연결을 잡지 않게 (동시 연결 한도).
 *   (미리보기·안 읽은 수·온라인 표시를 한 곳에서 계산하기 위해)
 * 안전망: 60초마다 다시 읽는다. Realtime 은 전달을 보장하지 않고, 상대 온라인 표시는 이벤트가 없다.
 *
 * 앱 전체가 하나를 같이 쓴다 (INBOX, Phase 35) — 앱 틀((app)/+layout)이 켜 두고, 홈은 기억해 둔 목록을 바로 그린다.
 * 새 메시지 · 새 대화가 오면 onNew 로 알린다 → 앱 안 알림 띠 (다른 화면을 보고 있을 때).
 */
class Inbox {
	rooms = $state<InboxRoom[]>([]);
	loaded = $state(false);
	/** 마지막으로 불러오기에 실패했다 — 아직 한 번도 못 불러왔으면 홈이 "다시 시도"를 보인다 (UX G4: 오류를 빈 화면으로 두지 않는다) */
	failed = $state(false);
	/** serverNow - clientNow (ms) — 남은 시간 표시용 */
	skew = $state(0);
	/** 마지막으로 불러온 서버 시각 (ms) — 멈춘 방의 남은 시간 계산용 */
	serverAt = $state(0);
	/** 평가 대상이 바뀌었을 때만 증가한다. 메시지·읽음 폴링은 평가 큐를 다시 열지 않는다. */
	roomRevision = $state(0);
	#signature = '';
	#request = 0;
	#flight: Promise<void> | null = null;
	#lastLoad = 0;

	#ch: RealtimeChannel | null = null;
	#topic = '';
	#stopPoll: (() => void) | null = null;
	#debounce: ReturnType<typeof setTimeout> | null = null;
	#dirty = false;
	#stopped = false;
	#running = 0;
	/** 방마다 지난번 안 읽은 수 — 늘었으면 새 메시지 (처음 불러올 때는 알리지 않는다) */
	#seen: Map<string, number> | null = null;
	/** 새 메시지 · 새로 연결된 대화 */
	onNew: ((r: InboxRoom) => void) | null = null;

	constructor() {
		onAccountChange(() => this.#reset());
	}

	#reset() {
		this.#request++;
		this.#flight = null;
		this.#dirty = false;
		this.#lastLoad = 0;
		this.rooms = [];
		this.loaded = false;
		this.failed = false;
		this.skew = this.serverAt = 0;
		this.#seen = null;
		this.#signature = '';
		this.roomRevision++;
		if (this.#debounce) clearTimeout(this.#debounce);
		this.#debounce = null;
		this.#unsubscribe();
	}

	start() {
		if (this.#running++ > 0) return; // 이미 켜져 있다
		this.#stopped = false;
		void this.load();
		this.#stopPoll = whileVisible(() => void this.load(), POLL_MS);
	}

	stop() {
		if (--this.#running > 0) return;
		this.#running = 0;
		this.#stopped = true;
		this.#flight = null;
		this.#dirty = false;
		this.#request++;
		this.#stopPoll?.();
		this.#stopPoll = null;
		if (this.#debounce) clearTimeout(this.#debounce);
		this.#debounce = null;
		this.#unsubscribe();
	}

	async load() {
		if (this.#flight) return this.#flight;
		const work = this.#read();
		this.#flight = work;
		try { await work; } finally {
			if (this.#flight === work) {
				this.#flight = null;
				if (this.#dirty && !this.#stopped) { this.#dirty = false; this.#soon(); }
			}
		}
	}

	async #read() {
		if (!currentAccountId()) return;
		this.#lastLoad = Date.now();
		const token = accountToken();
		const request = ++this.#request;
		const { data, error } = await supabase.rpc('my_rooms');
		if (!accountIsCurrent(token) || request !== this.#request || this.#stopped) return;
		if (error || !data) {
			this.failed = true;
			return;
		}
		this.failed = false;
		const res = data as { rooms: InboxRoom[]; server_now: string };
		this.skew = Date.parse(res.server_now) - Date.now();
		this.serverAt = Date.parse(res.server_now);
		this.#announce(res.rooms);
		const signature = JSON.stringify(res.rooms.map((r) => [r.room_id, r.status, !!r.pinned]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
		if (signature !== this.#signature) {
			this.#signature = signature;
			this.roomRevision++;
		}
		this.rooms = res.rooms;
		this.loaded = true;
		this.#listen(res.rooms.length > 0);
	}

	#announce(rooms: InboxRoom[]) {
		const prev = this.#seen;
		this.#seen = new Map(rooms.map((r) => [r.room_id, r.unread]));
		if (!prev || !this.onNew) return;
		for (const r of rooms) {
			const was = prev.get(r.room_id);
			const fresh = was === undefined ? !r.joined : r.unread > was && r.last_seat !== r.my_seat && r.last_seat !== 0;
			if (fresh) this.onNew(r);
		}
	}

	#soon() {
		if (this.#debounce) return;
		this.#debounce = setTimeout(() => {
			this.#debounce = null;
			if (this.#flight) this.#dirty = true;
			else void this.load();
		}, Math.max(DEBOUNCE_MS, this.#lastLoad + MIN_REFRESH_MS - Date.now()));
	}

	/** 방이 늘고 줄어도 채널은 하나 그대로 — 예전처럼 방 목록이 바뀔 때마다 다시 붙이지 않는다 */
	#listen(on: boolean) {
		const uid = S.session?.user.id;
		const topic = on && uid ? `inbox:${uid}` : '';
		if (topic === this.#topic) return;
		this.#unsubscribe();
		if (!topic) return;
		this.#topic = topic;
		const token = accountToken();
		this.#ch = supabase
			.channel(topic, { config: { private: true } })
			.on('broadcast', { event: 'changed' }, () => { if (accountIsCurrent(token)) this.#soon(); })
			.subscribe();
	}

	#unsubscribe() {
		if (this.#ch) void supabase.removeChannel(this.#ch);
		this.#ch = null;
		this.#topic = '';
	}
}

/** 앱 전체가 같이 쓰는 대화 목록 */
export const INBOX = new Inbox();

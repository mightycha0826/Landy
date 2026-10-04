import { match } from './haptics';
import { supabase } from './supabase';
import { PollSeeker } from './pollSeeker.svelte';

type MatchRes =
	| { status: 'matched'; room_id: string }
	| { status: 'waiting'; reason: 'empty' | 'filtered'; poll_ms?: number }
	| { status: 'busy' | 'retry' | 'cooldown'; retry_after_ms?: number }
	| { status: 'not_eligible' }
	| { status: 'full'; max: number }
	| { status: 'service_closed'; notice?: string };

/**
 * 기다린 시간만큼 천천히 묻는다 — 처음 30초는 서버가 정한 간격(기본 4초), 그 뒤 8초, 2분 넘으면 10초.
 * 새 사람이 들어오면 그 사람의 첫 요청이 풀에 있는 나를 바로 잡아가므로, 내가 천천히 물어도 늦어지는 건
 * "잡혔다는 걸 알아채는 시간"뿐이다. ★ 서버 풀에서 빠지는 시간(seek_ttl_sec 기본 15초)보다 짧게 둔다.
 * 기다리는 사람 한 명당 1분에 15번 → 6~7번.
 */
export function waitingPollMs(base: number, waitedMs: number): number {
	if (waitedMs > 120_000) return Math.max(base, 10_000);
	if (waitedMs > 30_000) return Math.max(base, 8_000);
	return base;
}

/**
 * 상대 찾기.
 *
 * request_match() 한 번이 '나 아직 찾는 중' 갱신 + 매칭 시도 + 누가 나를 이미 잡아갔는지 확인을 모두 한다.
 * 백그라운드에서는 부르지 않으므로(PollSeeker) seek_ttl_sec 안에 서버 풀에서 자동으로 빠진다.
 */
export class Seeker extends PollSeeker<MatchRes> {
	#stopping: Promise<void> | null = null;
	#epoch = 0;
	constructor(
		private onMatched: (roomId: string) => void,
		onStopped: (message: string) => void
	) {
		super(onStopped);
	}

	/** 계정이 바뀐 뒤 새 계정의 대기를 취소하는 RPC를 보내지 않는다. 이전 풀 항목은 TTL로 정리된다. */
	reset() {
		this.#epoch++;
		super.cancel();
		this.#stopping = null;
	}

	/** 그만 찾기 — 서로가 서로를 찾는 풀이라 서버에서도 바로 빠진다 */
	override cancel() {
		if (!this.seeking) return;
		this.#epoch++;
		super.cancel();
		// PostgrestBuilder는 thenable이다. void만 붙이면 fetch를 시작하지 않는다.
		this.#stopping = (async () => {
			try { await supabase.rpc('stop_seeking'); } catch { /* 네트워크 장애 시 기존 TTL로 정리 */ }
		})();
	}

	protected async request() {
		const epoch = this.#epoch;
		// 이전 취소가 새 찾기 뒤에 도착해 새 대기를 지우지 않게 순서를 지킨다.
		await this.#stopping;
		if (!this.seeking || epoch !== this.#epoch) return null;
		const { data, error } = await supabase.rpc('request_match');
		return error ? null : (data as MatchRes);
	}

	protected handle(res: MatchRes | null) {
		if (!res) return this.schedule(3000, 1000); // 네트워크 오류 — 조금 쉬었다가
		switch (res.status) {
			case 'matched':
				this.halt();
				match();
				this.onMatched(res.room_id);
				return;
			case 'waiting':
				this.reason = res.reason;
				return this.schedule(waitingPollMs(res.poll_ms ?? 4000, Date.now() - this.since), 600);
			case 'busy':
			case 'retry':
				// 다른 사람의 매칭이 락을 잡고 있다 — 곧바로 다시
				return this.schedule(res.retry_after_ms ?? 300, 400);
			case 'cooldown':
				// 넘기기를 너무 빨리 반복했다 — 잠깐 쉬었다가. 그동안에도 서버 풀에는 남아 있어 잡힐 수는 있다.
				this.reason = 'cooldown';
				return this.schedule(Math.min(res.retry_after_ms ?? 5000, 4000), 400);
			case 'full':
				// 동시 대화 상한 — 하나를 끝내야 새로 찾을 수 있다
				return this.stop(`대화는 동시에 ${res.max}개까지 할 수 있어요`);
			case 'not_eligible':
				return this.stop('지금은 대화를 시작할 수 없는 계정입니다');
			case 'service_closed':
				return this.stop(res.notice || '지금은 열려 있지 않아요');
		}
	}
}

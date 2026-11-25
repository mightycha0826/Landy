import type { BadgeLite } from '../achievements';

/** 서버의 messages 행. ★ 식별 컬럼이 없다 — sender_seat(0=시스템, 1, 2)뿐. */
export type MsgRow = {
	id: number;
	room_id: string;
	sender_seat: 0 | 1 | 2;
	body: string;
	client_msg_id: string;
	created_at: string;
	/** 답장 대상 (같은 방의 메시지 id) — Phase 18. 예전 행·가짜 전송에서는 없을 수 있다 */
	reply_to?: number | null;
	/** 보낸 사람이 지웠다 (Phase 28) — body 는 "삭제된 메시지입니다" */
	deleted_at?: string | null;
};

export type MsgState = 'sending' | 'sent' | 'failed' | 'rate_limited';

/** 화면이 들고 있는 메시지. 서버 확정 전에는 id 가 null. */
export type Msg = Omit<MsgRow, 'id'> & { id: number | null; state: MsgState };

/** rooms 행 (Realtime UPDATE 로 오는 형태). uuid 는 room id 뿐. */
export type RoomRow = {
	id: string;
	status: 'pending' | 'active' | 'closed';
	round: number;
	expires_at: string;
	close_reason: string | null;
	alias1: string;
	alias2: string;
	read1: number | null;
	read2: number | null;
	/** 멈춰 있으면 남은 시간 (Phase 28) — 그동안 expires_at 은 'infinity' */
	paused_left?: string | null;
	/** 둘 다 고정한 대화 (Phase 29) — 시간 제한 없음, expires_at 은 'infinity' */
	pinned?: boolean;
};

/**
 * 연장할 때마다 서로 하나씩 공개되는 힌트 — Phase 103 부터 각자 고른다: 학년 · 디플로마 · 동아리(한 번씩) · 랜덤 질문(매번).
 * 질문은 label 이 그 질문 자체. q1 · q2 는 Phase 29 의 정해진 순서 때 질문, surname 은 Phase 28 때 — 예전 대화에만 있다
 */
export type Hint = { kind: 'grade' | 'surname' | 'club' | 'diploma' | 'question' | 'q1' | 'q2'; label: string; value: string };
/** 연장할 때 고를 수 있는 공개 (Phase 103) */
export type HintKind = 'grade' | 'diploma' | 'club' | 'question';
/** value = 학년 (명단 값, 적지 않는다), question = 랜덤 질문이면 이번 라운드의 질문 */
export type HintOption = { kind: HintKind; label: string; typed: boolean; value?: string; question?: string };

/** room_snapshot() RPC 응답 — 클라가 방에 대해 아는 모든 것. */
export type RoomSnap = {
	room_id: string;
	status: RoomRow['status'];
	my_seat: 1 | 2;
	my_alias: string;
	partner_alias: string;
	expires_at: string;
	round: number;
	/** 0 = 무제한 */
	max_rounds: number;
	extend_minutes: number;
	vote_window_sec: number;
	/** 현재 라운드의 내 표 / 상대 표 (null = 아직 안 누름) */
	my_vote: boolean | null;
	partner_vote: boolean | null;
	/** pending 방에서 상대가 화면을 열었는지 */
	partner_joined: boolean;
	/** 상대가 앱을 켜 두었는지 (방 화면이 아니어도) */
	partner_online: boolean;
	their_read_id: number | null;
	close_reason: string | null;
	server_now: string;
	/** 한쪽이라도 대화 화면을 안 보고 있어 시간이 멈춤 (Phase 28 전 DB 면 없다) — expires_at - server_now = 남은 시간 */
	paused?: boolean;
	/** 둘 다 고정한 대화 — 시간 제한이 없다 (expires_at 은 'infinity'). Phase 29 전 DB 면 없다 */
	pinned?: boolean;
	/** 이번 투표가 연장이 아니라 "이 채팅을 고정하시겠습니까?" (동아리까지 연장한 다음 차례) */
	pin_next?: boolean;
	/** 지금까지 공개된 상대 · 내 힌트, 다음 연장 때 공개될 힌트 (typed = 연장할 때 직접 적는다) */
	partner_hints?: Hint[];
	my_hints?: Hint[];
	/** 끝났거나 고정한 대화에서 상대를 평가할 수 있는지 · 이미 했는지 (Phase 30 — 매너 온도) */
	can_rate?: boolean;
	rated?: boolean;
	next_hint?: { kind: Hint['kind']; label: string; typed: boolean } | null;
	/** 이번 연장 때 고를 수 있는 공개 (Phase 103) — 공개 차례가 아니면 null */
	next_options?: HintOption[] | null;
	/** 시간이 다 된 뒤에도 이만큼(초) 연장을 고를 수 있다 — 그동안 대화는 막히고 "연장할까요?" 화면 (Phase 103) */
	vote_grace_sec?: number;
};

/** extension_votes 행 — seat 만 있고 사용자 식별자는 없다 */
export type VoteRow = { room_id: string; round: number; seat: 1 | 2; agree: boolean };

export type VoteResult = 'waiting' | 'extended' | 'declined' | 'expired' | 'closed' | 'too_early' | 'max_rounds' | 'need_hint' | 'pinned';

/** 대화 상대의 기본 정보 — partner_profile(room) 응답. ★ uuid·성별·선호는 없다. */
export type PartnerProfile = {
	nickname: string;
	bio: string;
	interests: string[];
	mbti: string | null;
	online: boolean;
	/** 매너 온도 (Phase 30 전 DB 면 없다 → 40.0) */
	manner_temp?: number;
	/** 대표 업적 3개 · 업적 수 (Phase 31) */
	badges?: BadgeLite[];
	badge_count?: number;
};

export type ReportReason =
	| 'harassment'
	| 'sexual'
	| 'spam'
	| 'personal_info'
	| 'hate'
	| 'impersonation'
	| 'other';

export type SendResult =
	| { ok: true; row: MsgRow }
	| { ok: false; reason: 'duplicate' | 'closed' | 'rate_limited' | 'network' | 'other'; message?: string }
	/** 검열 1단(규칙 필터)에 막힘 — code = personal_info | blocked_word. 서버에 남지 않는다 */
	| { ok: false; reason: 'blocked'; code: string };

/**
 * 메시지 공감 — 서버 check 제약(message_reactions.emoji)과 같은 값. 이 순서대로 고르기 줄에 보인다.
 * 화나요·싫어요는 일부러 없다: 모르는 사람과의 대화에서 부정 반응은 공감보다 상처가 되기 쉽다.
 */
export const REACTIONS = [
	{ k: 'heart', e: '❤️', label: '하트' },
	{ k: 'laugh', e: '😂', label: '웃겨요' },
	{ k: 'wow', e: '😮', label: '놀라워요' },
	{ k: 'sad', e: '😢', label: '슬퍼요' },
	{ k: 'like', e: '👍', label: '좋아요' },
	{ k: 'fire', e: '🔥', label: '최고예요' }
] as const;
export type ReactionKey = (typeof REACTIONS)[number]['k'];
export const REACTION_EMOJI = Object.fromEntries(REACTIONS.map((r) => [r.k, r.e])) as Record<ReactionKey, string>;

/** message_reactions 행 — ★ 자리(seat)만, 사용자 식별자 없음. emoji = null 이면 취소된 것 */
export type ReactionRow = { message_id: number; room_id: string; seat: 1 | 2; emoji: ReactionKey | null };

export type ReactResult = 'ok' | 'closed' | 'not_found' | 'system' | 'bad_emoji' | 'network';

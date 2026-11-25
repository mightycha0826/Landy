import type {
	HintKind,
	MsgRow,
	PartnerProfile,
	ReactResult,
	ReactionKey,
	ReactionRow,
	ReportReason,
	RoomRow,
	RoomSnap,
	SendResult,
	VoteResult,
	VoteRow
} from './types';
import type { Reason, RateStatus, Score } from '../manner';

export type TransportHandlers = {
	onMessage(row: MsgRow): void;
	onRoom(row: RoomRow): void;
	onVote(row: VoteRow): void;
	/** 공감이 달리거나 바뀌거나 취소됐다 (emoji = null) */
	onReaction(row: ReactionRow): void;
	onTyping(seat: number): void;
	onPresence(seats: number[]): void;
	/** 구독이 (재)성립했다. ★ 재연결마다 다시 호출된다 — 여기서 갭을 메운다. */
	onSubscribed(): void;
	/** 연결이 끊겼다. 재연결은 호출자가 결정한다. */
	onDown(reason: string): void;
};

/**
 * 실시간 전송 계층.
 *
 * 지금은 SupabaseTransport(DB 방송 · 비공개 채널, Phase 55) 하나지만, 동시 수백 명을 넘기면
 * Phase 7 에서 DurableObjectTransport 로 교체한다. ChatRoom 과 화면은 이 인터페이스만 알므로
 * 교체해도 한 줄도 바뀌지 않는다.
 */
export interface ChatTransport {
	connect(roomId: string, seat: 1 | 2, h: TransportHandlers): void;
	disconnect(): void;
	/** replyTo = 답장 대상 메시지 id (같은 방) */
	send(roomId: string, seat: 1 | 2, body: string, clientMsgId: string, replyTo?: number | null): Promise<SendResult>;
	/** id > afterId 인 메시지를 오름차순으로 전부. 일부 페이지라도 실패하면 예외를 던진다. */
	fetchAfter(roomId: string, afterId: number): Promise<MsgRow[]>;
	/** 가장 최근 n 개 (커밋 순서 역전 보정용) */
	fetchRecent(roomId: string, n: number): Promise<MsgRow[]>;
	fetchBefore?(roomId: string, beforeId: number, n: number): Promise<MsgRow[]>;
	snapshot(roomId: string): Promise<RoomSnap>;
	/** 입장 확인 — 양쪽이 모두 부르면 pending → active, 10분 타이머 시작 */
	ack(roomId: string): Promise<RoomSnap>;
	/** 만료됐으면 닫고, 언제나 최신 스냅샷을 돌려준다 (서버 시계 기준 판정) */
	closeIfExpired(roomId: string): Promise<RoomSnap>;
	/** kind = 연장하면 공개할 것 (Phase 103), hint = 디플로마 · 동아리 · 질문 답처럼 내가 적은 값 */
	vote(roomId: string, agree: boolean, hint?: string | null, kind?: HintKind | null): Promise<{ result: VoteResult; snap: RoomSnap }>;
	/** 대화 화면을 보고 있다(on) / 떠났다 — 둘 다 볼 때만 시간이 흐른다 (Phase 28) */
	view(roomId: string, on: boolean): Promise<RoomSnap>;
	/** 내가 보낸 메시지 지우기 — 둘 다에게 "삭제된 메시지입니다" */
	deleteMessage(messageId: number): Promise<'ok' | 'closed' | 'not_found'>;
	leave(roomId: string, skip: boolean): Promise<RoomSnap>;
	/** 신고 — 대화 사본 저장 + 자동 차단 + 방 종료. 닫힌 방에서도 동작한다. */
	report(roomId: string, reason: ReportReason, note: string): Promise<{ status: 'ok' | 'already'; snap: RoomSnap }>;
	block(roomId: string): Promise<RoomSnap>;
	/** 서버가 읽음을 저장한 뒤 완료한다. 실패하면 예외를 던져 같은 목표를 재시도하게 한다. */
	markRead(roomId: string, lastId: number): Promise<void>;
	/** 메시지에 공감 — emoji = null 이면 취소. 대화 중에만 된다. */
	react(roomId: string, messageId: number, emoji: ReactionKey | null): Promise<ReactResult>;
	/** 이 방의 공감 전부 (취소된 것 제외) — 재연결·갭 메우기용 */
	fetchReactions(roomId: string): Promise<ReactionRow[]>;
	/** 상대 평가 (Phase 30) — 끝났거나 고정한 대화에서 한 번 */
	rate(roomId: string, score: Score, reasons: Reason[]): Promise<RateStatus>;
	/** 대화 상대의 기본 정보 (같은 방 멤버만) */
	partnerProfile(roomId: string): Promise<PartnerProfile>;
	typing(seat: 1 | 2): void;
}

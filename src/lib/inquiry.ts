import { rpc } from './rpc';
import { isDeletionInquiry } from './accountDeletion';

/**
 * 운영진에게 문의하기 (Phase 37) — 설정 › 운영진에게 문의하기.
 * 답변은 운영진이 적으면 개인 공지로도 오고(하트 · 공지 · 푸시), 문의 화면에도 남는다.
 * 화면을 열 때 한 번만 읽는다 (주기 확인 없음 — 답이 오면 알림이 알려 준다).
 */
export const INQUIRY_KINDS = [
	{ id: 'use', label: '이용 방법' },
	{ id: 'safety', label: '신고 · 안전' },
	{ id: 'account', label: '계정' },
	{ id: 'bug', label: '오류 제보' },
	{ id: 'etc', label: '기타' }
] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number]['id'];
export const kindLabel = (k: string) => INQUIRY_KINDS.find((x) => x.id === k)?.label ?? '기타';

export const INQUIRY_MIN = 5;
export const INQUIRY_MAX = 1000;

export type Inquiry = { id: number; kind: InquiryKind; body: string; created_at: string; answer: string | null; answered_at: string | null };
export const inquiryLabel = (q: { kind: string; body: string }) => isDeletionInquiry(q) ? '계정 삭제 요청' : kindLabel(q.kind);
type SendStatus = 'ok' | 'bad_input' | 'too_many' | 'rate';

export const fetchMyInquiries = () => rpc<Inquiry[] | null>('my_inquiries').then((r) => r ?? []);

export async function sendInquiry(kind: InquiryKind, body: string): Promise<SendStatus> {
	return (await rpc<{ status: SendStatus }>('send_inquiry', { p_kind: kind, p_body: body })).status;
}

export const SEND_ERROR: Record<Exclude<SendStatus, 'ok'>, string> = {
	bad_input: `${INQUIRY_MIN}자 이상 적어 주세요`,
	too_many: '답변을 기다리는 문의가 3개 있어요. 답변을 받은 뒤에 보내 주세요',
	rate: '오늘은 더 보낼 수 없어요 (하루 5개까지)'
};

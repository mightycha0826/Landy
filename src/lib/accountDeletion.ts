/** 기존 계정 문의로 접수한다. 답변 여부를 실제 데이터 삭제 완료로 해석하지 않는다. */
export const DELETION_PREFIX = '[계정 삭제 요청]';
export const DELETION_TEXT = `${DELETION_PREFIX}\n내 계정과 개인정보 삭제를 요청합니다. 삭제 범위와 별도로 보관되는 정보, 처리 결과를 안내해 주세요.`;
export const DELETION_NOTE_MAX = 1000 - DELETION_TEXT.length - 2;
export const isDeletionInquiry = (q: { kind: string; body: string }) => q.kind === 'account' && q.body.startsWith(`${DELETION_PREFIX}\n`);
export function deletionRequestBody(note: string): string {
	const text = note.trim();
	if (text.length > DELETION_NOTE_MAX) throw new Error('추가 설명이 너무 길어요');
	return DELETION_TEXT + (text ? `\n\n${text}` : '');
}

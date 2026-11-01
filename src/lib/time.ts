/**
 * "방금 · 3분 · 2시간 · 어제 · 5일 · 9월 3일" — 인스타그램식 짧은 상대 시간.
 * now 는 서버 시계 기준(클라 시각 + skew)으로 넘긴다.
 */
export function ago(iso: string, now: number): string {
	const t = Date.parse(iso);
	const s = Math.max(0, Math.floor((now - t) / 1000));
	if (s < 60) return '방금';
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}분`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}시간`;
	const d = Math.floor(h / 24);
	if (d === 1) return '어제';
	if (d < 7) return `${d}일`;
	return new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

/** ago() 에 "전"을 붙인 것 — "3분 전 · 어제 · 9월 3일" */
export function agoText(iso: string, now: number): string {
	const a = ago(iso, now);
	// 숫자 + 단위만 (날짜 "10월 6일"도 "일"로 끝나지만 "전"을 붙이지 않는다)
	return /^\d+(분|시간|일)$/.test(a) ? `${a} 전` : a;
}

/** 도배 제한 대기 시간 → "3분 뒤" / "2시간 뒤" */
export function waitText(ms: number): string {
	const m = Math.ceil(ms / 60_000);
	if (m < 60) return `${m}분 뒤`;
	return `${Math.ceil(m / 60)}시간 뒤`;
}

/** 초 → "4:05" (pad 면 "04:05"). 반올림 방향(남은 시간은 올림, 지난 시간은 내림)은 부르는 쪽이 정한다. */
export function mmss(sec: number, pad = false): string {
	const s = Math.max(0, sec);
	const m = Math.floor(s / 60);
	return `${pad ? String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`;
}

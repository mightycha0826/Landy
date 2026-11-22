import { fetchUnread } from './api';
import { accountIsCurrent, accountToken, currentAccountId, onAccountChange } from '../accountScope';

/**
 * 안 연 편지 수 — 하단 탭 "익명편지" 위의 빨간 점.
 * 편지함 화면이 목록을 새로 읽으면 여기도 같이 바뀌고, 그 밖에는 앱이 보이는 동안 가끔(5분) 확인한다.
 */
/** loaded = 서버에서 한 번이라도 받았다 (처음 받은 수로 "새 편지" 알림을 띄우지 않게) */
export const DM = $state({ unread: 0, loaded: false });
let flight: Promise<void> | null = null;
let revision = 0;

/** 같은 조회는 공유한다. 읽기·삭제 뒤에는 진행 중 응답을 버리고 새 상태를 한 번 더 읽는다. */
export async function refreshUnread(afterChange = false) {
	if (!currentAccountId()) return;
	const token = accountToken();
	if (afterChange) {
		revision++;
		if (flight) await flight;
		if (!accountIsCurrent(token)) return;
	}
	if (flight) return flight;
	const work = readUnread(revision);
	flight = work;
	try { await work; } finally { if (flight === work) flight = null; }
}

async function readUnread(request: number) {
	const token = accountToken();
	try {
		const unread = await fetchUnread();
		if (!accountIsCurrent(token) || request !== revision) return;
		DM.unread = unread;
		DM.loaded = true;
	} catch {
		/* DB 가 편지함 전이거나 네트워크 — 점을 그대로 둔다 */
	}
}

/**
 * 편지함에서 보고 있던 칸 (받은 편지 · 보낸 편지) — 편지를 열었다가 뒤로 와도 그 칸 그대로.
 * 편지를 열면 그 편지 쪽(보낸/받은)으로 맞춘다.
 */
export const LIST = $state({ tab: 'received' as 'received' | 'sent' });

onAccountChange(() => {
	flight = null;
	revision++;
	DM.unread = 0;
	DM.loaded = false;
	LIST.tab = 'received';
});

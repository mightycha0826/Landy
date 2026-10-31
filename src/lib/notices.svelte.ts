import { supabase } from './supabase';
import { accountIsCurrent, accountToken, currentAccountId, onAccountChange } from './accountScope';

/**
 * 공지사항 — 하트(알림) 아이콘의 빨간 점 · 알림 화면 · /notices 화면이 같이 쓴다.
 * 어디까지 봤는지(lastSeen)는 서버가 계정에 저장한다 (폰을 바꿔도 이미 본 공지에 점이 다시 뜨지 않게).
 * 개인 공지(Phase 35) — 운영진이 나에게만 보낸 경고 · 연락. 한 통씩 읽음 표시.
 */
type Notice = { id: number; title: string; body: string; created_at: string };
type PersonalNotice = Notice & { kind: 'message' | 'warning'; read: boolean };

export const NOTICES = $state({
	list: [] as Notice[],
	personal: [] as PersonalNotice[],
	lastSeen: 0,
	loaded: false
});

/** 아직 안 본 전체 공지가 있는가 */
export const hasNewNotice = () => (NOTICES.list[0]?.id ?? 0) > NOTICES.lastSeen;
/** 안 읽은 개인 공지 수 */
export const unreadPersonal = () => NOTICES.personal.filter((n) => !n.read).length;

/** 마지막으로 불러온 시각 — 탭을 오갈 때마다 새로 부르지 않게 */
let lastLoad = 0;
const FRESH_MS = 60_000;
let request = 0;

onAccountChange(() => {
	NOTICES.list = [];
	NOTICES.personal = [];
	NOTICES.lastSeen = 0;
	NOTICES.loaded = false;
	lastLoad = 0;
	request++;
});

/**
 * force = 공지 화면처럼 지금 꼭 최신이어야 할 때.
 * false 를 돌려주면 못 불러왔다 — 화면은 "불러오는 중"에 머물지 말고 다시 시도를 보인다 (UX G4)
 */
export async function loadNotices(force = false): Promise<boolean> {
	if (!currentAccountId()) return false;
	if (!force && NOTICES.loaded && Date.now() - lastLoad < FRESH_MS) return true;
	const token = accountToken();
	const sequence = ++request;
	const { data, error } = await supabase.rpc('my_notices');
	const d = data as { notices?: Notice[]; last_seen?: number; personal?: PersonalNotice[] } | null;
	// 늦게 온 옛 응답 — 그 사이 더 새 요청이 맡았다
	if (!accountIsCurrent(token) || sequence !== request) return NOTICES.loaded;
	// 오류 · 모양이 다르면(아직 schema.sql 을 반영하지 않은 DB 등) 목록은 그대로 — 하트만 점 없이 보인다
	if (error || !Array.isArray(d?.notices)) return false;
	lastLoad = Date.now();
	NOTICES.list = d.notices.map((n) => ({ ...n, id: Number(n.id) }));
	NOTICES.personal = (d.personal ?? []).map((n) => ({ ...n, id: Number(n.id) }));
	NOTICES.lastSeen = Number(d.last_seen);
	NOTICES.loaded = true;
	return true;
}

/**
 * 본 것으로 저장 — 공지 목록을 열면 맨 위(최신)까지, 공지 하나를 열면 그 공지까지(upTo).
 * 더 새 공지를 못 본 채 옛 공지 하나만 열었을 때 새 공지까지 본 것으로 치지 않는다.
 */
export async function markNoticesSeen(upTo?: number) {
	const top = upTo ?? NOTICES.list[0]?.id ?? 0;
	if (top <= NOTICES.lastSeen) return;
	NOTICES.lastSeen = top; // 점은 바로 끈다. 저장이 실패하면 다음 불러오기 때 다시 뜬다.
	await supabase.rpc('mark_notices_seen', { p_id: top });
}

/** 개인 공지 한 통을 읽었다 */
export async function readPersonal(id: number) {
	const n = NOTICES.personal.find((x) => x.id === id);
	if (!n || n.read) return;
	n.read = true;
	await supabase.rpc('read_personal_notice', { p_id: id });
}

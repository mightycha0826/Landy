import { rpc } from '../rpc';
import { requestModeration } from '../moderation';
import { notifyDm } from '../push';
import { waitText } from '../time';
import type { LetterFmt } from './rich';
import type { BadgeLite } from '../achievements';

/**
 * 익명편지 (Phase 32) — 편지 한 통 = 봉투 하나. 받은 편지함 · 보낸 편지함을 따로, 답장도 편지로만.
 * 학생을 이름으로 찾아 보내면, 받는 사람에게 보낸 사람은 "익명의 ○학생"(성별만)으로 보인다.
 * 보내는 사람이 서명(닉네임, Phase 35)을 적으면 그 서명으로 — 규칙 필터 · 검열봇을 거친다.
 * 내가 이름으로 보낸 사람이 답장하면 그 사람 이름으로 보인다 (이미 아는 사이).
 * 서버는 전부 RPC (supabase/schema.sql Phase 23 · 32). 표는 private 라 직접 읽을 수 없다.
 */
type Gender = 'm' | 'f' | 'x';
export type Box = 'received' | 'sent';
/** no = 학번 (같은 학년 동명이인 구분, Phase 35) */
export type DmPerson = {
	id: string;
	name: string;
	grade: number | null;
	no?: string | number | null;
	checked: boolean;
	/** 대표 뱃지 (Phase 84) — 순서는 그 사람이 정한 대로(내 순서 · 무작위) */
	badges?: BadgeLite[];
};

/** 편지함의 한 통 — 봉투 겉면에 쓰일 것만 (본문은 봉투를 열어야 받는다) */
export type MailItem = {
	id: number;
	thread_id: number;
	created_at: string;
	removed: boolean;
	thread_status: 'open' | 'closed' | 'removed';
	/** 받은 편지: 모르는 사람이면 성별만, 내가 이름으로 보낸 사람의 답장이면 이름 */
	from_gender?: Gender | null;
	from_name?: string | null;
	/** 받은 편지: 보낸 사람이 적은 서명 (Phase 35) */
	from_nick?: string | null;
	/** 보낸 답장: 상대(익명 쪽)의 서명 */
	to_nick?: string | null;
	/** 내가 익명 쪽이면 그때 쓴 내 서명 */
	my_nick?: string | null;
	/** 받은 사람이 봉투를 열었는지 (받은 편지 = 내가, 보낸 편지 = 상대가) */
	opened: boolean;
	/** 답장으로 온 / 보낸 편지 */
	is_reply: boolean;
	/** 보낸 편지: 이름으로 보냈으면 받는 사람 이름 · 학년, 답장이었으면 상대 성별 */
	to_name?: string | null;
	to_grade?: number | null;
	to_gender?: Gender | null;
	/** 보낸 편지에 답장이 왔는지 */
	replied?: boolean | null;
	/** 나에게 받은 편지인지 보낸 편지인지 — 폴더 안에서는 둘이 섞여 있다 (Phase 47) */
	box?: Box;
};

/** 편지 폴더 (Phase 47) — 내 것만. count = 지금 볼 수 있는 편지 수, received · sent = 그중 받은 편지 · 보낸 편지 (Phase 47-3) */
export type Folder = { id: number; name: string; count: number; received?: number; sent?: number };
/** 폴더 이름은 20자까지 */
export const FOLDER_MAX = 20;

/** 봉투를 연 편지 한 통 */
export type Letter = MailItem & {
	status: 'ok';
	role: Box;
	body: string | null;
	fmt?: LetterFmt | null;
	closed_by: 'sender' | 'recipient' | 'staff' | null;
	/** 받은 편지이고 줄기가 열려 있으면 답장할 수 있다 */
	can_reply: boolean;
	/** 내가 답 없이 3통을 보냈다 — 상대가 답할 때까지 못 쓴다 */
	wait_reply: boolean;
	/** 방금 처음 열었다 — 봉투 여는 연출은 이때만 */
	first_open?: boolean;
	server_now: string;
};

export type SendResult =
	| { status: 'ok'; thread_id: number; msg_id: number }
	| { status: 'rate_limited'; retry_after_ms: number }
	| { status: 'wait_reply'; thread_id?: number }
	| { status: 'not_available' | 'restricted' | 'no_name' | 'bad_text' | 'bad_nick' | 'closed' | 'not_found' | 'letters_locked' | 'service_closed' };

// ── 이름표 ──
const genderWord = (g: Gender | null | undefined) => (g === 'm' ? '남학생' : g === 'f' ? '여학생' : '학생');
export const anonName = (g: Gender | null | undefined) => `익명의 ${genderWord(g)}`;
/** 받은 편지의 From. — 아는 사람이면 이름, 서명이 있으면 서명, 없으면 "익명의 ○학생" */
export const fromLabel = (l: Pick<MailItem, 'from_name' | 'from_gender' | 'from_nick'>) => l.from_name ?? l.from_nick ?? anonName(l.from_gender);
/** 보낸 편지의 To. (학년은 따로) */
export const toLabel = (l: Pick<MailItem, 'to_name' | 'to_gender' | 'to_nick'>) => l.to_name ?? l.to_nick ?? anonName(l.to_gender);
/** 봉투의 상대 — 받은 편지면 From., 보낸 편지면 To. */
export const otherLabel = (l: Pick<MailItem, 'from_name' | 'from_gender' | 'from_nick' | 'to_name' | 'to_gender' | 'to_nick'>, box: Box) =>
	box === 'received' ? fromLabel(l) : toLabel(l);
/**
 * 봉투에 적힌 나 (받은 편지의 To. · 보낸 편지의 From.) — 모르는 사람과 주고받은 편지면 내 이름,
 * 내가 익명으로 보낸 편지(와 그 답장)면 그때 쓴 내 서명 · 없으면 익명의 나
 */
export const myLabel = (l: Pick<MailItem, 'from_name' | 'to_name' | 'my_nick'>, box: Box, me: { name?: string | null; gender?: Gender | null }) =>
	(box === 'received' ? l.from_name : l.to_name) ? (l.my_nick ?? anonName(me.gender)) : (me.name ?? '나');
/** 상대가 나를 이름으로 찾아 보낸 쪽인가 (그 편지를 버리면 상대는 다시 못 보낸다) */
export const iAmRecipient = (l: Pick<MailItem, 'from_name' | 'to_name'>, box: Box) => !(box === 'received' ? l.from_name : l.to_name);
/** 봉투 테두리 — 받은 편지는 보낸 사람 성별 색(여학생 붉은색 · 남학생 푸른색), 이름으로 온 답장 · 보낸 편지는 테마 색 */
export const borderOf = (l: Pick<MailItem, 'from_name' | 'from_gender'>, box: Box) =>
	box === 'received' && !l.from_name ? (l.from_gender === 'f' ? 'f' : l.from_gender === 'm' ? 'm' : 'x') : 'brand';
/** 받침에 맞는 조사 — josa('익명의 여학생', '과', '와') → '익명의 여학생과'. 한글이 아니면 받침 없는 쪽 */
export function josa(word: string, withFinal: string, withoutFinal: string) {
	const c = (word.trim().at(-1) ?? '').charCodeAt(0) - 0xac00;
	return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? withFinal : withoutFinal);
}
/** 서명 — 12자 */
export const NICK_MAX = 12;

/** 소인 날짜 — "9.27" */
export const stampDate = (iso: string) => {
	const d = new Date(iso);
	return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
};
/** 편지지 날짜 — "2026년 9월 27일" */
export const paperDate = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

// ── 읽기 ──
/** 두 글자 이상. 공개 수신 설정만 반영하고, 익명 상대 차단으로 검색 결과가 달라지지 않는다. */
export const searchPeople = (q: string) => rpc<DmPerson[]>('dm_search', { p_q: q });
/** 찾기 화면 아래 추천 5명 (Phase 84 — 무작위. 추천을 끈 사람 · 이미 편지를 보내고 있는 사람은 빼고) */
export const recommendPeople = () => rpc<DmPerson[]>('dm_recommend');

/** 받은/보낸 편지 중 폴더에 넣지 않은 것. 첫 쪽이면 내 폴더 목록도 같이 온다 (요청을 늘리지 않게, G13) */
export async function fetchMailbox(box: Box, before: number | null = null): Promise<{ letters: MailItem[]; folders: Folder[] | null }> {
	const r = await rpc<{ letters: MailItem[]; folders?: Folder[] | null } | null>('dm_mailbox', { p_box: box, p_before: before });
	return { letters: r?.letters ?? [], folders: r?.folders ?? null };
}

/** 폴더 하나의 편지 — 받은 · 보낸 편지가 섞여서(편지마다 box) + 폴더 이름 · 편지 수. 없는 폴더면 folder = null */
export async function fetchFolder(id: number, before: number | null = null) {
	const r = await rpc<{ letters: MailItem[]; folder: Folder | null } | null>('dm_mailbox', { p_box: 'received', p_before: before, p_folder: id });
	return { letters: r?.letters ?? [], folder: r?.folder ?? null };
}

// ── 폴더 (Phase 47) ──
/** 받은 편지가 모두 한 폴더에 들어간 사람(편지 줄기) — "앞으로도 이 폴더에 넣을까요?"를 묻는다 (FolderRule) */
export type FolderOffer = Pick<MailItem, 'thread_id' | 'from_gender' | 'from_name' | 'from_nick'>;
export type FolderAsk = { thread: number; folder: number; who: string };
type FolderResult =
	| { status: 'ok'; folder?: { id: number; name: string }; moved: number; offer?: FolderOffer[] }
	| { status: 'bad_name' | 'bad_request' | 'not_found' | 'too_many' | 'exists' };
/** 여러 통을 폴더에 — folder(있는 폴더) 또는 name(새 폴더, 같은 이름이 있으면 그 폴더) */
export const putInFolder = (ids: number[], to: { folder: number } | { name: string }) =>
	rpc<FolderResult>('dm_folder_put', { p_msgs: ids, p_folder: 'folder' in to ? to.folder : null, p_name: 'name' in to ? to.name : null });
/** 앞으로 이 사람(줄기)에게서 온 편지는 열어 보면 이 폴더로 — 그 사람의 편지를 폴더에서 빼거나 옮기면 꺼진다 */
export const setFolderRule = (thread: number, folder: number) => rpc<FolderResult>('dm_folder_rule', { p_thread: thread, p_folder: folder });
/** 폴더에서 빼기 — 보관함으로 돌아간다 */
export const takeFromFolder = (ids: number[]) => rpc<FolderResult>('dm_folder_take', { p_msgs: ids });
export const renameFolder = (id: number, name: string) => rpc<FolderResult>('dm_folder_rename', { p_folder: id, p_name: name });
/** 폴더 지우기 — 안의 편지는 보관함으로 돌아간다 */
export const deleteFolder = (id: number) => rpc<FolderResult>('dm_folder_delete', { p_folder: id });
/** 편지 지우기 (Phase 69) — 내 편지함에서만 (상대의 편지 · 편지 줄기는 그대로). 받은 편지는 열어 본 것만. moved = 지운 수 */
export const deleteLetters = (ids: number[]) => rpc<FolderResult>('dm_letter_delete', { p_msgs: ids });
export function folderError(r: FolderResult): string | null {
	switch (r.status) {
		case 'ok':
			return null;
		case 'bad_name':
			return `폴더 이름을 1~${FOLDER_MAX}자로 적어 주세요`;
		case 'too_many':
			return '폴더는 30개까지 만들 수 있어요';
		case 'exists':
			return '같은 이름의 폴더가 있어요';
		case 'not_found':
			return '폴더를 찾을 수 없어요';
		default:
			return '다시 시도해 주세요';
	}
}

/** 안 연 받은 편지 수 (하단 탭 빨간 점) */
export const fetchUnread = async () => (await rpc<number | null>('dm_unread')) ?? 0;

/** 봉투 열기 — 받은 사람이 열면 보낸 쪽에 "읽음" */
export const openLetter = (id: number) => rpc<Letter | { status: 'not_found' }>('dm_open', { p_msg: id });

// ── 쓰기 ──
/** 보내고 나면 알림 · AI 검토를 부탁한다 (기다리지 않는다) */
function afterSend(r: SendResult) {
	if (r.status !== 'ok') return;
	notifyDm(r.msg_id);
	requestModeration();
}

/** 새 편지 — body 는 앞뒤 공백을 잘라서 (서식 위치가 본문 기준이라 서버가 자른 것과 같아야 한다) */
export async function sendLetter(to: string, body: string, fmt: LetterFmt | null = null, nick: string | null = null) {
	const r = await rpc<SendResult>('dm_send', { p_to: to, p_body: body, p_fmt: fmt, p_nick: nick?.trim() || null });
	afterSend(r);
	return r;
}

/** 받은 편지 한 통에 편지로 답장 */
export async function replyToLetter(msgId: number, body: string, fmt: LetterFmt | null = null, nick: string | null = null) {
	const r = await rpc<SendResult>('dm_reply_to', { p_msg: msgId, p_body: body, p_fmt: fmt, p_nick: nick?.trim() || null });
	afterSend(r);
	return r;
}

export const closeThread = (id: number) => rpc<{ status: string }>('dm_close', { p_thread: id });
export const blockThread = (id: number) => rpc<{ status: string }>('dm_block', { p_thread: id });
export const reportThread = (id: number, reason: string, note: string) =>
	rpc<{ status: string }>('dm_report', { p_thread: id, p_reason: reason, p_note: note });

/** 상태 코드 → 사용자 문구 (ok 는 null) */
export function sendError(r: SendResult): string | null {
	switch (r.status) {
		case 'ok':
			return null;
		case 'rate_limited':
			return `새 편지는 하루에 몇 통만 보낼 수 있어요. ${waitText(r.retry_after_ms)} 다시 보낼 수 있어요`;
		case 'wait_reply':
			return '답장이 오기 전에는 3통까지 보낼 수 있어요';
		case 'not_available':
			return '이 사람에게는 지금 편지를 보낼 수 없어요';
		case 'restricted':
			return '이용이 제한된 계정이에요';
		case 'no_name':
			return '먼저 내 이름을 확인해 주세요';
		case 'bad_text':
			return '1~1000자로 적어 주세요';
		case 'bad_nick':
			return '이 서명은 쓸 수 없어요 · 12자 안에서, 연락처나 운영자처럼 보이는 이름은 빼 주세요';
		case 'closed':
			return '끝난 편지예요';
		case 'letters_locked':
			return '익명편지는 가입한 학생이 모이면 열려요';
		case 'service_closed':
			return '지금은 편지 쓰기가 쉬고 있어요. 잠시 뒤 다시 확인해 주세요';
		default:
			return '편지를 찾을 수 없어요';
	}
}

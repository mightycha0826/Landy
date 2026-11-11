/**
 * 운영진 역할 · 권한 (Phase 49 · 51) — 서버와 화면이 같이 쓴다.
 * 역할: 운영자 · 개발자 · 베타테스터 · 관리자(늘 전부). 역할마다 가진 권한은 DB 표(private.role_perms)에 있고
 * 최고 관리자가 운영진 관리 화면에서 바꾼다. 내 권한 목록(perms)은 요청마다 역할 확인(admin_staff_touch)과 같이 온다.
 * 화면은 권한 없는 메뉴를 숨기고, 화면 load(guard)는 주소를 직접 쳐도 막고, DB 함수가 같은 표로 한 번 더 막는다.
 */
const STAFF_ROLES = ['moderator', 'developer', 'beta', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaffRole = (role: unknown): role is StaffRole => STAFF_ROLES.some((known) => role === known);
export type Perm = 'live' | 'moderate' | 'identity' | 'settings' | 'service' | 'inquiry' | 'notice' | 'audit';

/** 긴 정지는 관리자 역할만. identity 권한과 제재 기간 제한은 별개다 (DB도 같은 규칙). */
export const MOD_MAX_SUSPEND_DAYS = 7;
export const ADMIN_MAX_SUSPEND_DAYS = 365;

export const ROLE_LABEL: Record<StaffRole, string> = { moderator: '운영자', developer: '개발자', beta: '베타테스터', admin: '관리자' };
export const ROLE_COLOR: Record<StaffRole, string> = { moderator: '#16a34a', developer: '#2563eb', beta: '#9333ea', admin: '#e11d48' };
/** 권한을 바꿀 수 있는 역할 (관리자는 늘 전부) */
export const EDITABLE_ROLES: StaffRole[] = ['moderator', 'developer', 'beta'];

/** 권한 목록 — 운영진 관리 화면의 체크 표 (위에서부터 가벼운 것 → 무거운 것) */
export const PERM_INFO: { key: Perm; label: string; hint: string }[] = [
	{ key: 'live', label: '실시간 현황', hint: '접속 · 대화 중인 학생 수와 상태(익명 닉네임)' },
	{ key: 'audit', label: '활동 기록 보기', hint: '운영진이 한 조치 · 열람 기록' },
	{ key: 'inquiry', label: '문의 보기 · 답변', hint: '학생 문의 · 버그 제보에 답장(개인 공지로 감)' },
	{ key: 'service', label: '서비스 열고 닫기', hint: '새 대화 시작을 잠시 멈추기 · 다시 열기' },
	{ key: 'settings', label: '운영 설정 바꾸기', hint: '대화 시간 · AI · 금칙어 · 익명편지 잠금 · 홈 배너' },
	{ key: 'moderate', label: '신고 처리 · 제재', hint: '채팅 · 편지 신고, 경고 · 정지, 사용자 보기, 개인 공지 · 업적' },
	{ key: 'notice', label: '공지 올리기 · 내리기', hint: '모든 학생에게 가는 공지' },
	{ key: 'identity', label: '학생 신원 보기', hint: '이메일 · 학번 이름, 전체 대화 기록, 편지 활동 — 열람은 기록에 남음' }
];

type Who = { role: StaffRole; perms?: Perm[] } | null | undefined;
/** 이 사람이 이 권한을 가졌나 — 'any' 는 운영진이면 누구나 */
export const can = (who: Who, perm: Perm | 'any') => !!who && (perm === 'any' || who.role === 'admin' || !!who.perms?.includes(perm));

/** 화면(주소)마다 필요한 권한(여럿이면 하나만 있어도) — 맨 앞이 맞는 것부터 */
const PAGES: [RegExp, (Perm | 'any')[]][] = [
	[/^\/admin\/(login|session)/, ['any']],
	[/^\/admin\/live/, ['live']],
	[/^\/admin\/(rooms|posts|badge-requests)/, ['identity']],
	[/^\/admin\/(reports|letters|users|badges)/, ['moderate']],
	[/^\/admin\/settings/, ['service', 'settings']],
	[/^\/admin\/notices/, ['any']],
	[/^\/admin\/inquiries/, ['inquiry']],
	[/^\/admin\/audit/, ['audit']],
	[/^\/admin\/team/, ['any']],
	[/^\/admin\/staff/, ['identity']], // 실제로는 최고 관리자만 (guard 가 따로 본다)
	[/^\/admin\/?$/, ['any']] // 개요 (Phase 96) — 운영진이면 누구나, 칸마다 내 권한만큼만 채워진다
];
function pagePerms(path: string): (Perm | 'any')[] {
	return PAGES.find(([re]) => re.test(path))?.[1] ?? ['any'];
}
export const canSee = (who: Who, path: string) =>
	// 업데이트 반영 (Phase 94) — 권한 표와 상관없이 관리자 역할만
	path.startsWith('/admin/update') ? who?.role === 'admin' : pagePerms(path).some((p) => can(who, p));

/**
 * 메뉴에 붙이는 밀린 일 수 (Phase 96) — 역할 확인(admin_staff_touch)과 같은 요청으로 온다.
 * 내 권한으로 처리할 수 없는 것은 null. DB 가 Phase 96 전이면 통째로 없다(메뉴에 수가 안 붙을 뿐).
 */
export type Todo = { reports: number | null; inquiries: number | null; badge_requests: number | null };

/** 현황 판 — 마지막으로 본 화면 주소를 "무엇을 하는 중"으로 */
export function activityOf(path: string | null): string {
	if (!path) return '';
	const p = path.replace(/\/__data\.json$/, '');
	if (p === '/admin') return '개요 보는 중';
	if (p.startsWith('/admin/reports')) return '신고 보는 중';
	if (p.startsWith('/admin/letters')) return '편지 신고 보는 중';
	if (p.startsWith('/admin/users/')) return '사용자 살펴보는 중';
	if (p.startsWith('/admin/users')) return '사용자 찾는 중';
	if (p.startsWith('/admin/badges')) return '뱃지 주는 중';
	if (p.startsWith('/admin/badge-requests')) return '뱃지 요청 보는 중';
	if (p.startsWith('/admin/rooms')) return '대화 기록 보는 중';
	if (p.startsWith('/admin/live')) return '실시간 현황 보는 중';
	if (p.startsWith('/admin/notices')) return '공지사항 보는 중';
	if (p.startsWith('/admin/inquiries')) return '문의 답하는 중';
	if (p.startsWith('/admin/settings')) return '운영 설정 보는 중';
	if (p.startsWith('/admin/update')) return '업데이트 보는 중';
	if (p.startsWith('/admin/audit')) return '활동 기록 보는 중';
	if (p.startsWith('/admin/staff')) return '운영진 관리 중';
	return '운영 화면';
}

export type TeamMember = { id: string; name: string; role: StaffRole; owner?: boolean; last_seen: string | null; path: string | null; me: boolean };
/** 운영진 관리 화면 (Phase 50, 최고 관리자만) 한 줄 */
export type StaffRow = { id: string; no: string | null; nickname: string | null; display_name: string | null; role: StaffRole; owner: boolean; created_at: string; last_seen: string | null };

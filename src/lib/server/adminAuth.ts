import { error, fail, redirect } from '@sveltejs/kit';
import { adminRpc, emailOf, rosterNameOf } from './supabaseAdmin';
import type { Identity } from '$lib/adminTypes';
import { ADMIN_MAX_SUSPEND_DAYS, MOD_MAX_SUSPEND_DAYS, can, canSee, homeOf, type Perm } from '$lib/adminRoles';

/**
 * 운영진(moderator) / 관리자(admin) 권한 — Phase 11
 *
 * 같은 규칙을 DB 함수(private.require_staff, admin_sanction)도 한 번 더 검사한다.
 * 여기서 막는 건 화면·메시지를 위해서고, 진짜 경계는 DB 쪽이다.
 */
export { MOD_MAX_SUSPEND_DAYS } from '$lib/adminRoles';

/** 학생 신원(이메일 · 학번 이름 · 전체 대화 · 편지 활동)을 볼 권한 — Phase 51 부터 역할별 권한 표(identity)를 따른다 */
export const isAdmin = (locals: App.Locals) => can(locals.staff, 'identity');
/** 역할별 권한 표(lib/adminRoles.ts · DB private.role_perms, Phase 49 · 51) */
export const allowed = (locals: App.Locals, perm: Perm) => can(locals.staff, perm);

/**
 * 역할마다 볼 수 있는 화면 (Phase 49) — 화면 load 맨 앞에서. 주소를 직접 쳐도 403.
 * 첫 화면(/admin = 채팅 신고)을 못 보는 역할(개발자)은 제 첫 화면으로 보낸다.
 */
export function guard(locals: App.Locals, url: URL) {
	const role = locals.staff?.role;
	// 운영진 관리 (Phase 50) — 최고 관리자 한 사람만
	if (url.pathname.startsWith('/admin/staff')) {
		if (locals.staff?.owner) return;
		error(403, '최고 관리자만 볼 수 있는 화면');
	}
	if (canSee(locals.staff, url.pathname)) return;
	if (role && (url.pathname === '/admin' || url.pathname === '/admin/')) redirect(303, homeOf(locals.staff));
	error(403, '이 역할로는 볼 수 없는 화면');
}

/** 관리자 전용 화면 — 운영진이 주소를 직접 쳐서 들어와도 403 */
export function requireAdmin(locals: App.Locals) {
	if (!isAdmin(locals)) error(403, '관리자만 볼 수 있는 화면');
}

/**
 * 화면에 나오는 사용자들의 "학번 이름" { user_id: '20529 홍길동' }.
 * 관리자만 받는다 (운영진은 빈 객체). 한 번 부를 때마다 DB 가 활동 기록(view_identity)을 남긴다.
 */
export async function studentLabels(
	locals: App.Locals,
	ids: (string | null | undefined)[]
): Promise<Record<string, string>> {
	const users = [...new Set(ids.filter((x): x is string => !!x))];
	if (!isAdmin(locals) || users.length === 0) return {};
	return adminRpc<Record<string, string>>('admin_student_labels', { p_staff: locals.staff!.id, p_users: users });
}

/**
 * 신원 열람 (이메일 확인) — 관리자만. 먼저 활동 기록을 남기고, 기록이 실패하면 열람도 하지 않는다.
 * 그다음 이메일과 명렬표 이름을 찾는다. 탈퇴한 계정은 email 이 null.
 */
export async function revealIdentity(locals: App.Locals, users: string[], report: string | null): Promise<Identity[]> {
	const staff = locals.staff!.id;
	await adminRpc('admin_log_identity_view', { p_staff: staff, p_users: users, p_report: report });
	return Promise.all(
		users.map(async (u) => {
			const email = await emailOf(u);
			return { email, name: await rosterNameOf(email, staff) };
		})
	);
}

const DB_ERR: Record<string, string> = {
	admin_only: '관리자만 할 수 있는 조치',
	mod_days_limit: `운영진은 최대 ${MOD_MAX_SUSPEND_DAYS}일까지 정지 가능`,
	not_staff: '운영진 명단에 없는 계정',
	no_permission: '이 역할로는 할 수 없는 조치',
	owner_only: '최고 관리자만 할 수 있어요',
	owner_locked: '최고 관리자는 여기서 바꿀 수 없어요',
	bad_role: '없는 역할이에요',
	bad_perm: '없는 권한이에요',
	bad_name: '표시 이름은 20자까지',
	days_required: '정지 기간을 입력해야 함',
	user_not_found: '탈퇴한 계정이라 조치할 수 없음',
	notice_not_found: '이미 내린 공지',
	already_answered: '이미 답변한 문의',
	inquiry_not_found: '지워진 문의',
	bad_answer: '답변을 적어 주세요 (2000자까지)',
	not_grantable: '운영진이 줄 수 있는 업적이 아님',
	too_many: '한 번에 500명까지',
	bad_nos: '학번을 적어 주세요',
	staff_delete_forbidden: '자기 계정과 운영진 계정은 이 경로에서 삭제할 수 없어요',
	bad_delete_confirmation: '삭제 확인 문구와 처리 사유를 확인해 주세요',
	deletion_target_mismatch: '삭제 요청과 대상 계정이 일치하지 않아요',
	not_deletion_request: '학생의 계정 삭제 요청에서만 실행할 수 있어요',
	already_deleted: '이미 삭제가 완료된 계정이에요',
	deletion_busy: '다른 삭제 처리가 진행 중이에요. 내역을 새로고침해 주세요'
};

/** adminRpc 에러를 화면용 문구로. 모르는 에러는 그대로 던진다. */
export function friendly(e: unknown) {
	const msg = String((e as Error)?.message ?? e);
	const key = Object.keys(DB_ERR).find((k) => msg.includes(k));
	if (!key) throw e;
	return fail(403, { error: DB_ERR[key] });
}

/**
 * 제재 폼 처리 (신고 상세·사용자 상세 공용).
 * 성공하면 action 이름을, 실패하면 ActionFailure 를 돌려준다.
 */
export async function runSanction(locals: App.Locals, user: string, f: FormData, report: string | null) {
	const action = String(f.get('action'));
	if (!['warn', 'suspend', 'ban', 'reinstate'].includes(action)) return fail(400, { error: '잘못된 조치' });
	const max = locals.staff?.role === 'admin' ? ADMIN_MAX_SUSPEND_DAYS : MOD_MAX_SUSPEND_DAYS;
	const days = action === 'suspend' ? Math.max(1, Math.min(max, Number(f.get('days')) || 0)) : null;
	try {
		await adminRpc('admin_sanction', {
			p_user: user,
			p_action: action,
			p_days: days,
			p_staff: locals.staff!.id,
			p_report: report,
			p_note: String(f.get('note') ?? '').slice(0, 1000)
		});
	} catch (e) {
		return friendly(e);
	}
	return action;
}

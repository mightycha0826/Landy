import { error, fail } from '@sveltejs/kit';
import { adminRpc } from '$lib/server/supabaseAdmin';
import { friendly, guard, isAdmin, revealIdentity, runSanction, studentLabels } from '$lib/server/adminAuth';
import type { PersonalNoticeRow, UserBadgeRow, UserDetail, UserRoomRow } from '$lib/adminTypes';
import { notifyPersonalNotice } from '$lib/server/pushSend';
import { badgeCode, noticeError, noticeInput } from '$lib/server/adminForms';
import type { Actions, PageServerLoad } from './$types';

async function detail(id: string, staff: string) {
	const d = await adminRpc<UserDetail | null>('admin_user', { p_user: id, p_staff: staff });
	if (!d) error(404, '계정을 찾을 수 없습니다');
	return d;
}

// ★ load 에는 이메일이 없다. 이메일·편지 활동은 아래 액션으로만, 기록과 함께 나간다.
export const load: PageServerLoad = async ({ params, locals, url }) => {
	guard(locals, url); // 운영자 · 관리자 (Phase 49)
	const staff = locals.staff!.id;
	const [d, rooms, notices, badges, tickets] = await Promise.all([
		detail(params.id, staff),
		isAdmin(locals)
			? adminRpc<UserRoomRow[]>('admin_user_rooms', { p_user: params.id, p_staff: staff })
			: Promise.resolve(null),
		adminRpc<PersonalNoticeRow[]>('admin_personal_notices', { p_staff: staff, p_user: params.id }).catch(() => [] as PersonalNoticeRow[]),
		// 특별 업적 (Phase 44) — DB 에 아직 없으면 빈 목록 (칸이 안 보인다)
		adminRpc<UserBadgeRow[]>('admin_user_badges', { p_staff: staff, p_user: params.id }).catch(() => [] as UserBadgeRow[]),
		// 닉네임 랜덤 변경권 (Phase 103) — DB 에 아직 없으면 null (칸이 안 보인다)
		adminRpc<number>('admin_nickname_tickets', { p_staff: staff, p_user: params.id }).catch(() => null)
	]);
	const students = await studentLabels(locals, [params.id, ...(rooms ?? []).map((r) => r.partner_id)]);
	return { d, rooms, students, notices, badges, tickets };
};

export const actions: Actions = {
	identity: async ({ params, locals }) => {
		if (!isAdmin(locals)) return fail(403, { error: '이메일 확인은 관리자만 가능' });
		await detail(params.id, locals.staff!.id);
		const [who] = await revealIdentity(locals, [params.id], null);
		return { userId: params.id, email: who.email ?? '(탈퇴)', name: who.name };
	},

	// 개인 공지 (Phase 35) — 이 학생에게만 (경고 · 개인 연락). 학생 앱의 공지 · 알림(하트)에 뜨고 푸시도 간다. 운영진 누구나, 기록에 남는다
	notify: async ({ params, request, locals, platform }) => {
		const f = await request.formData();
		const kind = f.get('kind') === 'warning' ? 'warning' : 'message';
		const input = noticeInput(f);
		const invalid = noticeError(input);
		if (invalid) return fail(400, { error: invalid });
		let id: number;
		try {
			id = await adminRpc<number>('admin_send_personal_notice', { p_staff: locals.staff!.id, p_user: params.id, p_kind: kind, p_title: input.title, p_body: input.body });
		} catch (e) {
			return friendly(e);
		}
		// 알림은 실패해도 공지는 이미 갔다 — 기다리지 않는다
		await notifyPersonalNotice(id, platform);
		return { done: kind === 'warning' ? '경고 공지를 보냈어요' : '개인 공지를 보냈어요' };
	},

	unnotify: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isSafeInteger(id) || id < 1) return fail(400, { error: '잘못된 공지' });
		try {
			await adminRpc('admin_remove_personal_notice', { p_staff: locals.staff!.id, p_id: id });
		} catch (e) {
			return friendly(e);
		}
		return { done: '개인 공지를 거뒀어요' };
	},

	sanction: async ({ params, request, locals }) => {
		await detail(params.id, locals.staff!.id);
		const res = await runSanction(locals, params.id, await request.formData(), null);
		if (typeof res !== 'string') return res;
		return { done: res === 'reinstate' ? '정지를 풀었어요' : '조치 완료' };
	},

	// 닉네임 랜덤 변경권 주기 (Phase 103) — 운영진 누구나, 1~20장, 기록에 남는다
	tickets: async ({ params, request, locals }) => {
		const n = Number((await request.formData()).get('n'));
		if (!Number.isInteger(n) || n < 1 || n > 20) return fail(400, { error: '1~20장 사이로 골라 주세요' });
		try {
			await adminRpc('admin_grant_nickname_tickets', { p_staff: locals.staff!.id, p_user: params.id, p_n: n });
		} catch (e) {
			return friendly(e);
		}
		return { done: `닉네임 변경권 ${n}장을 줬어요` };
	},

	// 특별 업적 주기 · 거두기 (Phase 44) — 운영진 누구나, 기록에 남는다
	badge: async ({ params, request, locals }) => {
		const f = await request.formData();
		const code = badgeCode(f);
		const on = f.get('on') === 'true';
		if (!code) return fail(400, { error: '잘못된 업적' });
		try {
			await adminRpc('admin_set_badge', { p_staff: locals.staff!.id, p_user: params.id, p_code: code, p_on: on });
		} catch (e) {
			return friendly(e);
		}
		return { done: on ? '업적을 줬어요' : '업적을 거뒀어요' };
	}
};

import { fail } from '@sveltejs/kit';
import { adminRpc } from '$lib/server/supabaseAdmin';
import { guard } from '$lib/server/adminAuth';
import { noticeInput } from '$lib/server/adminForms';
import { deployVersion, releaseState } from '$lib/server/workerVersions';
import type { NoticeRow } from '$lib/adminTypes';
import type { Actions, PageServerLoad } from './$types';

/**
 * 업데이트 (Phase 94, 관리자만 — guard 가 화면을, DB admin_release 가 기록을 한 번 더 막는다).
 * 푸시해서 올라온 새 버전은 여기서 "업데이트"를 눌러야 학생 화면에 나온다. 쓴 공지는 학생이 다음에 들어올 때 한 번 뜬다.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	guard(locals, url); // 관리자 역할만 (lib/adminRoles canSee)
	const [state, notices] = await Promise.all([
		releaseState().catch((e) => ({ error: String((e as Error).message) })),
		adminRpc<NoticeRow[]>('admin_notices', { p_staff: locals.staff!.id })
	]);
	return { state, releases: notices.filter((n) => n.release).slice(0, 5) };
};

export const actions: Actions = {
	release: async ({ request, locals }) => {
		if (locals.staff?.role !== 'admin') return fail(403, { error: '관리자만 업데이트할 수 있어요' });
		const form = await request.formData();
		const input = noticeInput(form);
		if (input.title.length > 80) return fail(400, { error: '제목은 80자까지', ...input });
		if (input.body.length > 2000) return fail(400, { error: '내용은 2000자까지', ...input });
		let state;
		try {
			state = await releaseState();
		} catch {
			return fail(502, { error: 'Cloudflare 에서 버전 목록을 받지 못했어요', ...input });
		}
		if (!state.configured) return fail(400, { error: 'CF_API_TOKEN · CF_ACCOUNT_ID 가 설정되지 않았어요', ...input });
		const next = state.pending[0];
		// 화면을 연 뒤에 또 푸시됐으면 — 본 적 없는 버전을 내보내지 않게 다시 보고 누르게 한다
		if (!next || next.id !== form.get('version')) return fail(409, { error: '대기 중인 버전이 바뀌었어요. 화면을 새로 보고 다시 눌러 주세요', ...input });
		try {
			await deployVersion(next.id, 'Landy 관리자 화면에서 업데이트');
		} catch {
			return fail(502, { error: 'Cloudflare 배포에 실패했어요. 학생 화면은 그대로예요', ...input });
		}
		try {
			await adminRpc('admin_release', { p_staff: locals.staff.id, p_version: next.id, p_title: input.title, p_body: input.body });
		} catch {
			// 배포는 됐다 — 공지만 공지사항에서 다시 올리면 된다
			return fail(500, { error: '업데이트는 반영됐지만 공지를 남기지 못했어요. 공지사항에서 올려 주세요' });
		}
		return { done: input.body ? '업데이트 반영 · 학생이 다음에 들어오면 공지가 떠요' : '업데이트 반영' };
	}
};

import { fail } from '@sveltejs/kit';
import { adminRpc, supabaseAdmin } from '$lib/server/supabaseAdmin';
import { deleteRequestedAccount, type AccountDeletionRow } from '$lib/server/accountDeletion';
import { friendly, guard, studentLabels } from '$lib/server/adminAuth';
import { notifyPersonalNotice } from '$lib/server/pushSend';
import type { InquiryRow } from '$lib/adminTypes';
import { isDeletionInquiry } from '$lib/accountDeletion';
import type { Actions, PageServerLoad } from './$types';

/**
 * 학생 문의 (Phase 37) — 설정 › 운영진에게 문의하기 로 온 글. 답을 기다리는 것부터 오래된 순.
 * 답변을 적으면 그 학생에게 개인 공지로 가고(하트 · 공지 · 푸시) 활동 기록에 남는다. 운영진 누구나.
 * 누가 보냈는지(학번 · 이름)는 관리자에게만 — 이름표를 부르면 활동 기록에 남는다 (studentLabels).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	guard(locals, url); // 문의 권한 (Phase 51 표)
	const r = await adminRpc<{ open: number; items: InquiryRow[] }>('admin_inquiries', { p_staff: locals.staff!.id });
	// 답변한 삭제 요청도 삭제를 처리하므로 이름을 함께 받는다
	const students = await studentLabels(locals, r.items.filter((x) => !x.answered_at || isDeletionInquiry(x)).map((x) => x.user_id));
	let deletions: (AccountDeletionRow & { retryable: boolean })[] = [];
	let deletionReady = false;
	if (locals.staff?.role === 'admin') {
		try {
			const jobs = await adminRpc<AccountDeletionRow[]>('admin_account_deletions', { p_staff: locals.staff.id });
			deletions = jobs.map((job) => ({ ...job, retryable: job.status === 'failed' || (job.status === 'processing' && Date.parse(job.lease_until ?? '') <= Date.now()) }));
			deletionReady = true;
		} catch { /* 연결 또는 마이그레이션 문제: 실제 삭제를 제공하지 않고 재조회 안내 */ }
	}
	return { open: r.open, items: r.items, students, deletions, deletionReady, canDelete: locals.staff?.role === 'admin' };
};

export const actions: Actions = {
	deleteAccount: async ({ request, locals }) => {
		if (locals.staff?.role !== 'admin') return fail(403, { error: '계정 삭제는 관리자만 실행할 수 있어요' });
		const f = await request.formData();
		const id = Number(f.get('id'));
		const user = String(f.get('user') ?? '');
		const confirmation = String(f.get('confirmation') ?? '').trim();
		const note = String(f.get('note') ?? '').trim();
		if (!Number.isSafeInteger(id) || id < 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user))
			return fail(400, { error: '삭제 대상과 요청 번호를 확인해 주세요' });
		if (confirmation !== `삭제 ${id}` || f.get('acknowledged') !== 'yes' || note.length < 5 || note.length > 1000)
			return fail(400, { error: `처리 사유와 확인 문구 “삭제 ${id}”, 확인 체크를 입력해 주세요` });
		try {
			const result = await deleteRequestedAccount(supabaseAdmin(), { staff: locals.staff.id, inquiry: id, user, confirmation, note });
			return 'error' in result ? fail(503, result) : result;
		} catch (e) {
			try { return friendly(e); }
			catch { return fail(503, { error: '계정 삭제 준비를 완료하지 못했어요. DB 업데이트와 연결을 확인한 뒤 다시 시도해 주세요' }); }
		}
	},
	answer: async ({ request, locals, platform }) => {
		const f = await request.formData();
		const id = Number(f.get('id'));
		const answer = String(f.get('answer') ?? '').trim();
		if (!Number.isSafeInteger(id) || id < 1) return fail(400, { error: '잘못된 문의' });
		if (!answer) return fail(400, { error: '답변을 적어 주세요', id, answer });
		if (answer.length > 2000) return fail(400, { error: '답변은 2000자까지', id, answer });
		let notice: number;
		try {
			notice = await adminRpc<number>('admin_answer_inquiry', { p_staff: locals.staff!.id, p_id: id, p_answer: answer });
		} catch (e) {
			return friendly(e);
		}
		// 알림은 실패해도 답변은 이미 갔다
		await notifyPersonalNotice(notice, platform);
		return { done: '답변을 보냈어요 · 학생의 알림(하트)과 공지에 떠요' };
	}
};

import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountDeletionRow = {
	user_id: string; inquiry_id: number; staff_id: string; note: string;
	status: 'processing' | 'failed' | 'deleted'; failure_stage: string | null;
	lease_until: string | null; created_at: string; updated_at: string; completed_at: string | null;
};
type Plan = { user_id: string; lease: string; auth_exists: boolean; assets: { bucket: string; path: string }[] };
export type DeletionInput = { staff: string; inquiry: number; user: string; confirmation: string; note: string };
type Client = Pick<SupabaseClient, 'rpc' | 'storage' | 'auth'>;

/** Auth API와 Storage API는 DB 트랜잭션 밖에서 실행한다. 부분 실패는 원장에 남겨 재시도한다. */
export async function deleteRequestedAccount(client: Client, input: DeletionInput) {
	const prepared = await client.rpc('admin_account_delete_prepare', {
		p_staff: input.staff, p_id: input.inquiry, p_user: input.user, p_confirm: input.confirmation, p_note: input.note
	});
	if (prepared.error) throw new Error(prepared.error.message);
	const plan = prepared.data as Plan;
	let stage = 'auth_lock';
	try {
		if (plan.auth_exists) {
			const locked = await client.auth.admin.updateUserById(plan.user_id, { ban_duration: '876000h' });
			if (locked.error) throw locked.error;
		}
		stage = 'storage';
		const buckets = new Map<string, string[]>();
		for (const asset of plan.assets) buckets.set(asset.bucket, [...(buckets.get(asset.bucket) ?? []), asset.path]);
		for (const [bucket, paths] of buckets) {
			for (let start = 0; start < paths.length; start += 100) {
				const removed = await client.storage.from(bucket).remove(paths.slice(start, start + 100));
				if (removed.error) throw removed.error;
			}
		}
		stage = 'auth';
		if (plan.auth_exists) {
			const removed = await client.auth.admin.deleteUser(plan.user_id, false);
			if (removed.error) throw removed.error;
		}
		stage = 'record';
		const finished = await client.rpc('admin_account_delete_finish', { p_staff: input.staff, p_user: plan.user_id, p_lease: plan.lease });
		if (finished.error) throw finished.error;
		return { done: '계정 삭제 완료 · 삭제 처리 내역과 활동 기록에 남겼어요' };
	} catch {
		// Auth 삭제 후 기록 실패도 완료로 알리지 않는다. 다음 재시도에서 DB의 실제 상태를 확인한다.
		try { await client.rpc('admin_account_delete_finish', { p_staff: input.staff, p_user: plan.user_id, p_lease: plan.lease, p_stage: stage }); } catch { /* 원장의 임대 만료 후 재시도 */ }
		return { error: stage === 'record'
			? '인증 계정 삭제 후 완료 기록을 확인하지 못했어요. 삭제 처리 내역에서 다시 시도해 주세요.'
			: '삭제 처리를 완료하지 못했어요. 남아 있는 계정은 이용 제한 상태이며 일부 정보가 이미 삭제됐을 수 있어요. 삭제 처리 내역에서 다시 시도해 주세요.' };
	}
}

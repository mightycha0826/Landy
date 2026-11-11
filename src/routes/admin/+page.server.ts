import { adminRpc } from '$lib/server/supabaseAdmin';
import { guard } from '$lib/server/adminAuth';
import type { Overview } from '$lib/adminTypes';
import type { PageServerLoad } from './$types';

/**
 * 개요 (Phase 96) — 운영 콘솔 첫 화면. 할 일 · 지금 · 14일 추이 · 시스템을 한 번의 요청으로 받는다.
 * 운영진이면 누구나 열고, 칸은 DB 가 내 권한만큼만 채운다. 신고 목록은 /admin/reports 로 옮겼다.
 * DB 가 Phase 96 전이거나 못 받았으면 null — 화면은 열리고 바로가기만 보인다.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	guard(locals, url);
	const overview = await adminRpc<Overview>('admin_overview', { p_staff: locals.staff!.id }).catch(() => null);
	return { overview };
};

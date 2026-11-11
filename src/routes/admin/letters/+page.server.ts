import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** 예전 편지 신고 목록 주소 — 신고 큐(/admin/reports)의 편지 칸으로 보낸다 (Phase 96). 상세(/admin/letters/[id])는 그대로 */
export const load: PageServerLoad = ({ url }) => {
	const status = url.searchParams.get('status');
	redirect(307, `/admin/reports?kind=letter${status ? `&status=${encodeURIComponent(status)}` : ''}`);
};

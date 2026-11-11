import { listReports, reportFilter } from '$lib/server/reports';
import { guard } from '$lib/server/adminAuth';
import type { LetterReportRow, ReportRow } from '$lib/adminTypes';
import type { PageServerLoad } from './$types';

/**
 * 신고 큐 (Phase 96 — 채팅 신고(/admin)와 편지 신고(/admin/letters) 두 목록을 한 화면으로).
 * ?kind=chat|letter · ?status= 로 고른다. 상세는 그대로 /admin/reports/[id] · /admin/letters/[id].
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	guard(locals, url); // 신고 처리 권한 (moderate)
	const status = reportFilter(url);
	return url.searchParams.get('kind') === 'letter'
		? { kind: 'letter' as const, status, reports: await listReports<LetterReportRow>('letter', status) }
		: { kind: 'chat' as const, status, reports: await listReports<ReportRow>('chat', status) };
};

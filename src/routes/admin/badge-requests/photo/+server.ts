import { error, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { adminRpc, supabaseAdmin } from '$lib/server/supabaseAdmin';

/** 경로를 클라이언트에서 받지 않는다. 권한은 DB가 사진마다 다시 검사한다. */
export const GET: RequestHandler = async ({ url, locals }) => {
	requireAdmin(locals);
	const id = Number(url.searchParams.get('id'));
	const index = Number(url.searchParams.get('index'));
	if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(index) || index < 0 || index > 2) error(400, '잘못된 사진 요청');
	// 사진 한 장의 경로만 받는다. 열람 기록은 목록(admin_badge_requests)을 열 때 한 번 남는다
	const path = await adminRpc<string | null>('admin_badge_request_photo', { p_staff: locals.staff!.id, p_id: id, p_index: index });
	if (!path) error(404, '요청이 처리되었거나 사진이 없어요');
	const { data, error: downloadError } = await supabaseAdmin().storage.from('badge-proofs').download(path);
	if (downloadError || !data) error(502, '사진을 불러오지 못했어요. 다시 시도해 주세요.');
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(data.type)) error(415, '지원하지 않는 사진');
	return new Response(data, { headers: {
		'Content-Type': data.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
		'Content-Disposition': 'inline', 'Referrer-Policy': 'no-referrer'
	} });
};

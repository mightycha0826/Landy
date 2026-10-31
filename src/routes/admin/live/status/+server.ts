import { json } from '@sveltejs/kit';
import { adminRpc } from '$lib/server/supabaseAdmin';
import { guard } from '$lib/server/adminAuth';
import type { LiveUser } from '$lib/adminTypes';
import type { RequestHandler } from './$types';

/** 실시간 현황 새로고침용 — /admin 아래라 hooks.server.ts 의 운영진 확인을 똑같이 거친다. 실시간 권한이 없으면 화면처럼 403 (DB 도 한 번 더 막는다) */
export const GET: RequestHandler = async ({ locals, url }) => {
	guard(locals, url);
	return json(await adminRpc<LiveUser[]>('admin_live_users', { p_staff: locals.staff!.id }));
};

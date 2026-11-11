import { redirect, type Handle, type HandleServerError, type RequestEvent } from '@sveltejs/kit';
import { readSessionDetails, clearSession } from '$lib/server/adminSession';
import { adminRpc } from '$lib/server/supabaseAdmin';
import { isStaffRole, type Perm, type TeamMember, type Todo } from '$lib/adminRoles';

/**
 * /admin 가드 (dabang-kiosk hooks.server.ts 구조 + 강화된 인증).
 *
 * 매 요청마다: ① 서명 쿠키 검증 → ② private.staff 명단 재확인.
 * 명단에서 빠지면 쿠키가 살아 있어도 즉시 차단된다.
 * 학생 앱 경로는 전혀 건드리지 않는다.
 */
const OPEN = new Set(['/admin/login', '/admin/session']);

type StaffTouch = {
	role: string;
	owner?: boolean;
	perms?: Perm[];
	maintenance?: boolean;
	maintenance_at?: string | null;
	team: TeamMember[];
	/** 메뉴의 밀린 일 수 (Phase 96) — 화면을 여는 요청에만. 옛 DB 면 없다 */
	todo?: Todo | null;
};

/** 페이지를 여는 요청만 활동 주소를 갱신한다. 현황 폴링·다운로드는 마지막 화면을 유지한다. */
function activityPath(event: RequestEvent) {
	const path = event.url.pathname;
	return event.request.method === 'GET' && !/\/(status|team|export|session)(\/|$)/.test(path)
		? path.replace(/\/__data\.json$/, '') || '/admin'
		: null;
}

/** 쿠키는 신원만 증명한다. 매 요청마다 DB 명단과 현재 권한을 확인한다. */
async function authenticateStaff(event: RequestEvent) {
	try {
		const session = await readSessionDetails(event.cookies);
		const valid = session && await adminRpc<boolean>('admin_session_valid', { p_user: session.userId, p_session: session.sessionId });
		if (session && !valid) clearSession(event.cookies);
		const uid = valid ? session!.userId : null;
		if (uid) {
			// 역할·권한 + 마지막 화면 + 운영진 현황을 한 번의 요청으로 받는다.
			const touch = await adminRpc<StaffTouch | null>('admin_staff_touch', { p_uid: uid, p_path: activityPath(event) });
			event.locals.maintenance = !!touch?.maintenance;
			event.locals.maintenanceAt = touch?.maintenance_at ?? null;
			if (touch && isStaffRole(touch.role)) {
				event.locals.staff = { id: uid, role: touch.role, owner: !!touch.owner, perms: touch.perms ?? [] };
				event.locals.team = touch.team;
				event.locals.todo = touch.todo ?? null;
			}
		}
	} catch (e) {
		// 설정 누락(서버 키·세션 비밀)은 로그인 화면에서 안내한다.
		return e instanceof Error ? e.message : String(e);
	}
	return null;
}

function securityHeaders(res: Response, isAdmin: boolean) {
	try {
		// 모든 화면 공통 — 틀(iframe) 안에 띄우기 금지(옛 브라우저용, 새 브라우저는 CSP frame-ancestors),
		// 파일 종류 추측 금지, 다른 사이트로 나갈 때 주소는 도메인까지만, 카메라·마이크·위치는 쓰지 않음
		res.headers.set('X-Frame-Options', 'DENY');
		res.headers.set('X-Content-Type-Options', 'nosniff');
		res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
		if (isAdmin) {
			// 운영자 화면은 신원 정보를 다루므로 어디에도 캐시되거나 검색되면 안 된다
			res.headers.set('Cache-Control', 'no-store');
			res.headers.set('X-Robots-Tag', 'noindex, nofollow');
			res.headers.set('Referrer-Policy', 'no-referrer');
		}
	} catch {
		/* 불변 헤더인 응답(리다이렉트 등)은 건너뛴다 */
	}
	return res;
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.staff = null;
	event.locals.team = null;
	event.locals.todo = null;
	event.locals.maintenance = false;
	event.locals.maintenanceAt = null;
	const path = event.url.pathname;
	const isAdmin = path === '/admin' || path.startsWith('/admin/');
	if (isAdmin) {
		const setupError = await authenticateStaff(event);
		if (!event.locals.staff && !OPEN.has(path)) {
			const q = setupError ? `?setup=${encodeURIComponent(setupError)}` : '';
			redirect(303, `/admin/login${q}`);
		}
	}

	// 운영자 화면은 서버에서 그릴 때부터 넓은 레이아웃(body.admin).
	const res = await resolve(
		event,
		isAdmin ? { transformPageChunk: ({ html }) => html.replace('<body ', '<body class="admin" ') } : undefined
	);
	return securityHeaders(res, isAdmin);
};

/**
 * 예상 못 한 서버 오류 — 원인은 서버 로그(Cloudflare Workers 로그)에 남기고, 화면에는 짧은 번호만.
 * 운영자가 번호를 알려 주면 로그에서 같은 번호로 찾을 수 있다.
 */
export const handleError: HandleServerError = ({ error, event, status }) => {
	const id = crypto.randomUUID().slice(0, 8);
	if (status !== 404) console.error(`[${id}] ${event.request.method} ${event.url.pathname}`, error);
	return { message: status === 404 ? '찾을 수 없는 주소' : `서버 오류 (${id})` };
};

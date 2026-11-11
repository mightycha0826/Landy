import type { LayoutServerLoad } from './$types';

/**
 * 운영자 화면 공통 — 역할 · 운영진 현황(오른쪽 판, Phase 49) · 메뉴의 밀린 일 수(Phase 96).
 * team · todo = hooks 의 역할 확인과 같은 요청(admin_staff_touch)으로 받아 둔 것. url 을 읽어서 화면을 옮길 때마다 새로 온다.
 * 역할마다 볼 수 있는 화면은 각 화면의 load 가 guard() 로 막는다 — 여기서 막으면 오류 화면이 운영자 틀(메뉴) 밖에 그려진다.
 */
export const load: LayoutServerLoad = ({ locals, url }) => {
	void url.pathname;
	return { staff: locals.staff, team: locals.team, todo: locals.todo, maintenance: locals.maintenance, maintenanceAt: locals.maintenanceAt };
};

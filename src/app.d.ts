declare global {
	namespace App {
		interface Locals {
			/** Phase 6: /admin 서버 가드가 채운다. 학생 앱 경로에서는 항상 null. */
			/** owner = 최고 관리자 (Phase 50 — 운영진을 지정 · 해제할 수 있는 단 한 사람) */
			staff: { id: string; role: import('$lib/adminRoles').StaffRole; owner?: boolean; perms: import('$lib/adminRoles').Perm[] } | null;
			/** Phase 49: 운영진 현황(오른쪽 판) — 역할 확인과 같은 요청(admin_staff_touch)으로 받는다 */
			team: import('$lib/adminRoles').TeamMember[] | null;
			/** Phase 96: 메뉴에 붙일 밀린 일 수 — 화면을 여는 요청에만 온다 (DB 가 Phase 96 전이면 null) */
			todo: import('$lib/adminRoles').Todo | null;
			/** Phase 52: 서버 점검 중 — 운영 화면 위 띠 */
			maintenance: boolean;
			/** Phase 53: 예약된 점검 시각 (아직 안 켜짐) */
			maintenanceAt: string | null;
		}
		/** 얕은 기록 항목 (pushState) — guard = 탭 첫 화면의 "뒤로가기 한 번 더" 표식 ((app)/+layout.svelte) */
		interface PageState {
			guard?: boolean;
			/** 방금 매칭돼서 들어가는 대화방 — 연결 화면을 한 번 보여 준다 (chat/[id]) */
			matched?: boolean;
			/** (쓰지 않음 — 예전 AI 대화 창. 대화 봇은 ov 로 닫힌다) */
			ai?: boolean;
			/** 열려 있는 겹친 창들 (시트 · 고르기 · 모달) — 뒤로가기로 맨 위부터 닫힌다 (lib/overlay.svelte.ts) */
			ov?: string[];
			/** 편지 쓰기 단계 — 뒤로가기로 받는 사람 고르기로 돌아간다 (letters/new) */
			compose?: boolean;
			/** 알림으로 앱을 새로 열어 깊은 화면에 곧장 들어왔다 — 뒤로가기는 홈으로 (lib/nav.ts) */
			deep?: boolean;
		}
		/** Cloudflare Workers — 응답 뒤에도 작업(푸시 발송)을 마저 하기 위해 · Workers AI 바인딩(wrangler.jsonc "ai") */
		interface Platform {
			context?: { waitUntil(p: Promise<unknown>): void };
			env?: { AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> } };
		}
	}

	interface Window {
		/** beforeinstallprompt 이벤트를 보관 (PWA 설치 게이트) */
		__installEvt?: BeforeInstallPromptEvent;
	}

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}
}

export {};

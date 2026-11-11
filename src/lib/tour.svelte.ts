import { page } from '$app/state';
import { onAccountChange } from './accountScope';
import { BADGE_TOUR } from './badgeTour.svelte';
import { lettersState } from './letters/gate.svelte';
import { S } from './state.svelte';

/**
 * 사용법 안내 (튜토리얼, Phase 44 · 89) — 탭마다 그 화면에 처음 왔을 때 한 단계씩 (lib/ui/Tour.svelte):
 * 홈(채팅) · 프로필(끝에 CNSA 뱃지 안내가 이어진다) · 익명편지. 건너뛰거나 끝까지 보면 이 기기에 "봤음".
 * 설정 › 앱 › "사용법 다시 보기"로 언제든 다시 (replayTour → 세 안내를 모두 처음부터, 홈으로 가면 홈 안내부터).
 * 자동 화면 테스트(navigator.webdriver)에서는 저절로 띄우지 않는다 — 모든 테스트가 안내를 먼저 닫아야 하므로. 주소에 ?tour 를 붙이면 띄운다.
 */
export type TourId = 'home' | 'me' | 'letters';
const KEYS: Record<TourId, string> = { home: 'tour-v1', me: 'tour-me-v1', letters: 'tour-letters-v1' };

/**
 * v = "봤음"이 바뀔 때마다 오른다 (저장소는 반응하지 않으므로) · hold = 화면이 곧 다른 곳으로 넘어간다 (알림에서 온 편지 꺼내기) — 안내를 띄우지 않는다
 * active = 지금 떠 있는 안내
 */
export const TOUR = $state({ replay: false, v: 0, hold: false, active: null as TourId | null });
onAccountChange(() => {
	TOUR.replay = TOUR.hold = false;
	TOUR.active = null;
});

function tourSeen(id: TourId): boolean {
	void TOUR.v;
	try {
		return localStorage.getItem(KEYS[id]) === '1';
	} catch {
		return true; // 저장소를 못 쓰면 매번 띄우지 않게
	}
}

export function markTourSeen(id: TourId) {
	TOUR.replay = false;
	try {
		localStorage.setItem(KEYS[id], '1');
	} catch {
		/* 무시 */
	}
	TOUR.v++;
}

/** 설정에서 — 세 안내를 모두 "안 봤음"으로. 다음에 그 탭에 가면 처음부터 */
export function replayTour() {
	try {
		for (const k of Object.values(KEYS)) localStorage.removeItem(k);
	} catch {
		/* 무시 */
	}
	TOUR.replay = true;
	TOUR.v++;
}

/** 저절로 띄워도 되는 환경인가 — 자동 테스트는 ?tour 가 있을 때만 */
const autoTourAllowed = () =>
	typeof navigator === 'undefined' || !navigator.webdriver || new URLSearchParams(location.search).has('tour');

/**
 * 지금 화면에서 떠야 하는 안내 (없으면 null) — 그 탭에서, 시작하기(온보딩)를 마친 뒤, 이 기기에서 처음(또는 다시 보기).
 * 편지 안내는 편지가 열려 있을 때만 — 잠겨 있으면 비출 자리가 없다
 */
export function tourDue(): TourId | null {
	const path = page.url.pathname;
	const id: TourId | null = path === '/' ? 'home' : path === '/me' ? 'me' : path === '/letters' && lettersState() === 'open' ? 'letters' : null;
	const ready = !!S.profile?.onboarded && S.me !== null && !TOUR.hold;
	return id && ready && !tourSeen(id) && (TOUR.replay || autoTourAllowed()) ? id : null;
}

/**
 * 안내가 뜰 차례거나 떠 있다 — 다른 저절로 뜨는 창(업적 축하 · 매너 평가 · 알림 권한)은 그 뒤에 (한 번에 하나, UX G8).
 * ★ 값을 effect 로 적어 두지 않고 그때그때 계산한다 — effect 로 적으면 다른 창의 {#if} 가 그 effect 보다 먼저 다시 그려져
 *   (Svelte 는 effect 안에서 바뀐 값에 딸린 블록을 곧바로 그린다) 안내보다 먼저 떴다가 사라진다.
 */
export const touring = () => tourDue() !== null || TOUR.active !== null || BADGE_TOUR.open;

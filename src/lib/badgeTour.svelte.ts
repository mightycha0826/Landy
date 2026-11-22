import { onAccountChange } from './accountScope';
import { S, UI } from './state.svelte';
import { supabase } from './supabase';

/**
 * CNSA 뱃지 안내 (Phase 84 · 89) — 프로필 안내(lib/ui/Tour.svelte)의 끝에 이어서 한 번 (lib/ui/CnsaBadgeTour.svelte).
 * 끝까지 보거나 닫으면 이 기기의 이 계정에 "봤음" — 이미 봤으면 프로필 안내에서 다시 잇지 않는다. 업적 화면 CNSA 탭 · 설정 › 뱃지에서 언제든 다시.
 * (Phase 84 에는 CNSA 뱃지를 처음 받았을 때 축하 창 뒤에 저절로 떴다 — 처음 가입하면 안내 · 축하 · 알림 안내와 한꺼번에 겹쳐서 옮겼다.)
 * 첫 뱃지(개척자, 금이면 기본 CNSA 뱃지까지)는 가입할 때가 아니라 이 안내가 끝난 뒤에 받는다 (Phase 97, claimWelcomeBadges).
 */
const KEY = 'cnsa-tour-v1';
const CLAIMED = 'welcome-badges-v1';

export const BADGE_TOUR = $state({ open: false });
onAccountChange(() => { BADGE_TOUR.open = false; });

export function badgeTourSeen(): boolean {
	if (!S.session) return true;
	try {
		return localStorage.getItem(`${KEY}:${S.session.user.id}`) === '1';
	} catch {
		return true;
	}
}

export function openBadgeTour() {
	BADGE_TOUR.open = true;
}

export function closeBadgeTour() {
	BADGE_TOUR.open = false;
	try {
		if (S.session) localStorage.setItem(`${KEY}:${S.session.user.id}`, '1');
	} catch {
		/* 무시 */
	}
}

let claiming = false;
/** 프로필 · 뱃지 안내가 끝나면 첫 뱃지를 받는다 — 서버가 계정당 한 번만 준다. 못 받았으면 다음에 앱을 열 때 다시 */
export async function claimWelcomeBadges() {
	const uid = S.session?.user.id;
	if (!uid || claiming) return;
	const key = `${CLAIMED}:${uid}`;
	try {
		if (localStorage.getItem(key) === '1') return;
	} catch {
		/* 저장소가 없어도 서버가 한 번만 준다 */
	}
	claiming = true;
	try {
		const { data, error } = await supabase.rpc('claim_welcome_badges');
		if (error) return;
		try {
			localStorage.setItem(key, '1');
		} catch {
			/* 무시 */
		}
		if ((data as { status?: string } | null)?.status === 'ok' && S.session?.user.id === uid) UI.achNew = true; // 축하 창
	} catch {
		/* 네트워크 — 다음에 다시 */
	} finally {
		claiming = false;
	}
}

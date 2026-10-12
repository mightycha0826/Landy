import type { Component } from 'svelte';
import Beatus from './Beatus.svelte';
import CnsaCube from './CnsaCube.svelte';
import Geukjakso from './Geukjakso.svelte';
import Library from './Library.svelte';
import MsmpGold from './MsmpGold.svelte';
import Pumgyeok from './Pumgyeok.svelte';
import Ssc1500 from './Ssc1500.svelte';

/**
 * CNSA 뱃지 (Phase 70 · 71 · 90) — 학교 · 동아리 · 행사의 실제 에나멜 핀을 그대로 그린 것. 동그란 메달 대신 이 그림을 쓴다 (Badge.svelte).
 * 코드는 private.achievement_defs 의 code (category 'cnsa', 운영진이 준다). 새 뱃지는 그림 컴포넌트를 만들어 여기에 더한다.
 */
export const PIN_BADGES: Record<string, Component<{ shine?: boolean; delay?: number }>> = {
	cnsa_student: CnsaCube,
	msmp_gold: MsmpGold,
	club_beatus: Beatus,
	club_geukjakso: Geukjakso,
	club_library: Library,
	cert_1500m: Ssc1500,
	pumgyeok: Pumgyeok
};

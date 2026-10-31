import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { S } from '../state.svelte';
import { accountIsCurrent, accountToken, currentAccountId, onAccountChange } from '../accountScope';

/**
 * 익명편지 잠금 (Phase 44) — 가입한 학생이 적을 때는 편지를 누가 보냈는지 쉽게 짐작된다.
 * 운영 설정에서 잠금(app_settings.letters_gate)을 켜 두면, 가입한 학생(학교 인증 + 시작하기)이 letters_gate_min 명이 될 때까지
 * 익명편지 탭이 "모이면 열려요" 화면이 된다. 서버도 같은 규칙으로 쓰기 · 찾기를 막는다 (private.letters_locked).
 *
 * 가입 인원은 한 줄 표(signup_stats)를 한 번 읽고, 숫자가 바뀌면 DB 가 signups 채널(비공개)에 방송한다(Phase 55) —
 * 누가 가입하면 숫자가 바로 오른다 (주기 요청 없음).
 * 앱으로 돌아올 때만 한 번 더 읽는다 (내려 둔 사이 Realtime 이 끊겼을 수 있다). 한 번 열린 걸 보면 이번에 켠 동안은 다시 묻지 않는다.
 */
export const GATE = $state({ students: null as number | null, opened: false });
onAccountChange(() => { GATE.students = null; GATE.opened = false; });

export const gateOn = () => S.settings?.letters_gate === true;
export const gateMin = () => S.settings?.letters_gate_min ?? 100;

/** open · locked · checking(가입 인원을 읽는 중) */
export function lettersState(): 'open' | 'locked' | 'checking' {
	if (!gateOn() || GATE.opened) return 'open';
	if (GATE.students === null) return 'checking';
	if (GATE.students >= gateMin()) return 'open';
	return 'locked';
}

async function load() {
	if (!currentAccountId()) return;
	const token = accountToken();
	const { data, error } = await supabase.from('signup_stats').select('students').maybeSingle();
	// 못 읽었으면 판단을 미룬다 — 열린 것으로 치면 편지를 다 쓴 뒤에야 서버가 "잠겨 있어요"라고 거절한다. 앱으로 돌아올 때 다시 읽는다
	if (!accountIsCurrent(token) || error) return;
	const n = (data as { students: number } | null)?.students;
	// 통계 행이 없으면 서버도 잠근다 (private.letters_locked 의 coalesce(…, true), R24) — 화면도 같이
	GATE.students = typeof n === 'number' ? n : 0;
	if (GATE.students >= gateMin()) GATE.opened = true;
}

/** 앱을 켤 때 한 번 — 잠금이 켜져 있으면 지금 열렸는지 (편지 탭 빨간 점 · 안 읽은 편지 확인을 할지) */
export function checkGate() {
	if (gateOn() && !GATE.opened && GATE.students === null) void load();
}

/** 잠금 화면이 떠 있는 동안 — 가입 인원을 실시간으로. 돌려준 함수로 멈춘다 */
export function watchSignups(): () => void {
	if (!gateOn() || GATE.opened) return () => {};
	const token = accountToken();
	void load();
	const ch: RealtimeChannel = supabase
		.channel('signups', { config: { private: true } })
		.on('broadcast', { event: 'students' }, ({ payload }) => {
			if (!accountIsCurrent(token)) return;
			const n = (payload as { students?: number } | undefined)?.students;
			if (typeof n !== 'number') return;
			GATE.students = n;
			if (n >= gateMin()) GATE.opened = true;
		})
		.subscribe();
	const onVis = () => {
		if (accountIsCurrent(token) && document.visibilityState === 'visible') void load();
	};
	document.addEventListener('visibilitychange', onVis);
	return () => {
		document.removeEventListener('visibilitychange', onVis);
		void supabase.removeChannel(ch);
	};
}

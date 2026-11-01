export type AppSettings = {
	is_open: boolean;
	notice: string;
	room_minutes: number;
	extend_minutes: number;
	vote_window_sec: number;
	max_rounds: number;
	rematch_cooldown_days: number;
	auto_suspend_reports: number;
	max_open_rooms: number;
	/** Phase 19 — DB 패치 전이면 없음 */
	ai_moderation?: boolean;
	ai_mod_daily_cap?: number;
	ai_chat?: boolean;
	ai_chat_per_user?: number;
	ai_chat_daily_cap?: number;
	ai_chat_minutes?: number;
	ai_chat_max_turns?: number;
	/** Phase 44 — 익명편지 잠금 */
	letters_gate?: boolean;
	letters_gate_min?: number;
	/** Phase 52 · 53 — 서버 점검 · 예약 */
	maintenance?: boolean;
	maintenance_msg?: string;
	maintenance_until?: string | null;
	maintenance_at?: string | null;
	/** Phase 91 — 동아리 뱃지 출시 */
	club_badges?: boolean;
};

export type AiUsage = {
	mod_checked_today: number;
	mod_flagged_today: number;
	mod_pending: number;
	ai_chats_today: number;
};

export const AI_INTEGER_FIELDS = [
	['ai_mod_daily_cap', 0, 100000],
	['ai_chat_per_user', 0, 50],
	['ai_chat_daily_cap', 0, 100000],
	['ai_chat_minutes', 1, 30],
	['ai_chat_max_turns', 1, 100]
] as const satisfies readonly (readonly [keyof AppSettings, number, number])[];

export const INTEGER_FIELDS = [
	['room_minutes', 1, 60],
	['extend_minutes', 1, 60],
	['vote_window_sec', 15, 300],
	['max_rounds', 0, 50],
	['rematch_cooldown_days', 0, 365],
	['auto_suspend_reports', 1, 50],
	['max_open_rooms', 1, 20]
] as const satisfies readonly (readonly [keyof AppSettings, number, number])[];

/** datetime-local은 시간대가 없으므로 운영진의 한국 시각으로 읽는다. */
function koreanDate(form: FormData, name: string): Date | null {
	const value = String(form.get(name) ?? '').trim();
	return value ? new Date(`${value}:00+09:00`) : null;
}

/** 점검 끄기·예약·바로 시작하기의 설정 패치. 현재 시각은 로컬 검증에서도 고정할 수 있다. */
export function maintenanceInput(form: FormData, now = Date.now()):
	| { patch: Record<string, unknown>; on: boolean; startsAt: Date | null }
	| { error: string } {
	const on = form.get('on') === 'true';
	const msg = String(form.get('msg') ?? '').trim().slice(0, 300);
	const until = koreanDate(form, 'until');
	const at = koreanDate(form, 'at');
	if ((until && Number.isNaN(until.getTime())) || (at && Number.isNaN(at.getTime()))) {
		return { error: '시각을 확인해 주세요' };
	}
	const later = !!at && at.getTime() > now + 30_000;
	if (on && later && until && until <= at!) {
		return { error: '끝나는 시각은 시작 시각보다 뒤여야 해요' };
	}
	// 끄기 = 점검·예약 해제. 예약 = 시각만 설정. 지금 = 점검을 켜고 예약 해제.
	const patch: Record<string, unknown> = !on
		? { maintenance: false, maintenance_at: '' }
		: { maintenance: !later, maintenance_at: later ? at!.toISOString() : '', maintenance_msg: msg, maintenance_until: until ? until.toISOString() : '' };
	return { patch, on, startsAt: on && later ? at : null };
}

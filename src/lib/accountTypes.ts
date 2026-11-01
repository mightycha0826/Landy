/** 내 프로필. 상대에게는 nickname·bio·interests·mbti 만 partner_profile() 을 거쳐 보인다 (성별·선호·상태는 안 보인다). */
export type Profile = {
	id: string;
	/** 계정의 고유 익명 이름 — 가입할 때 서버가 정하고 바꿀 수 없다 */
	nickname: string | null;
	bio: string;
	interests: string[];
	mbti: string | null;
	gender: 'm' | 'f' | 'x';
	want: 'm' | 'f' | 'any';
	status: 'active' | 'suspended' | 'banned';
	suspended_until: string | null;
	verified: boolean;
	onboarded: boolean;
	/** 만났던 사람도 다시 만나기 (설정) — 둘 다 켰을 때만 최근 상대와 다시 매칭 (Phase 21) */
	allow_rematch?: boolean;
	/** 편지 받기 (설정) — 끄면 검색에 나오지 않고 새 편지를 받지 않는다 (Phase 23) */
	letters_open?: boolean;
	/** 매너 온도 (Phase 30) — 서버만 바꾼다 */
	manner_temp?: number;
	/** 편지 쓰기 찾기 화면의 추천에 나오기 (설정, Phase 84 — 기본 켜짐) */
	letters_recommend?: boolean;
	/** 편지 찾기 · 추천에 보이는 내 뱃지 순서 — 내 순서 / 무작위 (Phase 84) */
	letter_badge_order?: 'mine' | 'random';
};

export type Settings = {
	is_open: boolean;
	notice: string;
	room_minutes: number;
	extend_minutes: number;
	vote_window_sec: number;
	join_grace_sec: number;
	max_rounds: number;
	heartbeat_sec: number;
	presence_ttl_sec: number;
	msg_max_len: number;
	max_open_rooms: number;
	/** Phase 19 — DB 에 아직 없으면(패치 전) undefined */
	ai_moderation?: boolean;
	ai_chat?: boolean;
	ai_chat_per_user?: number;
	/** Phase 44 — 익명편지 잠금: 켜져 있으면 가입한 학생이 letters_gate_min 명이 될 때까지 편지가 잠긴다 (lib/letters/gate.svelte.ts) */
	letters_gate?: boolean;
	letters_gate_min?: number;
	/** Phase 52 — 서버 점검 */
	maintenance?: boolean;
	maintenance_msg?: string;
	maintenance_until?: string | null;
	/** Phase 53 — 점검 예약 (이 시각부터 저절로 점검 중) */
	maintenance_at?: string | null;
	/** Phase 84 — 뱃지 사진을 받는 인스타그램 계정 (비어 있으면 "준비 중") */
	badge_instagram?: string | null;
	/** Phase 91 — 동아리 뱃지 출시 (꺼져 있으면 학생 화면에서 숨김, lib/achievements.ts noClubs). SQL 전 실DB 면 없음 */
	club_badges?: boolean;
};


import { rpc } from './rpc';
import { onAccountChange } from './accountScope';
import { S } from './state.svelte';

/**
 * 업적 (Phase 31) — 동 · 은 · 금 메달. 업적 정의(이름 · 기준)는 DB 가 유일한 출처라 여기엔 타입과 RPC · 표시용 도움 함수만.
 * 서버: supabase/schema.sql Phase 31 (private.achievement_defs · user_stats · user_achievements).
 */
export type Tier = 0 | 1 | 2 | 3;
/** cnsa — 학교 동아리 · 행사 뱃지 (Phase 70, 운영진이 준다 · 실제 핀 모양) */
export type Category = 'chat' | 'manner' | 'letter' | 'special' | 'cnsa';

/** 상대 프로필 · 대표 업적에 쓰는 짧은 모양 */
export type BadgeLite = { code: string; title: string; icon: string; tier: Tier };

/** 업적 정의 — 이름 · 설명 · 등급 기준 (누구의 것도 아닌 공개 정보, achievement_catalog) */
export type AchievementDef = {
	code: string;
	title: string;
	icon: string;
	description: string;
	category: Category;
	unit: string;
	/** 개척자처럼 작을수록 좋은 것 */
	lower_better: boolean;
	/** [동, 은, 금] 기준 */
	tiers: [number, number, number];
	/** 운영진이 주는 특별 업적 (Phase 44, 베타 테스터) — 등급 기준이 없다 */
	granted?: boolean;
};

export type Achievement = BadgeLite &
	AchievementDef & {
		earned_at: string | null;
		value: number;
		/** 마지막으로 본 뒤에 새로 땄거나 올랐다 */
		new: boolean;
	};

export type MyAchievements = {
	items: Achievement[];
	featured: BadgeLite[];
	chosen: string[];
	/** 대표 뱃지 칸 — 3, Landy 금 뱃지 5개면 5 (Phase 84) */
	slots?: number;
	/** Landy 금 뱃지 수 (운영진이 주는 특별 · CNSA 빼고) */
	golds?: number;
	/** 가진 뱃지마다 랜덤채팅에 보이는지 — 정하지 않았으면 CNSA 는 숨김 */
	chat?: Record<string, boolean>;
};

/** 금 뱃지 몇 개면 칸이 5개가 되나 */
export const GOLDS_FOR_FIVE = 5;
export const slotsOf = (d: Pick<MyAchievements, 'slots'> | null | undefined) => d?.slots ?? 3;

export const TIER_NAME: Record<Tier, string> = { 0: '잠김', 1: '동', 2: '은', 3: '금' };

export const CATEGORIES: { k: Category | 'all'; label: string }[] = [
	{ k: 'all', label: '전체' },
	{ k: 'chat', label: '대화' },
	{ k: 'manner', label: '매너' },
	{ k: 'letter', label: '편지' },
	{ k: 'special', label: '특별' },
	{ k: 'cnsa', label: 'CNSA' }
];

/**
 * 동아리 뱃지(club_) — 관리자 설정 "동아리 뱃지 출시"(app_settings.club_badges, Phase 91)가 꺼져 있으면 학생 화면 어디에도 보이지 않는다.
 * 서버에서 오는 뱃지 목록은 noClubs 를 거쳐 그린다. 개발 미리보기(/dev/*)는 가짜 데이터를 바로 넘겨 그대로 보인다.
 * 도서부의 옛 코드(club_library — Phase 91 SQL 전 실DB)는 동아리 뱃지가 아니다.
 */
export const isClub = (code: string) => code.startsWith('club_') && code !== 'club_library';
export const clubsReleased = () => !!S.settings?.club_badges;
export const noClubs = <T extends { code: string }>(xs: T[]) => (clubsReleased() ? xs : xs.filter((x) => !isClub(x.code)));

/** 비어 있으면(Phase 31 전 DB 등) 오류로 — 화면이 "불러오지 못했어요"를 띄운다 */
export async function fetchMyAchievements(): Promise<MyAchievements> {
	const r = await rpc<MyAchievements | null>('my_achievements');
	if (!r?.items) throw new Error('no_achievements');
	const d = { ...r, items: noClubs(r.items), featured: noClubs(r.featured ?? []), chosen: clubsReleased() ? (r.chosen ?? []) : (r.chosen ?? []).filter((c) => !isClub(c)) };
	FAME.last = d;
	return d;
}
/** 마지막으로 읽은 내 업적 — 프로필을 다시 열 때 교복의 배지가 바로 보이게 (그 뒤 새로 읽어 맞춘다) */
export const FAME = { last: null as MyAchievements | null };
onAccountChange(() => (FAME.last = null));
/** 새로 딴 업적 — Phase 31 전 DB 면 빈 목록 */
export const fetchNewAchievements = () =>
	rpc<BadgeLite[] | null>('new_achievements').then((r) => noClubs(r ?? []), () => [] as BadgeLite[]);
export const markAchievementsSeen = () => rpc<void>('mark_achievements_seen');
export const setFeaturedBadges = (codes: string[]) =>
	rpc<{ status: 'ok' | 'too_many' | 'not_owned'; featured?: BadgeLite[] }>('set_featured_badges', { p_codes: codes });
/** 대표 뱃지를 못 바꿨을 때 알림 글 */
export const featuredError = (status: string, slots = 3) => (status === 'too_many' ? `대표 업적은 ${slots}개까지예요` : '아직 딴 업적이 아니에요');
/** 랜덤채팅에서 이 뱃지 보이기 · 숨기기 (Phase 84 — 가진 뱃지만) */
export const setBadgeChat = (code: string, show: boolean) => rpc<{ status: 'ok' | 'not_owned' }>('set_badge_chat', { p_code: code, p_show: show });

/**
 * 업적 카탈로그 (Phase 44) — 남의 메달을 눌렀을 때 설명 · 기준을 그린다. 앱을 켠 동안 한 번만 받는다 (정의는 거의 안 바뀐다).
 * 받는 중이면 같은 약속을 돌려준다 — 메달을 여러 번 눌러도 요청은 하나
 */
let catalog: Promise<Map<string, AchievementDef>> | null = null;
export function fetchCatalog(): Promise<Map<string, AchievementDef>> {
	catalog ??= rpc<AchievementDef[] | null>('achievement_catalog').then(
		(r) => new Map((r ?? []).map((d) => [d.code, d])),
		(e) => {
			catalog = null; // 실패하면 다음에 다시
			throw e;
		}
	);
	return catalog;
}

/** 대표 업적 걸기 · 내리기 — 걸면 맨 앞, 칸 수(3 · 5)까지. 고른 것이 없으면(자동) 지금 보이는 대표 업적에서 시작한다 */
export function toggledFeatured(data: Pick<MyAchievements, 'chosen' | 'featured' | 'slots'>, code: string): string[] {
	const base = data.chosen.length ? [...data.chosen] : data.featured.map((b) => b.code);
	return base.includes(code) ? base.filter((c) => c !== code) : [code, ...base].slice(0, slotsOf(data));
}

/**
 * 대표 업적 칸 옮기기 (Phase 69 — 교복 깃으로 끌어 놓기). 보이는 칸 순서 그대로 서버에 보내 자리를 고정한다.
 *  · 이미 대표인 배지를 다른 칸에 놓으면 그 칸의 배지와 자리를 맞바꾼다 (빈 칸이면 맨 뒤로)
 *  · 대표가 아닌 메달을 놓으면 그 칸의 배지를 밀어내고 앉는다 (빈 칸이면 뒤에 붙는다)
 */
export function placedFeatured(data: Pick<MyAchievements, 'featured' | 'slots'>, code: string, slot: number): string[] {
	const cur = data.featured.map((b) => b.code);
	const from = cur.indexOf(code);
	if (from >= 0) {
		if (slot >= cur.length) return [...cur.filter((c) => c !== code), code];
		[cur[from], cur[slot]] = [cur[slot], cur[from]];
		return cur;
	}
	if (slot >= cur.length) return [...cur, code].slice(0, slotsOf(data));
	cur[slot] = code;
	return cur;
}

/** 대표 업적 코드 → 교복에 그릴 배지 (서버 대답을 기다리지 않고 바로 보여 줄 때) */
export const featuredOf = (items: BadgeLite[], codes: string[]): BadgeLite[] =>
	codes.flatMap((c) => {
		const a = items.find((x) => x.code === c);
		return a ? [{ code: a.code, title: a.title, icon: a.icon, tier: a.tier }] : [];
	});

/** 다음 등급 기준 (금이면 null) */
function nextGoal(a: Achievement): number | null {
	return a.tier >= 3 ? null : a.tiers[a.tier as 0 | 1 | 2];
}

/** 다음 등급까지 얼마나 왔는지 (0~1) — 작을수록 좋은 것(개척자)은 이미 정해져 있어 따로 채우지 않는다 */
export function progress(a: Achievement): number {
	if (a.granted) return a.tier > 0 ? 1 : 0;
	if (a.tier >= 3) return 1;
	if (a.lower_better) return a.tier > 0 ? 1 : 0;
	const goal = a.tiers[a.tier as 0 | 1 | 2];
	const from = a.tier > 0 ? a.tiers[a.tier - 1] : 0;
	return Math.max(0, Math.min(1, (a.value - from) / Math.max(1, goal - from)));
}

/** "12 / 20번" · "41.2 / 42도" · "가입 7번째" */
export function progressText(a: Achievement): string {
	if (a.granted) return a.tier > 0 ? '받음' : '특별 업적';
	const v = a.unit === '도' ? a.value.toFixed(1) : String(Math.floor(a.value));
	if (a.lower_better) return `가입 ${v}${a.unit}`;
	const goal = nextGoal(a);
	return goal == null ? `${v}${a.unit} · 최고 등급` : `${v} / ${goal}${a.unit}`;
}

/** 등급 기준 한 줄 — "동 5번 · 은 20번 · 금 50번" / 개척자 "1000번째 안" */
export function tierLine(a: AchievementDef, t: 1 | 2 | 3): string {
	const n = a.tiers[t - 1];
	return a.lower_better ? `${n}${a.unit} 안` : `${n}${a.unit}`;
}

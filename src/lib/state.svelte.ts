import type { Session } from '@supabase/supabase-js';
import { hasSupabase, supabase } from './supabase';
import { rpc } from './rpc';
import { disablePush, syncPush } from './push';
import { accountIsCurrent, accountToken, changeAccount } from './accountScope';
import { toasts } from './toast.svelte';
import type { Profile, Settings } from './accountTypes';

export type { Profile, Settings } from './accountTypes';
export { errMsg } from './errors';

export const S = $state({
	booted: false,
	bootError: null as string | null,
	session: null as Session | null,
	accountVersion: 0,
	profile: null as Profile | null,
	settings: null as Settings | null,
	/** 로그인 직후 프로필 · 설정을 불러오는 중 — 이 동안은 스플래시 (홈이 "계정 정보를 불러오지 못함"으로 번쩍이지 않게) */
	profileLoading: false,
	/** 비밀번호를 설정했는지 — 안 했으면 다음 로그인도 인증 코드로 해야 한다 */
	hasPassword: null as boolean | null,
	/**
	 * 내 이름 (Phase 23 이름 편지) — 명렬표(학번)에서 오거나(roster), 명렬표에 없으면 한 번 직접 적는다(self).
	 * undefined = 아직 모름(또는 DB 가 Phase 23 전), null = 이름이 없어 적어야 함
	 */
	me: undefined as { name: string; grade: number | null; source: 'roster' | 'self' } | null | undefined,
	/**
	 * 서버 점검 중 (Phase 52) — 켜져 있으면 앱 전체가 점검 화면. 앱을 열 때 설정으로, 그 뒤엔 1분마다 보내는 heartbeat 의 대답으로 안다
	 * (점검이 끝나면 다음 박동에 저절로 풀린다). null = 점검 아님
	 */
	maint: null as { msg: string; until: string | null } | null,
	/** 예약된 점검 시각 (Phase 53) — 24시간 안이면 홈에 미리 알린다. null = 예약 없음 */
	maintAt: null as string | null,
	/** 전역 1초 틱. 카운트다운·상대시간 표시가 여기에 붙는다. */
	now: Date.now()
});

/** 순수 UI 상태 — 서버와 무관 */
export const UI = $state({
	standalone: true, // 설치 게이트. 부팅 시 실제 값으로 덮인다.
	installEvt: null as BeforeInstallPromptEvent | null,
	busy: false,
	/** 로그인 직후 갈 곳 — 비밀번호 찾기로 들어왔으면 새 비밀번호 화면으로 */
	afterLogin: null as string | null,
	/**
	 * 축하할 새 업적이 있다 (떠 있거나, 안내 뒤에서 기다린다) — 저절로 뜨는 창은 한 번에 하나 (튜토리얼 > 축하 > 매너 평가 > 알림 권한, UX G8).
	 * 튜토리얼이 뜰 차례인지는 lib/tour.svelte.ts 의 touring()
	 */
	celebrating: false,
	/** 대화방에서 "새 대화 찾기"로 홈에 돌아왔다 — 홈이 바로 찾기를 시작한다 (lib/nav.ts backToSeek) */
	seekOnHome: false,
	/** 새로 딴 업적이 있다 (Phase 55) — 박동 대답(ach_new)으로 안다. 축하 창이 받아 가면 false */
	achNew: false
});

// ── 토스트 ────────────────────────────────────────────────────────────
// 의존성 없는 별도 모듈로 분리 (브라우저 모드로 직접 테스트하기 위해). 기존 import 경로는 그대로 쓴다.
export { toast, toasts } from './toast.svelte';

// ── 부팅 ──────────────────────────────────────────────────────────────
let ticker: ReturnType<typeof setInterval> | null = null;
let initializing: Promise<void> | null = null;
let listening = false;

/** 개발 미리보기도 서버 로그인 없이 남은 시간을 표시한다. */
export function startClock() {
	if (!ticker) ticker = setInterval(() => (S.now = Date.now()), 1000);
}

export async function init() {
	if (initializing) return initializing;
	if (S.booted && !S.bootError) return;
	initializing = initialize().finally(() => { initializing = null; });
	return initializing;
}

async function initialize() {
	startClock();

	detectStandalone();

	if (!hasSupabase) {
		S.booted = true;
		return;
	}

	if (!listening) supabase.auth.onAuthStateChange((event, sess) => {
		selectSession(sess);
		if (sess && event !== 'TOKEN_REFRESHED') {
			// 등록하자마자 INITIAL_SESSION 이 오고, 탭으로 돌아올 때 SIGNED_IN 이 다시 오기도 한다 —
			// 같은 계정이면 위에서 이미 불러왔으니 건너뛴다 (예전엔 앱을 열 때마다 부팅 요청이 두 번씩 나갔다)
			void afterLogin(sess.user.id);
		}
	});
	listening = true;
	try {
		const { data: { session }, error } = await supabase.auth.getSession();
		if (error) throw error;
		selectSession(session);
		S.bootError = null;
		if (session) await afterLogin(session.user.id);
	} catch {
		S.bootError = '로그인 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
	} finally {
		S.booted = true;
	}

	startHeartbeat();
}

/** 부팅 요청을 이미 보낸 계정 — 같은 계정으로 또 오면 건너뛴다 */
let loadedFor: string | null = null;
let loading: { uid: string; token: number; work: Promise<void> } | null = null;

/** 계정이 바뀌면 전역 캐시와 화면 수명을 함께 바꾼다. 토큰 갱신은 같은 계정이다. */
function selectSession(session: Session | null) {
	const previous = S.session?.user.id;
	if (changeAccount(session?.user.id ?? null)) {
		S.accountVersion = accountToken();
		S.profile = null;
		S.settings = null;
		S.hasPassword = null;
		S.me = undefined;
		S.maint = null;
		S.maintAt = null;
		S.profileLoading = false;
		S.bootError = null;
		loadedFor = null;
		otpVerifiedAt = 0;
		UI.busy = UI.celebrating = UI.seekOnHome = UI.achNew = false;
		if (previous) UI.afterLogin = null;
		toasts.splice(0);
	}
	S.session = session;
}

async function afterLogin(uid: string) {
	if (loadedFor === uid) return;
	const token = accountToken();
	if (loading?.uid === uid && loading.token === token) return loading.work;
	const work = loadAccountData(uid, token);
	loading = { uid, token, work };
	await work;
	if (loading?.work === work) loading = null;
}

async function loadAccountData(uid: string, token: number) {
	S.profileLoading = true;
	S.bootError = null;
	try {
		// 트리거가 못 만든 경우를 대비한 폴백 (gyeol ensureProfile 패턴). 익명 이름도 여기서 보장된다.
		const { error } = await supabase.rpc('ensure_self');
		if (error) throw error;
		if (!accountIsCurrent(token)) return;
		const results = await Promise.allSettled([loadProfile(), loadSettings(), loadAccount()]);
		if (results.some((r) => r.status === 'rejected')) throw new Error('account_load_failed');
		if (accountIsCurrent(token)) loadedFor = uid;
	} catch {
		if (accountIsCurrent(token)) S.bootError = '계정 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
		return;
	} finally {
		if (accountIsCurrent(token)) S.profileLoading = false;
	}
	if (!accountIsCurrent(token)) return;
	void beat(true);
	// 이미 알림을 허락한 기기면 이 계정으로 구독을 다시 저장 (기기 주인이 바뀌었을 수도 있다)
	void syncPush().catch(() => {});
}

export async function retryAccount() {
	if (S.profileLoading) return;
	if (S.session) {
		loadedFor = null;
		await afterLogin(S.session.user.id);
	} else await init();
}

export async function loadProfile() {
	const uid = S.session?.user.id;
	if (!uid) return;
	const token = accountToken();
	// ★ select('*') 를 쓰지 않는다. 항상 명시 컬럼.
	const cols = 'id, nickname, bio, interests, mbti, gender, want, status, suspended_until, verified, onboarded';
	const read = (c: string) => supabase.from('profiles').select(c).eq('id', uid).maybeSingle();
	const { data, error } = await read(`${cols}, allow_rematch, letters_open, manner_temp, letters_recommend, letter_badge_order`);
	if (error) throw error;
	if (!data) throw new Error('profile_missing');
	if (accountIsCurrent(token)) S.profile = (data as unknown as Profile) ?? null;
}

type ProfilePreferences = Partial<Pick<Profile, 'want' | 'allow_rematch' | 'letters_open' | 'letters_recommend' | 'letter_badge_order'>>;

/** 본인 행만 수정하고 같은 계정으로 남아 있을 때 프로필을 다시 읽는다. */
async function updateProfile(patch: ProfilePreferences | Pick<Profile, 'gender' | 'want' | 'onboarded'>) {
	const uid = S.session?.user.id;
	if (!uid) throw new Error('unauthenticated');
	const token = accountToken();
	const { error } = await supabase.from('profiles').update(patch).eq('id', uid);
	if (error) throw error;
	if (accountIsCurrent(token)) await loadProfile();
}

/** 설정 스위치와 매칭 선호 — 상태·인증 여부 같은 서버 전용 열은 받지 않는다. */
export const setProfileField = (patch: ProfilePreferences) => updateProfile(patch);


const SETTINGS_COLS =
	'is_open, notice, room_minutes, extend_minutes, vote_window_sec, join_grace_sec, max_rounds, heartbeat_sec, presence_ttl_sec, msg_max_len, max_open_rooms';
async function loadSettings() {
	const token = accountToken();
	const read = (cols: string) => supabase.from('app_settings').select(cols).maybeSingle();
	const AI = 'ai_moderation, ai_chat, ai_chat_per_user';
	const MAINT = 'maintenance, maintenance_msg, maintenance_until';
	const { data, error } = await read(`${SETTINGS_COLS}, ${AI}, letters_gate, letters_gate_min, ${MAINT}, maintenance_at, badge_instagram`);
	if (error) throw error;
	if (!data) throw new Error('settings_missing');
	if (!accountIsCurrent(token)) return;
	S.settings = (data as unknown as Settings) ?? null;
	// 예약 시각이 지났으면 점검 중 (Phase 53 — DB 의 private.in_maintenance 와 같은 규칙)
	const at = S.settings?.maintenance_at ? new Date(S.settings.maintenance_at).getTime() : null;
	const on = !!S.settings?.maintenance || (at !== null && at <= Date.now());
	setMaint(on ? { msg: S.settings?.maintenance_msg ?? '', until: S.settings?.maintenance_until ?? null } : null);
	S.maintAt = !on && at !== null && at - Date.now() < 86_400_000 ? S.settings!.maintenance_at! : null;
}

/** 점검 상태 바꾸기 — 바뀔 때만 (같은 값을 다시 넣어 화면을 다시 그리지 않게) */
function setMaint(m: { msg: string; until: string | null } | null) {
	if (JSON.stringify(m) !== JSON.stringify(S.maint)) S.maint = m;
}

export async function loadAccount() {
	if (!S.session) return;
	const token = accountToken();
	const { data, error } = await supabase.rpc('my_account');
	if (error) throw error;
	if (!data) throw new Error('account_missing');
	if (!accountIsCurrent(token)) return;
	const a = data as { has_password?: boolean; name?: string | null; grade?: number | null; name_source?: 'roster' | 'self' } | null;
	S.hasPassword = a?.has_password ?? null;
	// 'name' 키가 없으면 DB 가 Phase 23 전 — 이름을 묻지 않는다
	S.me = !a || !('name' in a) ? undefined : a.name ? { name: a.name, grade: a.grade ?? null, source: a.name_source ?? 'self' } : null;
}

/** 명렬표에 없는 사람만 — 이름을 한 번 적는다 */
export async function saveMyName(name: string) {
	const { status: st } = await rpc<{ status: string }>('set_my_name', { p_name: name });
	if (st !== 'ok' && st !== 'already' && st !== 'roster') throw new Error(st);
	await loadAccount();
}

// ── 온라인 표시 ───────────────────────────────────────────────────────
// 앱이 화면에 떠 있는 동안 60초마다 "켜져 있음"을 알린다. 서버는 130초 동안 온라인으로 본다.
// 백그라운드로 가면 곧바로 오프라인을 알린다 (그래야 상대 화면의 초록 점이 바로 꺼진다).
// 요청 하나하나가 Supabase 로그 사용량이 되므로 주기는 필요한 만큼만 (Phase 36).
const BEAT_MS = 60_000;
let beatTimer: ReturnType<typeof setInterval> | null = null;

async function beat(online: boolean) {
	if (!S.session) return;
	const token = accountToken();
	try {
		const { data, error } = await supabase.rpc('heartbeat', { p_online: online });
		// 서버 점검(Phase 52) — 박동 대답에 실려 온다. 오류(오프라인 등)면 그대로 둔다
		if (accountIsCurrent(token) && !error && online) {
			const d = data as {
				maintenance?: { msg?: string; until?: string | null } | null;
				maintenance_at?: string | null;
				ach_new?: boolean;
			} | null;
			const m = d?.maintenance;
			setMaint(m ? { msg: m.msg ?? '', until: m.until ?? null } : null);
			// 점검 예약 예고 (Phase 53) — 24시간 안의 예약만 온다
			const at = d?.maintenance_at ?? null;
			if (at !== S.maintAt) S.maintAt = at;
			// 새 업적 (Phase 55) — 예전엔 축하 창이 10분마다 따로 물었다. 이제 박동이 "있다"고 할 때만 받아 간다
			if (d?.ach_new) UI.achNew = true;
		}
	} catch {
		/* 다음 박동에 다시 */
	}
}

/** 점검 화면의 "다시 확인" (Phase 52) — 박동 한 번으로 점검이 끝났는지 본다 */
export const recheckMaint = () => beat(true);

function startHeartbeat() {
	if (beatTimer || typeof document === 'undefined') return;
	beatTimer = setInterval(() => {
		if (document.visibilityState === 'visible') void beat(true);
	}, BEAT_MS);
	document.addEventListener('visibilitychange', () => {
		void beat(document.visibilityState === 'visible');
	});
	// 앱을 완전히 닫을 때 — 응답을 기다릴 수 없으니 최선을 다할 뿐, 못 보내도 130초 뒤 자연히 오프라인
	window.addEventListener('pagehide', () => void beat(false));
}

// ── 설치 게이트 ───────────────────────────────────────────────────────
function detectStandalone() {
	if (typeof window === 'undefined') return;
	// 개발 중에는 게이트를 끈다. ?gate 를 붙이면 설치 안내 화면을 확인할 수 있다.
	if (import.meta.env.DEV && !location.search.includes('gate')) {
		UI.standalone = true;
		return;
	}
	UI.standalone =
		window.matchMedia('(display-mode: standalone)').matches ||
		// iOS Safari 는 display-mode 를 지원하지 않는다
		(navigator as unknown as { standalone?: boolean }).standalone === true;
}

export async function promptInstall() {
	const e = UI.installEvt;
	if (!e) return false;
	await e.prompt();
	const { outcome } = await e.userChoice;
	if (outcome === 'accepted') UI.installEvt = null;
	return outcome === 'accepted';
}

// ── 인증 (OTP 코드 방식) ──────────────────────────────────────────────
// 링크 방식을 쓰면 링크가 브라우저에서 열리고, 그 브라우저는 설치 게이트에 막힌다.
// 코드 방식이면 설치된 앱 안에서 인증이 끝난다.

export const SCHOOL_DOMAIN = 'cnsa.hs.kr';

/** 학교 메일 전체(20101@cnsa.hs.kr)를 붙여 넣으면 앞부분만 (UX G6.2). 다른 도메인은 그대로 둬서 화면이 알릴 수 있게 */
export function schoolLocal(v: string) {
	const at = v.lastIndexOf('@');
	return at >= 0 && v.slice(at + 1).trim().toLowerCase() === SCHOOL_DOMAIN ? v.slice(0, at) : v;
}

/** 입력칸은 학교 이메일 앞부분만 받는다 — 도메인은 여기서 붙인다 */
export const schoolEmail = (localPart: string) => `${schoolLocal(localPart).trim().toLowerCase()}@${SCHOOL_DOMAIN}`;

export async function sendOtp(localPart: string) {
	const email = schoolEmail(localPart);
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: { shouldCreateUser: true }
	});
	if (error) throw error;
	return email;
}

/**
 * 비밀번호 찾기 — 이미 있는 계정에만 코드를 보낸다 (새 계정은 만들지 않는다).
 * 계정이 없어도 성공처럼 돌려준다: 비밀번호 로그인과 마찬가지로 가입 여부를 알려 주지 않기 위해.
 */
export async function sendResetOtp(localPart: string) {
	const email = schoolEmail(localPart);
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: { shouldCreateUser: false }
	});
	if (error && !/signups? not allowed/i.test(error.message)) throw error;
	return email;
}

export async function verifyOtp(email: string, token: string) {
	const { error } = await supabase.auth.verifyOtp({
		email,
		token: token.trim(),
		type: 'email'
	});
	if (error) throw error;
	otpVerifiedAt = Date.now();
}

// ── 본인 재확인 (비밀번호 바꾸기 전) ─────────────────────────────────
// 기존 비밀번호로 확인하거나, 잊었으면 학교 메일 인증 코드로 확인한다.
// 방금 인증 코드로 들어왔으면(10분 이내) 한 번 더 묻지 않는다 — "비밀번호를 잊어서 코드로 들어온" 경우.
const REVERIFY_FRESH_MS = 10 * 60_000;
let otpVerifiedAt = 0;
export const recentlyVerified = () => Date.now() - otpVerifiedAt < REVERIFY_FRESH_MS;

const myEmail = () => S.session?.user.email ?? '';

/** 기존 비밀번호가 맞는지 — 맞으면 같은 계정으로 세션이 새로 발급될 뿐 아무것도 바뀌지 않는다 */
export async function verifyCurrentPassword(password: string) {
	const { error } = await supabase.auth.signInWithPassword({ email: myEmail(), password });
	if (error) throw error;
	otpVerifiedAt = Date.now();
}

/** 비밀번호를 잊었을 때 — 내 학교 메일로 인증 코드 (새 계정은 만들지 않는다) */
export async function sendOtpToMe() {
	const { error } = await supabase.auth.signInWithOtp({
		email: myEmail(),
		options: { shouldCreateUser: false }
	});
	if (error) throw error;
	return myEmail();
}

export async function verifyOtpForMe(token: string) {
	await verifyOtp(myEmail(), token);
}

// ── 비밀번호 로그인 ──────────────────────────────────────────────────
// 처음 한 번은 반드시 인증 코드(학교 메일)로 들어와 계정을 만들고, 그때 비밀번호를 정한다.
// 그 뒤로는 학교 이메일 앞부분 + 비밀번호로 들어온다.
// ★ 도메인은 여기서 붙인다. 입력칸은 앞부분만 받으므로 다른 도메인으로 로그인을 시도할 길이 없고,
//   애초에 DB 트리거가 학교 도메인이 아닌 계정을 만들지 못하게 막는다.
// ★ 확인 전 계정에는 비밀번호가 저장되지 않는다(strip_unconfirmed_password) — 남의 이메일로
//   미리 비밀번호를 걸어 두는 선점이 불가능하다.

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,72}$/;

export async function signInWithPassword(localPart: string, password: string) {
	const email = schoolEmail(localPart);
	const { error } = await supabase.auth.signInWithPassword({ email, password });
	if (error) throw error;
}

/** 로그인한 상태에서 비밀번호 설정·변경. 잊었으면 인증 코드로 들어와 다시 정하면 된다. */
export async function setPassword(password: string, currentPassword?: string) {
	if (!PASSWORD_RULE.test(password)) throw new Error('weak_password');
	const { error } = await supabase.auth.updateUser({ password, ...(currentPassword ? { current_password: currentPassword } : {}) });
	if (error) throw error;
	await loadAccount();
}

export async function signOut() {
	const token = accountToken();
	await disablePush().catch(() => {}); // 이 기기로 이 계정 알림이 더 오지 않게
	if (!accountIsCurrent(token)) return;
	await beat(false);
	if (!accountIsCurrent(token)) return;
	const { error } = await supabase.auth.signOut();
	if (error) throw error;
	if (accountIsCurrent(token)) selectSession(null);
}

// ── 프로필 ────────────────────────────────────────────────────────────
export async function saveProfile(bio: string, interests: string[], mbti: string | null) {
	await rpc('update_my_profile', { p_bio: bio, p_interests: interests, p_mbti: mbti ?? '' });
	await loadProfile();
}

// ── 온보딩 ────────────────────────────────────────────────────────────
export async function saveOnboarding(gender: 'm' | 'f', want: 'm' | 'f' | 'any') {
	await updateProfile({ gender, want, onboarded: true });
}

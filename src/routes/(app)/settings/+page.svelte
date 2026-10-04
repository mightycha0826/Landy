<script lang="ts">
	/**
	 * 설정 — 상단 바 오른쪽 톱니를 누르면 오는 화면. 아이폰 설정 앱처럼 회색 바탕에 둥근 카드 (app.css .g-*).
	 *  · 화면: 기기 설정 따르기 / 라이트 / 다크. 이 기기에만 저장 (lib/theme.svelte.ts)
	 *    글자 크기(대화 · 편지) · 움직임 줄이기 · 진동(안드로이드) — 이 기기에만 저장 (lib/prefs.svelte.ts, Phase 43)
	 *  · 테마 색상: 앱 전체의 포인트 색 (버튼 · 로고 · 내 말풍선 …). 이 기기에만 저장되고 상대 화면은 그대로다 (lib/themeColor.svelte.ts)
	 *  · 알림: 푸시 알림 · 종류별로 끄기(대화 메시지 · 공감 · 편지 — 서버 구독에 저장, Phase 43) · 앱 안 알림 띠
	 *  · 대화: 만났던 사람 다시 만나기 · Enter 키로 보내기 / 편지: 편지 받기 · 추천에 나오기(Phase 84) · 편지지 글씨 · 봉투 여는 장면
	 *  · 뱃지 (Phase 84): 랜덤채팅에서 보일 뱃지(뱃지마다) · 편지 찾기의 내 뱃지 순서 · CNSA 뱃지 안내 다시 보기 · 뱃지 제출
	 *  · 비밀번호 · 계정 상태 · 약관 및 정책(이용약관 · 개인정보 처리방침 · 운영정책 → /settings/[doc])
	 *  · 앱: 버전(빌드 시각) · 앱 새로고침 · 이 기기 설정 초기화 · 로그아웃
	 * 홈의 "비밀번호를 만들어 두세요"와 비밀번호 찾기 인증 뒤에는 /settings#password 로 와서 비밀번호 칸이 펼쳐져 있다.
	 */
	import '@fontsource/nanum-pen-script/index.css';
	import { version } from '$app/environment';
	import { goto } from '$app/navigation';
	import { THEME_COLOR, THEME_COLORS, fillOf, setThemeColor } from '$lib/themeColor.svelte';
	import { THEME, THEME_MODES, setTheme } from '$lib/theme.svelte';
	import { LETTER_FONTS, PREFS, TEXT_SIZES, canVibrate, resetPrefs, setPref } from '$lib/prefs.svelte';
	import { replayTour } from '$lib/tour.svelte';
	import {
		PUSH_KINDS,
		disablePush,
		enablePush,
		pushEnabled,
		pushMuted,
		pushState,
		setPushKind,
		type PushKind,
		type PushState
	} from '$lib/push';
	import {
		S,
		errMsg,
		setProfileField,
		signOut,
		toast
	} from '$lib/state.svelte';
	import BackButton from '$lib/ui/BackButton.svelte';
	import Chevron from '$lib/ui/Chevron.svelte';
	import { LEGAL, LEGAL_IDS } from '$lib/legal';
	import PasswordSettings from '$lib/ui/PasswordSettings.svelte';
	import ProfileSwitch from '$lib/ui/ProfileSwitch.svelte';
	import { reloadApp } from '$lib/reload';
	import Sheet from '$lib/ui/Sheet.svelte';
	import BadgeChatToggles from '$lib/ui/BadgeChatToggles.svelte';
	import { fetchMyAchievements, type MyAchievements } from '$lib/achievements';
	import { openBadgeTour } from '$lib/badgeTour.svelte';

	let reloading = $state(false);

	// 푸시 알림
	let pushPerm = $state<PushState>(pushState());
	let pushOn = $state<boolean | null>(null);
	let pushBusy = $state(false);
	$effect(() => {
		void pushEnabled().then((v) => (pushOn = v));
	});
	async function togglePush() {
		if (pushBusy) return;
		pushBusy = true;
		try {
			if (pushOn) {
				await disablePush();
				pushOn = false;
				toast('알림 꺼짐');
			} else {
				pushPerm = await enablePush();
				pushOn = await pushEnabled();
				if (pushOn) toast('알림 켜짐');
			}
		} catch (e) {
			toast(errMsg(e));
		} finally {
			pushBusy = false;
		}
	}

	// 알림 종류별로 끄기 (Phase 43) — 이 기기 구독에 저장된다. 운영진 공지는 끌 수 없다
	let muted = $state<PushKind[]>(pushMuted());
	let kindBusy = $state(false);
	async function toggleKind(kind: PushKind, e: Event) {
		const box = e.currentTarget as HTMLInputElement;
		const on = box.checked;
		box.checked = !muted.includes(kind); // 저장된 뒤에 바뀐다
		if (kindBusy) return;
		kindBusy = true;
		try {
			muted = await setPushKind(kind, on);
		} catch (err) {
			toast(errMsg(err));
		} finally {
			kindBusy = false;
		}
	}

	// ── 앱 ──
	// 빌드 시각 (SvelteKit version = 빌드한 때의 Date.now()) — 문의할 때 어느 버전인지 알 수 있게
	const built = (() => {
		const d = new Date(Number(version));
		if (Number.isNaN(d.getTime())) return version;
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	})();

	let resetAsk = $state(false);
	function resetDevice() {
		setTheme('system');
		setThemeColor(THEME_COLORS[0].id);
		resetPrefs();
		resetAsk = false;
		toast('이 기기 설정을 처음으로 되돌렸어요');
	}

	// 편지 추천에 보이는 뱃지 순서
	let orderBusy = $state(false);
	async function setOrder(v: 'mine' | 'random') {
		if (orderBusy || (S.profile?.letter_badge_order ?? 'mine') === v) return;
		orderBusy = true;
		try {
			await setProfileField({ letter_badge_order: v });
		} catch (err) {
			toast(errMsg(err));
		} finally {
			orderBusy = false;
		}
	}
	// 랜덤채팅에서 보일 뱃지 — 열 때 내 뱃지를 받아 온다
	let chatSheet = $state(false);
	let mineBadges = $state<MyAchievements | null>(null);
	function openChatSheet() {
		chatSheet = true;
		mineBadges = null;
		fetchMyAchievements()
			.then((d) => (mineBadges = d))
			.catch((e) => {
				chatSheet = false;
				toast(errMsg(e));
			});
	}

	async function out() {
		await signOut();
		void goto('/login', { replaceState: true });
	}
</script>

<div class="topbar ios">
	<BackButton href="/" history />
	<span class="title">설정</span>
</div>

<div class="page grouped settings">
	<!-- 화면 — 한 줄: 왼쪽 이름, 오른쪽 아이콘 셋 (기기 · 해 · 달). 이 기기에서만 바뀐다 -->
	<div class="g-card theme-card">
		<div class="g-row">
			<span id="theme-h">화면</span>
			<div class="seg" role="radiogroup" aria-labelledby="theme-h">
				{#each THEME_MODES as t (t.id)}
					<button class="seg-btn" class:on={THEME.mode === t.id} role="radio" aria-checked={THEME.mode === t.id} aria-label={t.label} title={t.label} onclick={() => setTheme(t.id)}>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							{#if t.id === 'system'}
								<rect x="6.5" y="2.5" width="11" height="19" rx="2.5" stroke="currentColor" stroke-width="1.8" />
								<path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
							{:else if t.id === 'light'}
								<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
								<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
							{:else}
								<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
							{/if}
						</svg>
					</button>
				{/each}
			</div>
		</div>
		<!-- 글자 크기 (Phase 43) — "가" 네 개가 점점 크게. 대화 말풍선 · 편지 글씨에 입혀진다 (아래 미리보기 말풍선도 같이) -->
		<div class="g-row">
			<span id="text-h">글자 크기</span>
			<div class="seg" role="radiogroup" aria-labelledby="text-h">
				{#each TEXT_SIZES as t, i (t.id)}
					<button
						class="seg-btn pick"
						class:on={PREFS.text === t.id}
						role="radio"
						aria-checked={PREFS.text === t.id}
						aria-label={t.label}
						title={t.label}
						style:font-size="{13 + i * 2.5}px"
						onclick={() => setPref('text', t.id)}>가</button
					>
				{/each}
			</div>
		</div>
		<label class="g-row">
			<span>움직임 줄이기</span>
			<input class="switch" type="checkbox" role="switch" checked={PREFS.motion} onchange={(e) => setPref('motion', e.currentTarget.checked)} />
		</label>
		{#if canVibrate()}
			<label class="g-row">
				<span>진동</span>
				<input class="switch" type="checkbox" role="switch" checked={PREFS.haptics} onchange={(e) => setPref('haptics', e.currentTarget.checked)} />
			</label>
		{/if}
	</div>

	<h2 class="g-head" id="theme-color">테마 색상</h2>
	<div class="g-card">
		<!-- 미리보기 — 고르는 즉시 바뀐다 -->
		<div class="preview" aria-hidden="true">
			<div class="prow"><span class="bubble other">오늘 급식 뭐였어?</span></div>
			<div class="prow mine"><span class="bubble">카레! 맛있었어</span></div>
			<div class="prow mine"><span class="bubble">너는 뭐 먹었어?</span></div>
		</div>
		<div class="swatches" role="radiogroup" aria-labelledby="theme-color">
			{#each THEME_COLORS as c (c.id)}
				<label class="swatch" class:on={THEME_COLOR.id === c.id}>
					<input
						type="radio"
						name="theme-color"
						value={c.id}
						aria-label={c.label}
						checked={THEME_COLOR.id === c.id}
						onchange={() => setThemeColor(c.id)}
					/>
					<span class="dot" style:background={fillOf(c)}></span>
				</label>
			{/each}
		</div>
	</div>

	<h2 class="g-head">알림</h2>
	<div class="g-card">
		<label class="g-row">
			<span>푸시 알림</span>
			<input
				class="switch"
				type="checkbox"
				role="switch"
				checked={!!pushOn}
				disabled={pushBusy || pushOn === null || pushPerm === 'unsupported' || pushPerm === 'denied'}
				onchange={(e) => {
					(e.currentTarget as HTMLInputElement).checked = !!pushOn; // 실제로 켜지고 꺼진 뒤에 바뀐다
					void togglePush();
				}}
			/>
		</label>
		<!-- 종류별로 (Phase 43) — 푸시를 켰을 때만. 이 기기로 오는 알림만 바뀐다 -->
		{#if pushOn}
			{#each PUSH_KINDS as k (k.id)}
				<label class="g-row sub">
					<span>{k.label}</span>
					<input
						class="switch"
						type="checkbox"
						role="switch"
						checked={!muted.includes(k.id)}
						disabled={kindBusy}
						onchange={(e) => toggleKind(k.id, e)}
					/>
				</label>
			{/each}
		{/if}
		<label class="g-row">
			<span>앱 안 알림</span>
			<input class="switch" type="checkbox" role="switch" checked={PREFS.inApp} onchange={(e) => setPref('inApp', e.currentTarget.checked)} />
		</label>
	</div>
	{#if pushPerm === 'unsupported'}
		<p class="g-foot">이 기기에서는 푸시 알림을 받을 수 없어요.</p>
	{:else if pushPerm === 'denied'}
		<p class="g-foot">휴대폰 설정에서 알림을 허용해 주세요.</p>
	{/if}

	<h2 class="g-head">대화</h2>
	<div class="g-card">
		<ProfileSwitch field="allow_rematch" label="만났던 사람 다시 만나기" messages={['만났던 사람도 다시 만날 수 있어요', '최근에 만난 사람은 다시 만나지 않아요']} />
		<label class="g-row">
			<span>Enter 키로 보내기</span>
			<input class="switch" type="checkbox" role="switch" checked={PREFS.enterSend} onchange={(e) => setPref('enterSend', e.currentTarget.checked)} />
		</label>
	</div>

	<h2 class="g-head">편지</h2>
	<div class="g-card">
		<ProfileSwitch field="letters_open" label="편지 받기" messages={['이름으로 찾아서 편지를 보낼 수 있어요', '이제 검색에 나오지 않고 새 편지를 받지 않아요']} />
		<!-- 편지 쓰기 찾기 화면 아래 추천 5명에 나오기 (Phase 84 — 기본 켜짐). 끄면 이름으로 찾을 때만 나온다 -->
		<ProfileSwitch field="letters_recommend" label="추천에 나오기" messages={['편지 쓰기 추천에 나와요', '이제 편지 쓰기 추천에 나오지 않아요 · 이름으로는 찾을 수 있어요']} disabled={S.profile?.letters_open === false} />
		<!-- 편지지 글씨 (Phase 43) — 손글씨가 읽기 어려우면 반듯한 글씨로. 단추 글자가 그 글씨로 보인다 -->
		<div class="g-row">
			<span id="font-h">편지지 글씨</span>
			<div class="seg" role="radiogroup" aria-labelledby="font-h">
				{#each LETTER_FONTS as f (f.id)}
					<button
						class="seg-btn pick word {f.id}"
						class:on={PREFS.letterFont === f.id}
						role="radio"
						aria-checked={PREFS.letterFont === f.id}
						aria-label={f.label}
						onclick={() => setPref('letterFont', f.id)}>{f.id === 'hand' ? '손글씨' : '반듯한'}</button
					>
				{/each}
			</div>
		</div>
		<label class="g-row">
			<span>봉투 여는 장면</span>
			<input class="switch" type="checkbox" role="switch" checked={PREFS.envelope} onchange={(e) => setPref('envelope', e.currentTarget.checked)} />
		</label>
	</div>

	<!-- 뱃지 (Phase 84) — 어디에 보일지 · CNSA 뱃지 안내 · 운영진에게 뱃지 사진 보내기 -->
	<h2 class="g-head">뱃지</h2>
	<div class="g-card">
		<button class="g-row" onclick={openChatSheet}>
			<span>랜덤채팅에서 보일 뱃지</span>
			<Chevron />
		</button>
		<div class="g-row">
			<span id="border-h">편지 찾기의 뱃지 순서</span>
			<div class="seg" role="radiogroup" aria-labelledby="border-h">
				{#each [['mine', '내 순서'], ['random', '무작위']] as const as [v, label] (v)}
					<button
						class="seg-btn word"
						class:on={(S.profile?.letter_badge_order ?? 'mine') === v}
						role="radio"
						aria-checked={(S.profile?.letter_badge_order ?? 'mine') === v}
						disabled={orderBusy || !S.profile || S.profile.letter_badge_order === undefined}
						onclick={() => setOrder(v)}>{label}</button
					>
				{/each}
			</div>
		</div>
		<button class="g-row" onclick={openBadgeTour}>
			<span>CNSA 뱃지 안내</span>
			<Chevron />
		</button>
		<a class="g-row" href="/me/achievements/submit">
			<span>뱃지 제출하기</span>
			<Chevron />
		</a>
	</div>
	<p class="g-foot">랜덤채팅에선 뱃지가 나를 짐작하게 할 수 있어요. CNSA 뱃지는 따로 켜지 않으면 숨겨져요.</p>

	{#if chatSheet}
		<Sheet onclose={() => (chatSheet = false)} label="랜덤채팅에서 보일 뱃지">
			<div class="chat-badges">
				<h3>랜덤채팅에서 보일 뱃지</h3>
				<p class="muted small">끈 뱃지는 대화 상대의 교복에 달리지 않아요. 편지 찾기에서는 그대로 보여요.</p>
				{#if mineBadges}<BadgeChatToggles data={mineBadges} />{:else}<p class="muted small">불러오는 중…</p>{/if}
			</div>
		</Sheet>
	{/if}

	<h2 class="g-head">계정</h2>
	<div class="g-card" id="password">
		<PasswordSettings />
		{#if S.me}
			<div class="g-row">
				<span>이름</span>
				<span class="g-val">{S.me.name}{S.me.grade ? ` · ${S.me.grade}학년` : ''}</span>
			</div>
		{/if}
		<div class="g-row">
			<span>학교 인증</span>
			<span class="g-val">{S.profile?.verified ? '완료' : '미완료'}</span>
		</div>
		<div class="g-row">
			<span>계정 상태</span>
			<span class="g-val" class:bad={S.profile?.status !== 'active'}>{S.profile?.status === 'active' ? '정상' : '제한됨'}</span>
		</div>
	</div>

	<div class="g-card"><a class="g-row" href="/settings/delete"><span>계정 삭제 요청</span><Chevron /></a></div>
	<p class="g-foot">운영진에게 삭제를 요청하고 접수 내역과 답변을 확인할 수 있어요.</p>

	<!-- 운영진에게 문의하기 (Phase 37) — 답변은 개인 공지로 온다 -->
	<h2 class="g-head">도움</h2>
	<div class="g-card">
		<a class="g-row" href="/settings/contact">
			<span>운영진에게 문의하기</span>
			<Chevron />
		</a>
	</div>

	<h2 class="g-head">약관 및 정책</h2>
	<div class="g-card">
		{#each LEGAL_IDS as id (id)}
			<a class="g-row legal-row" href="/settings/{id}">
				<span class="legal-ic" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none">
						{#if id === 'terms'}
							<path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10A.5.5 0 017 20V3.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
							<path d="M14 3.5V8h4M9.5 12h5M9.5 15.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
						{:else if id === 'privacy'}
							<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
							<path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
						{:else}
							<circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.7" />
							<circle cx="16.5" cy="10" r="2.3" stroke="currentColor" stroke-width="1.7" />
							<path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M14.5 15c2.6-.6 5.2.7 6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
						{/if}
					</svg>
				</span>
				<span class="legal-text">
					<span>{LEGAL[id].title}</span>
					<small class="muted">{LEGAL[id].subtitle}</small>
				</span>
				<Chevron />
			</a>
		{/each}
	</div>

	<!-- 앱 (Phase 43) — 버전 · 새로고침 · 이 기기 설정 초기화 -->
	<h2 class="g-head">앱</h2>
	<div class="g-card">
		<div class="g-row">
			<span>버전</span>
			<span class="g-val num">{built}</span>
		</div>
		<!-- 앱 새로고침 (Phase 37) — 탭 첫 화면에서는 맨 위에서 당겨도 된다 -->
		<button class="g-row" onclick={() => { reloading = true; void reloadApp(); }} disabled={reloading}>
			<span>앱 새로고침</span>
			<span class="g-val">{reloading ? '불러오는 중…' : '최신 버전으로'}</span>
			<Chevron />
		</button>
		<!-- 사용법 안내 (Phase 44 · 89) — 홈 · 프로필 · 익명편지 안내를 모두 처음부터 (홈으로 가서 홈 안내부터) -->
		<button class="g-row" onclick={() => { replayTour(); void goto('/'); }}>
			<span>사용법 다시 보기</span>
			<Chevron />
		</button>
		<button class="g-row" onclick={() => (resetAsk = !resetAsk)} aria-expanded={resetAsk}>
			<span>이 기기 설정 초기화</span>
			<span class="g-val">기본값으로</span>
			<Chevron />
		</button>
		{#if resetAsk}
			<div class="g-more">
				<p class="step muted">화면 모드 · 테마 색상 · 글자 크기 · 움직임 · 편지지 글씨 · 앱 안 알림 · Enter 키 설정을 처음으로 되돌려요. 계정과 편지 · 대화는 그대로예요.</p>
				<div class="pwfoot">
					<button class="btn-text danger-text" onclick={resetDevice}>되돌리기</button>
					<button class="cancel u-tap" onclick={() => (resetAsk = false)}>취소</button>
				</div>
			</div>
		{/if}
	</div>

	<div class="g-card out">
		<button class="g-row center danger" onclick={out}>로그아웃</button>
	</div>
</div>

<style>
	.settings {
		padding-bottom: calc(32px + env(safe-area-inset-bottom));
	}
	.theme-card {
		margin-top: 18px;
	}
	/* 화면 모드 — 아이콘 세 개짜리 작은 고르기 칸 */
	.seg {
		display: flex;
		margin-left: auto;
		padding: 3px;
		border-radius: 999px;
		background: var(--field);
	}
	/* 보이는 칸 44×32, 누름은 위아래 여백까지 44 (G1) */
	.seg-btn::after {
		content: '';
		position: absolute;
		inset: -6px 0;
	}
	.seg-btn:active {
		transform: scale(0.92);
	}
	.seg-btn {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 32px;
		border-radius: 999px;
		color: var(--text-2);
		transition: background-color 0.15s, color 0.15s;
	}
	.seg-btn svg {
		width: 18px;
		height: 18px;
	}
	.seg-btn.on {
		background: var(--accent-fill);
		color: var(--on-accent);
	}
	/* 글자 크기 · 편지지 글씨 (Phase 43) — 아이콘 대신 글자. "가"는 단추마다 크기가 다르다(style) */
	.seg-btn.pick {
		font-weight: 700;
		line-height: 1;
	}
	.seg-btn.word {
		width: auto;
		padding: 0 13px;
		font-size: 14px;
	}
	.seg-btn.word.hand {
		font-family: var(--hand);
		font-size: 21px;
		font-weight: 400;
	}
	/* 랜덤채팅에서 보일 뱃지 (Phase 84) — 시트 안 목록 */
	.chat-badges {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 70dvh;
		overflow-y: auto;
		padding: 0 4px 8px;
	}
	.chat-badges h3 {
		margin: 0;
		font-size: 17px;
	}
	/* 푸시 알림 아래의 종류별 줄 — 한 단계 들여서 */
	.g-row.sub {
		padding-left: 30px;
		font-size: 15px;
	}
	.danger-text {
		color: var(--danger);
	}
	.settings > .g-head:first-child {
		margin-top: 8px;
	}
	.out {
		margin-top: 32px;
	}
	.bad {
		color: var(--danger);
	}

	.step {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
	}
	.pwfoot {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.cancel {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 8px;
		font-size: 14px;
		color: var(--text-2);
	}

	/* 약관 및 정책 — 아이콘 · 제목 · 한 줄 설명 · › */
	.legal-row {
		color: inherit;
		text-decoration: none;
	}
	a.legal-row:active {
		background: var(--field);
	}
	.legal-ic {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: var(--accent-fill);
		color: var(--on-accent);
	}
	.legal-ic svg {
		width: 19px;
		height: 19px;
	}
	.legal-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.legal-text small {
		font-size: 12px;
	}

	/* 테마 색상 — 위는 대화 미리보기, 아래는 색 동그라미 (아이폰 "라이트 · 다크" 고르기처럼) */
	.preview {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 18px 16px 16px;
		border-bottom: 1px solid var(--cell-line);
	}
	.prow {
		display: flex;
	}
	.prow.mine {
		justify-content: flex-end;
	}
	.prow:not(.mine) + .prow.mine {
		margin-top: 6px;
	}
	.bubble {
		max-width: 78%;
		padding: 8px 13px;
		border-radius: var(--r-bubble);
		background: var(--bubble-fill);
		color: var(--on-accent);
		font-size: var(--chat-fs); /* 글자 크기를 고르면 미리보기도 바로 (app.css) */
		line-height: 1.38;
	}
	.bubble.other {
		background: var(--field);
		color: var(--text);
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr)); /* 한 줄에 다섯 개 */
		padding: 14px 8px;
	}
	.swatch {
		position: relative;
		display: flex;
		justify-content: center;
		padding: 4px 0;
		cursor: pointer;
	}
	.swatch input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.dot {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		/* 고른 색은 바깥에 테두리 한 겹 — 카드색 틈을 두고 */
		box-shadow:
			0 0 0 3px var(--cell),
			0 0 0 4px transparent;
	}
	.swatch.on .dot {
		box-shadow:
			0 0 0 3px var(--cell),
			0 0 0 5px var(--text);
	}
	.swatch input:focus-visible + .dot {
		outline: 2px solid var(--accent);
		outline-offset: 6px;
	}
</style>

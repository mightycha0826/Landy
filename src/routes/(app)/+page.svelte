<script lang="ts">
	import { surface } from '$lib/transitions';
	import { getContext, onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/ui/Avatar.svelte';
	import { INBOX, type InboxRoom } from '$lib/inbox.svelte';
	import { S, UI, retryAccount, toast } from '$lib/state.svelte';
	import { touring } from '$lib/tour.svelte';
	import { MATCHING_CONTEXT, type Matching } from '$lib/matching';
	import { isRestricted } from '$lib/restriction';
	import { mmss } from '$lib/time';
	import { canHoldScreen } from '$lib/wakeLock';
	import { scrollBehavior } from '$lib/motion';
	import TopbarMe from '$lib/ui/TopbarMe.svelte';
	import PushAsk from '$lib/ui/PushAsk.svelte';
	import BotChat from '$lib/bot/BotChat.svelte';
	import { botApi, type BotStart } from '$lib/bot/api';
	import { BOT_AFTER_MS, randomAlias } from '$lib/bot/persona';
	import PinnedStories from '$lib/chat/PinnedStories.svelte';
	import RoomList from '$lib/chat/RoomList.svelte';
	import RoomMenu from '$lib/chat/RoomMenu.svelte';
	import RateQueue from '$lib/chat/RateQueue.svelte';

	/**
	 * 홈 = 대화 목록 (인스타 DM 받은편지함).
	 * 위에는 고정한 대화(PinnedStories), 그 아래 지금 열려 있는 대화들(RoomList) — 여러 대화를 동시에 이어갈 수 있다.
	 * 목록이 비었으면 찾는 중 레이더 · 소개 카드, 맨 아래(엄지 자리)에 새 상대 찾기.
	 * 대화 줄을 길게 누르면(마우스는 오른쪽 클릭) 신고 · 차단 · 나가기 (RoomMenu).
	 * 떠 있는 창: 대화 봇(찾기 20초가 지나도 상대가 없으면) · 매너 평가(RateQueue) · 처음 한 번 알림 안내(PushAsk).
	 */
	let askPush = $state(false);

	const closed = $derived(S.settings ? !S.settings.is_open : false);
	// 영구/무기한 정지(status) 또는 기간 정지(suspended_until)
	// ★ 프로필을 아직(또는 못) 불러왔을 때를 정지로 착각하지 않는다 — 예전엔 profile 이 null 이면
	//   status !== 'active' 가 참이 되어 멀쩡한 계정에 "이용이 제한된 계정"이 떴다.
	const suspended = $derived(!!S.profile && isRestricted(S.profile, S.now));
	const profileMissing = $derived(S.booted && !!S.session && !S.profile && !S.profileLoading);
	const suspendedUntil = $derived(
		S.profile?.status === 'active' && S.profile?.suspended_until
			? new Date(S.profile.suspended_until).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
			: null
	);
	const maxRooms = $derived(S.settings?.max_open_rooms ?? 5);

	// 앱 틀이 켜 둔 대화 목록 — 다른 탭에 다녀와도 기억해 둔 목록을 바로 그리고 뒤에서 새로 읽는다
	const inbox = INBOX;

	const seeker = getContext<Matching>(MATCHING_CONTEXT);

	// AI는 대기 20초 뒤 선택할 수 있다. 클릭하기 전에는 세션·대화를 만들지 않는다.
	let bot = $state<{ chat: BotStart; alias: string } | null>(null);
	let botBusy = $state(false);
	let alive = true;
	onDestroy(() => { alive = false; });
	const offerBot = $derived(seeker.seeking && !!S.settings?.ai_chat && S.now - seeker.since >= BOT_AFTER_MS);
	async function startBot() {
		if (!offerBot || botBusy) return;
		const since = seeker.since;
		botBusy = true;
		try {
			const r = await botApi.start();
			if (!alive || !seeker.seeking || seeker.since !== since || !S.settings?.ai_chat) return;
			if (r.status !== 'ok') { toast('지금은 AI와 대화할 수 없어요. 사람은 계속 찾고 있어요'); return; }
			bot = { chat: r, alias: randomAlias(S.profile?.nickname) };
		} catch { if (alive && seeker.seeking && seeker.since === since) toast('AI 대화를 시작하지 못했어요. 다시 시도해 주세요'); }
		finally { if (alive) botBusy = false; }
	}
	// 찾기가 끝나면(매칭 · 상한 · 서비스 닫힘) 봇 창도 접는다
	$effect(() => {
		if (!seeker.seeking) untrack(() => (bot = null));
	});
	/** 찾기를 새로 시작 */
	function startSeek() {
		bot = null;
		seeker.start();
	}
	// 고정한 대화(Phase 29)는 동시 대화 개수에 세지 않는다 — 서버(private.open_rooms)와 같은 규칙
	const openCount = $derived(inbox.rooms.filter((r) => !r.pinned).length);
	// 고정한 대화는 위쪽 "스토리" 줄에 (인스타처럼 그라디언트 테두리), 아래 목록은 시간이 흐르는 대화만
	const pinnedRooms = $derived(inbox.rooms.filter((r) => r.pinned));
	const liveRooms = $derived(inbox.rooms.filter((r) => !r.pinned));
	const full = $derived(openCount >= maxRooms);
	let menuFor = $state<InboxRoom | null>(null);

	// ★ 본문 전체를 untrack — 화면에 들어올 때 한 번만 돈다. 예전엔 page.url(겹친 창을 뒤로 닫으면 새 객체가 된다)과
	//   seeker.seeking(start 가 읽고 쓴다)을 추적해서 다시 돌았고, 그때 cleanup 이 찾기를 말없이 멈췄다 (Phase 39)
	$effect(() => {
		untrack(() => {
			void inbox.load();
			// 대화가 끝나고 "새 대화 찾기"로 왔으면 바로 찾기 시작
			if (UI.seekOnHome) {
				UI.seekOnHome = false;
				seeker.start();
			} else if (page.url.searchParams.has('seek')) {
				// 옛 주소(/?seek) 호환 — 주소만 정리
				void goto('/', { replaceState: true, keepFocus: true, noScroll: true, state: page.state });
				seeker.start();
			}
		});
		// 목록과 찾기의 수명은 앱 공통 레이아웃이 관리한다.
	});

	const elapsed = $derived(seeker.seeking ? mmss(Math.floor((S.now - seeker.since) / 1000)) : '');

	let retrying = $state(false);
	async function retryRooms() {
		if (retrying) return;
		retrying = true;
		try { await inbox.load(); } finally { retrying = false; }
		if (inbox.failed) toast('아직 연결되지 않았어요');
	}
</script>

<div class="topbar">
	<!-- 로고 = 홈(채팅). 이미 홈이면 맨 위로 -->
	<a
		class="title wordmark logo"
		href="/"
		draggable="false"
		onclick={(e) => {
			if (page.url.pathname !== '/') return;
			e.preventDefault();
			window.scrollTo({ top: 0, behavior: scrollBehavior() });
		}}>Landy</a
	>
	<TopbarMe />
</div>

<div class="page home">
	{#if S.hasPassword === false}
		<button class="nudge" onclick={() => goto('/settings#password')}>
			<strong>비밀번호를 만들어 두세요</strong>
			<span>다음부터 인증 코드 없이 바로 로그인할 수 있어요 ›</span>
		</button>
	{/if}

	{#if S.settings?.notice}
		<div class="notice selectable">{S.settings.notice}</div>
	{/if}

	{#if S.maintAt}
		<!-- 점검 예고 (Phase 53) — 24시간 안에 예약된 서버 점검 -->
		{@const at = new Date(S.maintAt)}
		<div class="notice maint-soon" role="status">
			🔧 {at.toDateString() === new Date(S.now).toDateString() ? '오늘' : '내일'}
			{at.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}부터 서버 점검이 있어요 · 잠시 앱을 쓸 수 없어요
		</div>
	{/if}

	<PinnedStories rooms={pinnedRooms} onmenu={(r) => (menuFor = r)} />

	<!-- 대화 목록 -->
	{#if liveRooms.length}
		<RoomList rooms={liveRooms} count={openCount} max={maxRooms} onmenu={(r) => (menuFor = r)} />
	{:else if inbox.loaded && seeker.seeking}
		<!-- 찾는 중 — 내 얼굴을 가운데 두고 퍼져 나가는 물결 (틴더식 레이더) -->
		<div class="radar" aria-hidden="true" in:surface={{ y: 0, scale: 0.96 }}>
			<i></i><i></i><i></i>
			<span class="me-ring"><Avatar name={S.profile?.nickname ?? '나'} size={96} /></span>
		</div>
	{:else if !inbox.loaded && inbox.failed}
		<!-- 대화 목록을 한 번도 못 불러왔다 — 빈 홈("오늘은 누구와…")으로 보이지 않게 이유와 다시 시도 (UX G4) -->
		<div class="load-fail" role="alert">
			<p><strong>대화 목록을 불러오지 못했어요</strong><span class="muted">인터넷 연결을 확인하고 다시 시도해 주세요</span></p>
			<button class="btn-ghost" onclick={retryRooms} disabled={retrying} aria-busy={retrying}>{retrying ? '불러오는 중…' : '다시 시도'}</button>
		</div>
	{:else if !inbox.loaded}
		<!-- 처음 불러오는 중 — 대화 줄 모양의 빈 자리 -->
		<div class="rooms-skeleton" aria-hidden="true">
			{#each [0, 1] as i (i)}<div class="sk-row"><i class="skeleton sk-av"></i><span><i class="skeleton sk-t"></i><i class="skeleton sk-b"></i></span></div>{/each}
		</div>
		<span class="sr-only" role="status">불러오는 중…</span>
	{:else}
		<!-- 빈 홈 (Phase 44) — 숫자(10:00) 대신 말을 건네는 두 말풍선. 시간 규칙은 처음 사용법 안내(튜토리얼)가 알려 준다 -->
		<div class="hero" in:surface={{ y: 14, scale: 1 }}>
			<div class="orb" aria-hidden="true"></div>
			<div class="hero-card">
				<div class="talk" aria-hidden="true">
					<span class="say them">안녕?</span>
					<span class="say me">반가워!</span>
				</div>
				<h1>오늘은 누구와 이야기할까요</h1>
				<p>이름도 학번도 묻지 않는 익명 대화</p>
			</div>
		</div>
	{/if}

	<!-- 새 상대 찾기 — 엄지가 닿는 아래쪽에 고정 (탭바 바로 위) -->
	<div class="cta">
		{#if offerBot && !bot}
			<div class="bot-choice">
				<p>기다리는 동안 AI와 이야기할 수 있어요.<br /><span class="muted">사람 찾기는 계속돼요 · AI에 입력한 대화는 Cloudflare로 전달돼요</span></p>
				<button class="btn-ghost" onclick={startBot} disabled={botBusy} aria-busy={botBusy}>{botBusy ? 'AI 대화 준비 중…' : 'AI와 대화하기'}</button>
			</div>
		{/if}
		{#if seeker.seeking}
			<div class="seek">
				<div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
				<div class="seek-text">
					<strong>상대를 찾는 중 <span class="num muted">{elapsed}</span></strong>
					<span class="muted">
						{#if seeker.reason === 'cooldown'}
							너무 빨리 넘기고 있어요. 잠깐 쉬었다가 다시 찾을게요
						{:else if seeker.reason === 'filtered'}
							지금 찾는 사람들과는 조건이 맞지 않아요
						{:else if seeker.reason === 'empty'}
							지금은 찾는 사람이 없어요. {canHoldScreen() ? '찾는 동안 화면을 켜 둘게요' : '화면을 켜 두면 계속 찾아요'}
						{:else}
							잠시만요…
						{/if}
					</span>
				</div>
				<button class="stop" onclick={() => seeker.cancel()}>그만</button>
			</div>
		{:else if profileMissing}
			<!-- 계정 정보를 못 불러왔다 — 앱을 껐다 켜지 않아도 되게 여기서 다시 시도 (UX G4) -->
			<div class="load-fail" role="alert">
				<p><strong>계정 정보를 불러오지 못했어요</strong><span class="muted">인터넷 연결을 확인하고 다시 시도해 주세요</span></p>
				<button class="btn-ghost" onclick={() => void retryAccount()}>다시 시도</button>
			</div>
		{:else if closed}
			<button class="btn" disabled>지금은 열려 있지 않아요</button>
		{:else if suspended}
			<button class="btn" disabled>
				{suspendedUntil ? `${suspendedUntil}까지 이용 제한` : '이용 제한된 계정'}
			</button>
		{:else if full}
			<button class="btn" disabled>대화는 동시에 {maxRooms}개까지 할 수 있어요</button>
		{:else}
			<button class="btn" onclick={startSeek}>새 대화 찾기</button>
		{/if}
	</div>
</div>

{#if bot && seeker.seeking}
	<BotChat chat={bot.chat} alias={bot.alias} seeking={elapsed} onclose={() => (bot = null)} />
{/if}

{#if menuFor}
	<RoomMenu
		roomId={menuFor.room_id}
		alias={menuFor.partner_alias}
		pinned={!!menuFor.pinned}
		onclose={() => (menuFor = null)}
		ondone={() => {
			menuFor = null;
			void inbox.load();
		}}
	/>
{/if}

<!-- 방금 대화한 사람 평가 — 알림 안내 · 대화 봇 · 업적 축하가 떠 있지 않을 때 (RateQueue) -->
<RateQueue paused={askPush || !!bot || UI.celebrating || touring()} />

<!-- 처음 한 번 — 알림 권한 안내 (PushAsk) -->
<PushAsk bind:open={askPush} />

<style>
	.load-fail { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: auto 0; padding: 24px 16px; text-align: center; }
	.load-fail p { display: flex; flex-direction: column; gap: 4px; margin: 0; font-size: 15px; }
	.load-fail .muted { font-size: 13px; }
	.load-fail button { width: auto; min-height: 44px; height: 44px; padding: 0 24px; }
	.cta .load-fail { margin: 0; padding: 12px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-1); }
	.rooms-skeleton { display: flex; flex-direction: column; gap: 10px; padding-top: 34px; }
	.sk-row { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: var(--r-md); background: var(--surface); }
	.sk-row span { display: flex; flex: 1; flex-direction: column; gap: 8px; }
	.sk-av { width: 52px; height: 52px; border-radius: 50%; }
	.sk-t { width: 40%; height: 14px; }
	.sk-b { width: 65%; height: 12px; }
	.bot-choice { padding: 12px; margin-bottom: 8px; border-radius: 16px; background: var(--cell); }
	.bot-choice p { margin: 0 0 8px; font-size: 13px; line-height: 1.5; }
	.bot-choice button { width: 100%; min-height: 44px; }
	.cta {
		position: sticky;
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
		margin-top: auto;
		padding: 18px 0 8px;
		/* 아래 목록이 버튼 뒤로 스며들게 — 바탕색으로 서서히 */
		background: linear-gradient(to bottom, transparent, var(--bg) 40%);
		z-index: 5;
		/* 위쪽 흐린 띠는 뒤의 목록 줄을 가로채지 않는다 — 버튼만 눌린다 (UX G1) */
		pointer-events: none;
	}
	.cta > :global(*) {
		pointer-events: auto;
	}

	.home {
		gap: 14px;
		padding-top: 12px;
		padding-bottom: 0; /* 아래 안전영역은 탭바가 맡는다 · 버튼 여백은 .cta 가 */
		background: var(--ambient) no-repeat;
	}

	/* 누름 반응 (UX G2) */
	.nudge:active {
		transform: scale(0.96);
	}
	.nudge {
		transition: transform 0.15s;
	}

	/* 찾는 중 — 레이더 */
	.radar {
		position: relative;
		flex: 1;
		display: grid;
		place-items: center;
		min-height: 300px;
	}
	.radar i {
		position: absolute;
		width: 110px;
		height: 110px;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--g-coral) 30%, transparent), transparent 70%);
		border: 1.5px solid color-mix(in srgb, var(--g-pink) 45%, transparent);
		animation: ripple 2.7s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
	}
	.radar i:nth-child(2) {
		animation-delay: 0.9s;
	}
	.radar i:nth-child(3) {
		animation-delay: 1.8s;
	}
	@keyframes ripple {
		from {
			transform: scale(0.8);
			opacity: 0.9;
		}
		to {
			transform: scale(3);
			opacity: 0;
		}
	}
	.me-ring {
		position: relative;
		padding: 4px;
		border-radius: 50%;
		background: var(--brand);
		box-shadow: var(--glow);
		animation: breathe 2.7s ease-in-out infinite;
	}
	.me-ring :global(.av) {
		border: 4px solid var(--bg);
	}
	@keyframes breathe {
		50% {
			transform: scale(1.05);
		}
	}

	.nudge {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 16px;
		border-radius: var(--r-md);
		background: var(--surface);
		box-shadow: var(--shadow-1);
		text-align: left;
		font-size: 13px;
	}
	.nudge span {
		color: var(--text-2);
		font-size: 12px;
	}

	.notice {
		padding: 12px 16px;
		border-radius: var(--r-md);
		background: var(--surface);
		box-shadow: var(--shadow-1);
		font-size: 13px;
	}
	.maint-soon {
		background: color-mix(in srgb, #f59e0b 14%, var(--surface));
		color: var(--text);
		font-weight: 600;
	}

	/* 찾는 중 — 버튼 자리에 그대로 들어간다 (유리 알약) */
	.seek {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 54px;
		padding: 10px 12px 10px 18px;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: var(--shadow-2);
	}
	.seek-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		font-size: 12px;
		line-height: 1.4;
	}
	.seek-text strong {
		font-size: 14px;
	}
	/* 로고(맨 위로) — 글자는 그대로, 누름 높이 44 */
	.logo {
		position: relative;
	}
	/* 누름 높이 44 — 로고 글자(27px · line-height 1, Phase 58)는 29 라서 위아래로 넓힌다 */
	.logo::after {
		content: '';
		position: absolute;
		inset: -9px 0;
	}
	.stop:active {
		transform: scale(0.94);
	}
	.stop {
		flex: none;
		height: 44px;
		transition: transform 0.15s;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--field);
		font-size: 14px;
		font-weight: 700;
	}
	.dots {
		display: flex;
		gap: 5px;
		flex: none;
	}
	.dots i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--g-orange);
		animation: pulse 1.2s infinite;
	}
	/* 아이콘 그라디언트를 점 셋에 나눠 싣는다 */
	.dots i:nth-child(2) {
		background: var(--g-coral);
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		background: var(--g-pink);
		animation-delay: 0.4s;
	}
	@keyframes pulse {
		0%,
		60%,
		100% {
			opacity: 0.2;
			transform: scale(0.85);
		}
		30% {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* 빈 상태 — 천천히 도는 브랜드색 빛 덩어리 위에 유리 카드 */
	.hero {
		position: relative;
		flex: 1;
		display: grid;
		place-items: center;
		min-height: 320px;
		padding-bottom: 20px;
	}
	.orb {
		position: absolute;
		width: 260px;
		height: 260px;
		border-radius: 50%;
		background: conic-gradient(from 0deg, var(--g-orange), var(--g-pink), #ffb347, var(--g-coral), var(--g-orange));
		filter: blur(42px);
		opacity: 0.55;
		animation:
			spin 14s linear infinite,
			breathe 6s ease-in-out infinite;
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
	.hero-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 30px 34px 26px;
		border-radius: 32px;
		background: color-mix(in srgb, var(--surface) 62%, transparent);
		-webkit-backdrop-filter: blur(24px) saturate(160%);
		backdrop-filter: blur(24px) saturate(160%);
		border: 1px solid color-mix(in srgb, var(--surface) 60%, transparent);
		box-shadow: var(--shadow-2);
		text-align: center;
	}
	.hero-card p {
		margin: 0;
		font-size: 13px;
		color: var(--text-2);
	}
	/* 두 말풍선 — 상대(유리) · 나(브랜드 그라디언트)가 번갈아 살짝 떠오른다 */
	.talk {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 190px;
		margin-bottom: 6px;
	}
	.say {
		max-width: 80%;
		padding: 9px 16px;
		border-radius: 22px;
		font-family: var(--display);
		font-size: 24px;
		font-weight: 400;
		line-height: 1.1;
		animation: float 4s ease-in-out infinite;
	}
	.say.them {
		align-self: flex-start;
		border-bottom-left-radius: 6px;
		background: var(--surface);
		box-shadow: var(--shadow-1);
		color: var(--text);
	}
	.say.me {
		align-self: flex-end;
		border-bottom-right-radius: 6px;
		background: var(--bubble-fill);
		box-shadow: var(--glow);
		color: var(--on-accent);
		animation-delay: -2s;
	}
	@keyframes float {
		50% {
			transform: translateY(-4px);
		}
	}
	h1 {
		margin: 6px 0 0;
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
</style>

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

<div class="topbar root">
	<h1 class="title">채팅</h1>
	<TopbarMe />
</div>

<div class="page home">
	{#if S.hasPassword === false}
		<div class="notice-panel">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13v10h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
			<span>비밀번호 없음</span>
			<button class="notice-action" onclick={() => goto('/settings#password')}>만들기</button>
		</div>
	{/if}

	{#if S.settings?.notice}
		<div class="notice-panel selectable">
			<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 11v5.5M12 7.6v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
			<span>{S.settings.notice}</span>
		</div>
	{/if}

	{#if S.maintAt}
		<!-- 점검 예고 (Phase 53) — 24시간 안에 예약된 서버 점검 -->
		{@const at = new Date(S.maintAt)}
		<div class="notice-panel warn" role="status">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8 21 19.5H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /><path d="M12 10v4.4M12 16.9v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
			<span>
				{at.toDateString() === new Date(S.now).toDateString() ? '오늘' : '내일'}
				{at.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 서버 점검
			</span>
		</div>
	{/if}

	<PinnedStories rooms={pinnedRooms} onmenu={(r) => (menuFor = r)} />

	<!-- 대화 목록 -->
	{#if liveRooms.length}
		<RoomList rooms={liveRooms} count={openCount} max={maxRooms} onmenu={(r) => (menuFor = r)} />
	{:else if inbox.loaded && seeker.seeking}
		<!-- 찾는 중 — 내 얼굴을 가운데 두고 퍼져 나가는 primary 물결 -->
		<div class="radar" aria-hidden="true" in:surface={{ y: 0, scale: 0.96 }}>
			<i></i><i></i><i></i>
			<span class="me-ring"><Avatar name={S.profile?.nickname ?? '나'} size={88} /></span>
		</div>
	{:else if !inbox.loaded && inbox.failed}
		<!-- 대화 목록을 한 번도 못 불러왔다 — 빈 홈으로 보이지 않게 오류 + 다시 시도 (UX G4) -->
		<div class="pt-empty error" role="alert">
			<span class="pt-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 7.5v5.5M12 16.3v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></span>
			<h2>대화 목록을 불러오지 못했어요</h2>
			<button class="btn-ghost" onclick={retryRooms} disabled={retrying} aria-busy={retrying}>{retrying ? '불러오는 중' : '다시 시도'}</button>
		</div>
	{:else if !inbox.loaded}
		<!-- 처음 불러오는 중 — 대화 줄 모양의 빈 자리 -->
		<div class="rooms-skeleton" aria-hidden="true">
			{#each [0, 1, 2] as i (i)}<div class="sk-row"><i class="skeleton sk-av"></i><span><i class="skeleton sk-t"></i><i class="skeleton sk-b"></i></span></div>{/each}
		</div>
		<span class="sr-only" role="status">불러오는 중</span>
	{:else}
		<!-- 빈 홈 — 아이콘 원 + 제목 한 줄. 할 일(새 대화 찾기)은 하단 영역의 주 버튼 -->
		<div class="pt-empty" in:surface={{ y: 14, scale: 1 }}>
			<span class="pt-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4.4c-4.4 0-7.9 3.2-7.9 7.2 0 2.2 1 4.1 2.7 5.4l-.5 2.5 2.7-1.3c.9.4 1.9.6 3 .6 4.4 0 7.9-3.2 7.9-7.2S16.4 4.4 12 4.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg></span>
			<h2>아직 대화가 없어요</h2>
		</div>
	{/if}

	<!-- 하단 영역 — 새 상대 찾기 (탭 바로 위) -->
	<div class="dock-action">
		{#if offerBot && !bot}
			<div class="notice-panel bot-choice">
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="7.5" width="15" height="11" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 4v3.5M9.5 12.5v.1M14.5 12.5v.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
				<span>기다리는 동안<small>AI에 입력한 대화는 Cloudflare로 전달돼요</small></span>
				<button class="notice-action" onclick={startBot} disabled={botBusy} aria-busy={botBusy}>{botBusy ? '준비 중' : 'AI와 대화하기'}</button>
			</div>
		{/if}
		{#if seeker.seeking}
			<div class="notice-panel seek">
				<div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
				<span>
					찾는 중 <span class="num muted">{elapsed}</span>
					<small>
						{#if seeker.reason === 'cooldown'}
							잠깐 쉬었다가 다시 찾을게요
						{:else if seeker.reason === 'filtered'}
							조건이 맞는 사람이 없어요
						{:else if seeker.reason === 'empty'}
							{canHoldScreen() ? '찾는 동안 화면을 켜 둘게요' : '화면을 켜 두면 계속 찾아요'}
						{:else}
							잠시만요
						{/if}
					</small>
				</span>
				<button class="notice-action" onclick={() => seeker.cancel()}>그만</button>
			</div>
		{:else if profileMissing}
			<!-- 계정 정보를 못 불러왔다 — 앱을 껐다 켜지 않아도 되게 여기서 다시 시도 (UX G4) -->
			<div class="notice-panel danger" role="alert">
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 7.5v5.5M12 16.3v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
				<span>계정 정보를 불러오지 못했어요</span>
				<button class="notice-action" onclick={() => void retryAccount()}>다시 시도</button>
			</div>
		{:else if closed}
			<button class="btn" disabled>지금은 열려 있지 않아요</button>
		{:else if suspended}
			<button class="btn" disabled>
				{suspendedUntil ? `${suspendedUntil}까지 이용 제한` : '이용 제한된 계정'}
			</button>
		{:else if full}
			<button class="btn" disabled>대화는 동시에 {maxRooms}개까지</button>
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
	.home {
		gap: 12px;
		padding-bottom: 0; /* 아래 안전영역은 탭바가 맡는다 · 버튼 여백은 .dock-action 이 */
	}
	.rooms-skeleton { display: flex; flex-direction: column; padding-top: 52px; }
	.sk-row { display: flex; align-items: center; gap: 14px; min-height: 72px; }
	.sk-row span { display: flex; flex: 1; flex-direction: column; gap: 8px; }
	.sk-av { width: 52px; height: 52px; border-radius: 50%; }
	.sk-t { width: 40%; height: 14px; }
	.sk-b { width: 65%; height: 12px; }

	/* 찾는 중 — primary 물결 */
	.radar {
		position: relative;
		flex: 1;
		display: grid;
		place-items: center;
		min-height: 300px;
	}
	.radar i {
		position: absolute;
		width: 96px;
		height: 96px;
		border-radius: 50%;
		border: 2px solid var(--primary-mark);
		animation: ripple 2.7s var(--ease-squish) infinite;
	}
	.radar i:nth-child(2) {
		animation-delay: 0.9s;
	}
	.radar i:nth-child(3) {
		animation-delay: 1.8s;
	}
	@keyframes ripple {
		from {
			transform: scale(0.9);
			opacity: 0.9;
		}
		to {
			transform: scale(3);
			opacity: 0;
		}
	}
	.me-ring {
		position: relative;
		padding: 3px;
		border-radius: 50%;
		background: var(--primary);
	}
	.me-ring :global(.av) {
		border: 3px solid var(--bg);
	}

	/* 찾는 중 — 주 버튼 자리에 회색 패널로 */
	.seek {
		min-height: 54px;
	}
	.dots {
		display: flex;
		gap: 4px;
		flex: none;
	}
	.dots i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--primary-icon);
		animation: pulse 1.2s infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes pulse {
		0%,
		60%,
		100% {
			opacity: 0.25;
			transform: scale(0.85);
		}
		30% {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>

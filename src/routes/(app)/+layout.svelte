<script lang="ts">
	import { setContext, untrack } from 'svelte';
	import { page } from '$app/state';
	import { useTabBack } from '$lib/tabBack.svelte';
	import { checkGate, lettersState } from '$lib/letters/gate.svelte';
	import { S, toast } from '$lib/state.svelte';
	import { Seeker } from '$lib/seeker.svelte';
	import { MATCHING_CONTEXT } from '$lib/matching';
	import { onAccountChange } from '$lib/accountScope';
	import { navigateFromOverlay } from '$lib/overlay.svelte';
	import { isRestricted } from '$lib/restriction';
	import { mmss } from '$lib/time';
	import Tour from '$lib/ui/Tour.svelte';
	import CnsaBadgeTour from '$lib/ui/CnsaBadgeTour.svelte';
	import { whileVisible } from '$lib/visible';
	import { DM, refreshUnread } from '$lib/letters/unread.svelte';
	import AchievementCelebrate from '$lib/ui/AchievementCelebrate.svelte';
	import PullRefresh from '$lib/ui/PullRefresh.svelte';
	import { INBOX } from '$lib/inbox.svelte';
	import { notifyInApp } from '$lib/inapp.svelte';
	import { pushState } from '$lib/push';
	import { holdScreenOn } from '$lib/wakeLock';

	/** 이만큼 넘게 앱을 떠나 있었으면 서버 대기에서 빠져 있었다 (seek_ttl_sec 기본 15초) */
	const SEEK_AWAY_MS = 15_000;

	/**
	 * 앱 화면 공통 틀 — 하단 탭 3개 (왼쪽 익명편지 · 가운데 채팅 · 오른쪽 프로필).
	 *
	 * 탭은 세 "뿌리" 화면(/letters, /, /me)에서만 보인다. 대화방·편지 상세·편지 쓰기·공지·설정은
	 * 뒤로가기 화살표로 돌아오는 화면이라 탭을 숨긴다 — 키보드가 뜬 상태에서 화면이 더 좁아지지 않게.
	 * 탭이 있는 동안 아래쪽 안전영역(아이폰 홈 막대)은 탭바가 맡는다.
	 */
	let { children } = $props();
	const seeker = setContext(MATCHING_CONTEXT, new Seeker(
		(roomId) => void navigateFromOverlay(`/chat/${roomId}`, { state: { matched: true } }),
		toast
	));
	$effect(() => {
		const unsubscribe = onAccountChange(() => seeker.reset());
		return () => { unsubscribe(); seeker.cancel(); };
	});
	$effect(() => {
		if (seeker.seeking && (!S.session || S.settings?.is_open === false || (S.profile && isRestricted(S.profile, S.now))))
			untrack(() => seeker.cancel());
	});
	const elapsed = $derived(seeker.seeking ? mmss(Math.floor((S.now - seeker.since) / 1000)) : '');

	const path = $derived(page.url.pathname);
	const showTabs = $derived(path === '/' || path === '/letters' || path === '/me');
	// 찾기는 탭(홈 · 익명편지 · 프로필)과 잠깐 들여다보고 돌아오는 화면(알림 · 공지 · 설정 · 약관 · 업적)에서 이어진다 —
	// 찾는 중에 위의 하트 · 설정을 눌렀다고 대기가 사라지지 않게. 그 화면에도 아래 대기 막대를 띄워 매칭되면 이동한다고 미리 알린다.
	// 쓰던 글이 있는 화면(편지 쓰기 · 답장 · 문의 · 삭제 요청 · 뱃지 제출)과 다른 대화방 · 편지 읽기는 예고 없이 빠져나가면 안 되므로 멈춘다.
	// 매칭으로 대화방에 갈 때는 찾기가 이미 끝나 있다.
	const keepSeeking = $derived(showTabs || /^\/(activity|notices\/\d+|settings(\/(terms|privacy|policy))?|me\/achievements)\/?$/.test(path));
	$effect(() => {
		if (seeker.seeking && !keepSeeking) untrack(() => {
			seeker.cancel();
			toast('다른 화면으로 이동해서 상대 찾기를 멈췄어요');
		});
	});
	// 찾는 동안 — 화면이 저절로 꺼져 대기에서 빠지지 않게 켜 두고(lib/wakeLock), 다른 앱에 다녀오면 그동안은 못 찾았다고 알린다.
	// 앱이 안 보이는 동안은 서버에 묻지 않아(PollSeeker) 서버 풀에서 빠지는 시간(seek_ttl_sec 기본 15초)이 지나면 대기가 비어 있었다.
	$effect(() => {
		if (!seeker.seeking) return;
		const release = untrack(holdScreenOn);
		let hiddenAt = 0;
		const onVis = () => {
			if (document.visibilityState === 'hidden') hiddenAt = Date.now();
			else if (hiddenAt) {
				if (Date.now() - hiddenAt > SEEK_AWAY_MS) toast('앱을 나가 있는 동안은 상대를 찾지 못했어요 · 다시 찾고 있어요');
				hiddenAt = 0;
			}
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			release();
			document.removeEventListener('visibilitychange', onVis);
		};
	});
	const onLetters = $derived(path === '/letters');
	const onChat = $derived(path === '/');
	const onMe = $derived(path === '/me');

	// 안 읽은 편지 — 익명편지 탭 위 빨간 점. 앱이 보이는 동안 2분마다 (새 편지는 푸시로도 알린다)
	// 익명편지가 잠겨 있는 동안(Phase 44)은 묻지 않는다 — 새 편지가 올 수 없다
	$effect(() => whileVisible(() => lettersState() === 'open' && void refreshUnread(), 120_000));
	// 처음 한 번 — 편지가 열려 있으면 바로, 잠겨 있으면 열리는 순간에 (앱을 켤 때 이미 열렸는지 한 번 본다: checkGate)
	$effect(() => {
		if (!S.settings) return;
		untrack(checkGate);
	});
	$effect(() => {
		if (lettersState() === 'open') untrack(() => void refreshUnread());
	});

	// ── 대화 목록 · 앱 안 알림 (Phase 35) ──
	// 대화 목록(INBOX)은 앱이 떠 있는 동안 계속 켜 둔다 — 홈에 돌아오면 바로 그려지고, 다른 화면을 보는 중에 새 메시지가 오면
	// 위에서 알림 띠가 내려온다 (알림 권한이 없어도). 그 대화를 보고 있으면 띄우지 않는다 (notifyInApp 이 주소로 거른다).
	$effect(() => {
		INBOX.onNew = (r) =>
			notifyInApp(
				{
					key: r.room_id,
					title: r.partner_alias,
					body: r.joined ? (r.last_body ?? '새 메시지') : '새 대화 상대와 연결됐어요',
					url: `/chat/${r.room_id}`,
					kind: 'chat'
				},
				`${r.room_id}|${(r.last_body ?? '').slice(0, 60)}`
			);
		INBOX.start();
		return () => {
			INBOX.onNew = null;
			INBOX.stop();
		};
	});
	// 편지 — 푸시 알림을 안 켠 기기는 안 읽은 편지 수가 늘어난 것으로 알려 준다 (켠 기기는 서비스워커가 알린다)
	let lastUnread = -1;
	$effect(() => {
		const n = DM.unread;
		if (!DM.loaded) return;
		if (lastUnread >= 0 && n > lastUnread && pushState() !== 'granted')
			notifyInApp({ key: 'dm', title: '새 편지가 왔어요', body: '봉투를 열어 확인해 보세요', url: '/letters?take=new', kind: 'letter' }, `dm|${n}`);
		lastUnread = n;
	});

	const { switchTab } = useTabBack(); // 뒤로가기: 익명편지·프로필 → 홈, 홈 → 두 번 누르면 종료 (lib/tabBack.svelte.ts)
</script>

{@render children()}

{#if seeker.seeking && keepSeeking && !onChat}
	{#if !showTabs}<div class="matching-pad" aria-hidden="true"></div>{/if}
	<aside class="matching-bar" class:no-tabs={!showTabs} aria-label="매칭 대기">
		<a href="/" class="matching-status"><span class="matching-dot" aria-hidden="true"></span><span>상대 찾는 중 <span class="num muted">{elapsed}</span><small>연결되면 대화방으로 이동해요</small></span></a>
		<button class="u-tap" onclick={() => seeker.cancel()}>그만 찾기</button>
	</aside>
{/if}

<!-- 당겨서 새로고침 (Phase 37) — 탭 첫 화면 맨 위에서 -->
{#if showTabs}<PullRefresh />{/if}

<!-- 새로 딴 업적 축하 (Phase 31) — 탭 첫 화면에서만 뜬다 -->
<AchievementCelebrate />

<!-- 사용법 안내 (Phase 44 · 89) — 홈 · 프로필 · 익명편지에 처음 왔을 때 한 번씩 (건너뛸 수 있다 · 설정에서 다시 보기) -->
<Tour />

<!-- CNSA 뱃지 안내 (Phase 84 · 89) — 프로필 안내의 끝에 이어서 한 번 (업적 화면 · 설정에서 다시 보기) -->
<CnsaBadgeTour />

{#if showTabs}
	<!-- 탭바에 가려지지 않게 같은 높이만큼 비워 둔다 -->
	<div class="tabbar-space" class:matching-space={seeker.seeking && !onChat} aria-hidden="true"></div>
	<nav class="tabbar" aria-label="주 메뉴" style:--tab-index={onLetters ? 0 : onChat ? 1 : 2}>
		<span class="tab-indicator" aria-hidden="true"></span>
		<a class="tab" class:on={onLetters} href="/letters" onclick={(e) => switchTab(e, '/letters')} aria-current={onLetters ? 'page' : undefined}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{#if onLetters}
					<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z" fill="currentColor" />
					<path d="M4 7l8 6 8-6" fill="none" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
				{:else}
					<path d="M3.9 6.5A1.6 1.6 0 0 1 5.5 4.9h13a1.6 1.6 0 0 1 1.6 1.6v11a1.6 1.6 0 0 1-1.6 1.6h-13a1.6 1.6 0 0 1-1.6-1.6v-11z" fill="none" stroke="currentColor" stroke-width="1.8" />
					<path d="M4.5 7.5l7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
				{/if}
			</svg>
			<span>익명편지</span>
			{#if DM.unread > 0 && lettersState() === 'open'}<span class="tab-dot" aria-label="안 읽은 편지 {DM.unread}통"></span>{/if}
		</a>
		<a class="tab" class:on={onChat} href="/" onclick={(e) => switchTab(e, '/')} aria-current={onChat ? 'page' : undefined}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{#if onChat}
					<path d="M12 3.5c-4.9 0-8.8 3.6-8.8 8.1 0 2.4 1.1 4.5 2.9 6l-.6 3 3.2-1.6c1 .4 2.1.6 3.3.6 4.9 0 8.8-3.6 8.8-8.1S16.9 3.5 12 3.5z" fill="currentColor" />
				{:else}
					<path d="M12 4.4c-4.4 0-7.9 3.2-7.9 7.2 0 2.2 1 4.1 2.7 5.4l-.5 2.5 2.7-1.3c.9.4 1.9.6 3 .6 4.4 0 7.9-3.2 7.9-7.2S16.4 4.4 12 4.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
				{/if}
			</svg>
			<span>채팅</span>
		</a>
		<a class="tab" class:on={onMe} href="/me" onclick={(e) => switchTab(e, '/me')} aria-current={onMe ? 'page' : undefined}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{#if onMe}
					<circle cx="12" cy="8" r="4.2" fill="currentColor" />
					<path d="M3.8 20.2c.8-4 4.2-6.3 8.2-6.3s7.4 2.3 8.2 6.3c.1.5-.3.8-.7.8H4.5c-.4 0-.8-.3-.7-.8z" fill="currentColor" />
				{:else}
					<circle cx="12" cy="8" r="3.9" fill="none" stroke="currentColor" stroke-width="1.8" />
					<path d="M4.6 20.1c.8-3.6 3.8-5.6 7.4-5.6s6.6 2 7.4 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
				{/if}
			</svg>
			<span>프로필</span>
		</a>
	</nav>
{/if}

<style>
	.matching-bar { position: fixed; z-index: 30; left: max(12px, calc((100vw - 536px) / 2)); right: max(12px, calc((100vw - 536px) / 2)); bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px); display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 18px; background: var(--cell); box-shadow: var(--shadow-2); }
	.matching-status { display: flex; flex: 1; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; font-weight: 700; }
	.matching-status small { display: block; margin-top: 3px; color: var(--text-2); font-size: 12px; font-weight: 400; }
	.matching-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--accent); }
	.matching-bar button { min-height: 44px; flex: none; color: var(--accent); font-weight: 700; }
	.matching-space { height: calc(var(--tabbar-h) + 84px); }
	/* 탭바가 없는 화면(알림 · 설정 …) — 화면 맨 아래에 붙이고, 내용 끝이 막대에 가려지지 않게 그만큼 비운다 */
	.matching-bar.no-tabs { bottom: calc(env(safe-area-inset-bottom) + 12px); }
	.matching-pad { flex: none; height: calc(env(safe-area-inset-bottom) + 92px); }
	/* 키보드가 떠 있으면 입력칸을 가리지 않게 숨긴다 (찾기는 이어진다) */
	:global(html.kb-open) .matching-bar, :global(html.kb-open) .matching-pad { display: none; }
</style>

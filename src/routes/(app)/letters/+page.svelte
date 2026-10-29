<script lang="ts">
	/**
	 * 익명편지 탭 = 편지함 (Phase 32 · 35 · 71 · 72 · 79).
	 *   위: 벽에 걸린 우체통. 안 읽은 편지는 우체통 안에 있다 (Phase 79 — 전엔 책상 위에 봉투로 쌓였다):
	 *       오른쪽 위에 빨간 점 (투입구에 봉투 끝은 안 보인다). 새 편지가 오면 봉투가 위에서 떨어져 투입구로 들어가고 → 통이 출렁 · 위에 "+✉" · 빨간 점 (한 통에 한 번).
	 *       누르면 가장 최근에 온 안 읽은 편지를 꺼낸다 — 편지 화면이 같은 자리의 같은 우체통으로 이어 받아(KNOCK) 통이 두 번 덜컹 → 투입구에서 편지가 나와 → 열어 읽는다.
	 *       편지를 보내고 돌아오면 우체통 위에 "+✉" · 보낸 편지가 책상 더미에 내려앉는다.
	 *       알림을 누르고 오면(?take=편지 번호 · new, Phase 80) 우체통을 보여 준 뒤(새 편지면 투입구로 떨어지는 것까지) 스스로 눌러 그 편지를 꺼낸다.
	 *   아래 (포인트 디자인 시스템): 새 편지 줄(안 읽은 편지) · 편지 보관함 줄(받은 · 보낸 · 폴더 → /letters/archive),
	 *   편지 쓰기는 하단 영역의 주 버튼.
	 * 목록은 앱 안에서 기억해 두고(mailbox.svelte.ts) 다시 들어오면 바로 그린 뒤 뒤에서 새로 읽는다.
	 */
	import { onDestroy, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopbarMe from '$lib/ui/TopbarMe.svelte';
	import Postbox from '$lib/letters/Postbox.svelte';
	import { otherLabel, stampDate } from '$lib/letters/api';
	import { ANNOUNCED, BOX, KNOCK, PAGE, POSTED, pollMailbox, reloadMailbox } from '$lib/letters/mailbox.svelte';
	import { reducedMotion } from '$lib/motion';
	import { PREFS } from '$lib/prefs.svelte';
	import * as haptic from '$lib/haptics';
	import { whileVisible } from '$lib/visible';
	import { TOUR } from '$lib/tour.svelte';
	import { LIST } from '$lib/letters/unread.svelte';

	const timers: ReturnType<typeof setTimeout>[] = [];
	onDestroy(() => timers.forEach(clearTimeout));
	let added = $state(0);
	let firstLoad: Promise<void> | null = null; // 들어올 때 새로 읽는 것 — 알림에서 왔을 때 한 번 더 읽지 않고 같이 기다린다
	$effect(() => {
		const loaded = (firstLoad = untrack(reloadMailbox));
		// 방금 편지를 보냈다 (Phase 72) — 목록을 새로 읽은 뒤(더미 맨 위가 그 편지) 우체통 위에 "+✉" · 책상 더미에 내려앉는다
		if (POSTED.pending) {
			POSTED.pending = false;
			if (!reducedMotion())
				void loaded.then(() => {
					added++;
				});
		}
		return whileVisible(pollMailbox, 120_000);
	});

	const unread = $derived(BOX.received.filter((i) => !i.opened && !i.removed));

	// ── 우체통으로 편지가 온다 (Phase 71 · 72 · 79) ──
	// 처음 보는 안 읽은 편지가 생기면: 봉투가 투입구로 떨어지고(0) → 출렁 · "+✉" · 빨간 점(0.8s, Postbox). 편지는 우체통 안에 그대로
	let drop = $state(0);
	let dropN = $state(1);
	let bump = $state(0);
	$effect(() => {
		if (!BOX.loaded.received) return;
		const news = unread.filter((i) => !ANNOUNCED.has(i.id)).map((i) => i.id);
		if (!news.length) return;
		news.forEach((id) => ANNOUNCED.add(id));
		if (reducedMotion()) return;
		untrack(() => {
			dropN = news.length;
			drop++;
		});
		dropAt = performance.now();
		haptic.select();
	});
	// 편지 꺼내기 (Phase 79) — 지금 우체통 자리 · 크기를 적어 두고 편지 화면으로 (넘김 없이 같은 우체통이 이어서 두 번 덜컹 → 투입구에서 편지)
	// 스크롤로 우체통이 올라가 있으면 자리가 안 맞아 평소처럼 넘긴다
	let wallEl = $state<HTMLElement>();
	let postEl = $state<HTMLElement>();
	function tapPostbox() {
		const first = unread[0];
		if (first) takeOut(first.id);
		else bump++;
	}
	function takeOut(id: number) {
		if (wallEl && postEl && !reducedMotion() && PREFS.envelope && scrollY < 2) {
			const w = wallEl.getBoundingClientRect();
			const p = postEl.getBoundingClientRect();
			// 이 화면 머리글(탭 첫 화면 64)이 편지 화면 머리글(--header-h 48)보다 높은 만큼 벽을 위로 늘려 넘긴다 — 우체통이 같은 자리에
			const bar = document.querySelector<HTMLElement>('.topbar.root');
			const lift = bar ? bar.offsetHeight - parseFloat(getComputedStyle(bar).paddingTop) - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) : 0;
			KNOCK.hand = { w: p.width, top: p.top - w.top + lift, wallH: w.height + lift, count: unread.length };
			KNOCK.at = performance.now();
		}
		void goto(`/letters/m/${id}`);
	}

	// ── 알림에서 왔다 (Phase 80) — ?take=편지 번호 (new = 가장 최근에 온 안 읽은 편지) ──
	// 목록을 새로 읽고 → 우체통을 잠깐 보여 준 뒤(새 편지가 투입구로 떨어지는 중이면 다 들어갈 때까지) → 스스로 눌러 꺼낸다.
	// 주소의 ?take 는 먼저 지운다 — 편지를 읽고 뒤로 와도 다시 꺼내지 않게. 이미 연 편지면 그냥 그 편지로
	let dropAt = 0;
	let gone = false;
	onDestroy(() => {
		gone = true;
		TOUR.hold = false;
	});
	let taking: string | null = null; // 지금 꺼내는 중인 것 — 탭의 뒤로가기 기록(guard)이 쌓이며 주소가 다시 읽혀도 한 번만
	$effect(() => {
		const take = page.url.searchParams.get('take');
		if (take === taking) return;
		taking = take;
		if (!take) return;
		untrack(() => {
			TOUR.hold = true; // 곧 편지 화면으로 넘어간다 — 그 사이에 익명편지 안내가 떴다 사라지지 않게 (꺼낼 편지가 없으면 푼다)
			const p = firstLoad ?? reloadMailbox();
			firstLoad = null;
			void p.then(async () => {
				if (gone) return;
				// 기록을 바꿔 끼우는 진짜 이동으로 지운다 — 얕은 replaceState 는 page.url 을 그대로 둬서 뒤로 오면 다시 꺼냈다.
				// 기록 상태(page.state — 탭의 뒤로가기 guard)는 그대로 넘긴다. 비우면 tabBack 이 뒤로가기로 알고 홈으로 간다
				await goto('/letters', { replaceState: true, noScroll: true, keepFocus: true, state: page.state });
				await tick(); // 새 편지가 떨어지기 시작했는지(dropAt) 본 뒤에
				if (gone) return;
				const wait = Math.max(450, dropAt + 1250 - performance.now());
				timers.push(
					setTimeout(() => {
						const id = take === 'new' ? unread[0]?.id : Number(take);
						if (!id) return void (TOUR.hold = false);
						if (unread.some((i) => i.id === id)) takeOut(id);
						else void goto(`/letters/m/${id}`);
					}, wait)
				);
			});
		});
	});
	// 폴더에 넣은 편지는 보관함 목록(BOX.received · sent)에서 빠진다 — 폴더마다 받은 · 보낸 수를 더해야 편지 수가 줄지 않는다
	// (안 연 편지는 폴더에 못 넣으니 폴더의 받은 편지는 모두 읽은 편지)
	const filed = $derived(BOX.folders.reduce((n, f) => ({ received: n.received + (f.received ?? 0), sent: n.sent + (f.sent ?? 0) }), { received: 0, sent: 0 }));
	const readCount = $derived(BOX.received.length - unread.length + filed.received);
	const sentCount = $derived(BOX.sent.length + filed.sent);
	const count = (n: number, more: boolean) => (more ? `${Math.max(n, PAGE)}+` : String(n));
	const loaded = $derived(BOX.loaded.received && BOX.loaded.sent && !BOX.loading.received && !BOX.loading.sent);
	const loadError = $derived(BOX.error.received ?? BOX.error.sent);

</script>

<div class="topbar root">
	<h1 class="title">익명편지</h1>
	<TopbarMe />
</div>

<div class="page mailbox">
	<!-- 우체통 — 새 편지가 여기로 온다. 누르면 가장 최근에 온 안 읽은 편지를 꺼낸다 -->
	<div class="wall" bind:this={wallEl}>
		<button
			class="post"
			bind:this={postEl}
			onclick={tapPostbox}
			aria-label={unread.length ? `우체통 — 새 편지 ${unread.length}통, 눌러서 가장 최근 편지 꺼내기` : BOX.error.received ? '우체통 — 편지를 불러오지 못했어요' : BOX.loaded.received && !BOX.loading.received ? '우체통 — 새 편지 없음' : '우체통'}
		>
			<Postbox count={unread.length} {drop} {dropN} {added} {bump} />
		</button>
	</div>

	{#if loadError}
		<div class="notice-panel danger" role="status">
			<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 7.5v5.5M12 16.3v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
			<span>불러오지 못했어요</span>
			<button class="notice-action" onclick={reloadMailbox}>다시 시도</button>
		</div>
	{/if}

	<!-- 새 편지 — 안 읽은 편지 줄. 누르면 우체통에서 꺼낸다 -->
	{#if unread.length}
		<div class="section">
			<h2>새 편지</h2>
			<span>{unread.length}</span>
		</div>
		<ul class="rows new-letters">
			{#each unread as it (it.id)}
				<li>
					<button class="list-row" onclick={() => takeOut(it.id)}>
						<span class="lr-icon" aria-hidden="true">{@render mail()}</span>
						<span class="lr-mid">
							<span class="lr-name">{otherLabel(it, 'received')}</span>
							<span class="lr-sub num">{stampDate(it.created_at)}</span>
						</span>
						<span class="pt-dot" aria-label="새 편지"></span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- 편지 보관함 — 지금까지 받은 · 쓴 편지 전부 (/letters/archive) -->
	<div class="section">
		<h2>편지 보관함</h2>
	</div>
	<ul class="rows letter-shelf">
		<li>
			<!-- 보관함은 마지막에 본 칸(LIST.tab)을 기억한다 — 누른 줄의 칸으로 열리게 먼저 정해 둔다 -->
			<a class="list-row" href="/letters/archive" onclick={() => (LIST.tab = 'received')}>
				<span class="lr-icon" aria-hidden="true">{@render tray()}</span>
				<span class="lr-mid"><span class="lr-name">받은 편지</span></span>
				<span class="lr-end">{loaded ? count(readCount, BOX.more.received) : ''}</span>
				{@render chev()}
			</a>
		</li>
		<li>
			<a class="list-row" href="/letters/archive" onclick={() => (LIST.tab = 'sent')}>
				<span class="lr-icon" aria-hidden="true">{@render send()}</span>
				<span class="lr-mid"><span class="lr-name">보낸 편지</span></span>
				<span class="lr-end">{loaded ? count(sentCount, BOX.more.sent) : ''}</span>
				{@render chev()}
			</a>
		</li>
		{#if BOX.folders.length}
			<li>
				<a class="list-row" href="/letters/archive">
					<span class="lr-icon" aria-hidden="true">{@render folder()}</span>
					<span class="lr-mid"><span class="lr-name">폴더</span></span>
					<span class="lr-end">{BOX.folders.length}</span>
					{@render chev()}
				</a>
			</li>
		{/if}
	</ul>

	<!-- 하단 영역 — 편지 쓰기 -->
	<div class="dock-action">
		<a class="btn" href="/letters/new">편지 쓰기</a>
	</div>
</div>

{#snippet mail()}<svg viewBox="0 0 24 24"><path d="M3.9 6.5A1.6 1.6 0 0 1 5.5 4.9h13a1.6 1.6 0 0 1 1.6 1.6v11a1.6 1.6 0 0 1-1.6 1.6h-13a1.6 1.6 0 0 1-1.6-1.6z" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M4.5 7.5l7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{/snippet}
{#snippet tray()}<svg viewBox="0 0 24 24"><path d="M4 13.5 6.5 5h11L20 13.5V19H4zM4 13.5h4.5l1.2 2.5h4.6l1.2-2.5H20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>{/snippet}
{#snippet send()}<svg viewBox="0 0 24 24"><path d="M20.5 3.5 3.5 10.5l7 2.5 2.5 7z M10.5 13l5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg>{/snippet}
{#snippet folder()}<svg viewBox="0 0 24 24"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>{/snippet}
{#snippet chev()}<svg class="lr-chev" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>{/snippet}

<style>
	.mailbox {
		gap: 0;
		padding-bottom: 0; /* 아래는 하단 영역(.dock-action)이 */
	}
	/* 우체통 자리 — 편지 화면(/letters/m)이 같은 자리 · 높이로 이어 받는다 (KNOCK.hand) */
	.wall {
		display: flex;
		justify-content: center;
		margin: 0 calc(var(--pad) * -1);
		padding: 8px var(--pad) 12px;
		background: var(--wall);
	}
	.post {
		display: block;
		width: min(58%, 220px);
		-webkit-tap-highlight-color: transparent;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows a.list-row {
		color: inherit;
	}
	.dock-action .btn {
		text-decoration: none;
	}
</style>

<script lang="ts">
	/**
	 * 익명편지 탭 = 편지함 (Phase 32 · 35 · 71 · 72 · 79).
	 *   위: 벽에 걸린 우체통. 안 읽은 편지는 우체통 안에 있다 (Phase 79 — 전엔 책상 위에 봉투로 쌓였다):
	 *       오른쪽 위에 빨간 점 (투입구에 봉투 끝은 안 보인다). 새 편지가 오면 봉투가 위에서 떨어져 투입구로 들어가고 → 통이 출렁 · 위에 "+✉" · 빨간 점 (한 통에 한 번).
	 *       누르면 가장 최근에 온 안 읽은 편지를 꺼낸다 — 편지 화면이 같은 자리의 같은 우체통으로 이어 받아(KNOCK) 통이 두 번 덜컹 → 투입구에서 편지가 나와 → 열어 읽는다.
	 *       편지를 보내고 돌아오면 우체통 위에 "+✉" · 보낸 편지가 책상 더미에 내려앉는다.
	 *       알림을 누르고 오면(?take=편지 번호 · new, Phase 80) 우체통을 보여 준 뒤(새 편지면 투입구로 떨어지는 것까지) 스스로 눌러 그 편지를 꺼낸다.
	 *   아래: 갈색 책상 위 서류 더미 = 편지 보관함. 읽은 편지 · 보낸 편지가 겹겹이 쌓여 있고, 누르면 지금까지 받은 · 쓴 편지 전부 (/letters/archive).
	 *   책상은 화면 아래쪽에 놓이고(남는 자리는 위에), 책상 · 더미 · 봉투 · 우체통은 화면 크기에 맞춰 같은 비율로 커지고 작아진다 (Phase 46).
	 *   책상 앞 한 줄 = [편지 보관함 이름표 | 편지 쓰기] (Phase 71 — 전엔 편지 쓰기가 화면 위에 떠 있었다).
	 * 봉투를 길게 누르면(마우스는 오른쪽 클릭) 봉투 메뉴 — 열기 · 답장 · 버리기 · 차단 · 신고 (LetterMenu).
	 * 목록은 앱 안에서 기억해 두고(mailbox.svelte.ts) 다시 들어오면 바로 그린 뒤 뒤에서 새로 읽는다.
	 */
	import { onDestroy, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopbarMe from '$lib/ui/TopbarMe.svelte';
	import Envelope from '$lib/letters/Envelope.svelte';
	import Postbox from '$lib/letters/Postbox.svelte';
	import { borderOf, myLabel, otherLabel, stampDate } from '$lib/letters/api';
	import { ANNOUNCED, BOX, KNOCK, PAGE, POSTED, pollMailbox, reloadMailbox } from '$lib/letters/mailbox.svelte';
	import { reducedMotion } from '$lib/motion';
	import { PREFS } from '$lib/prefs.svelte';
	import * as haptic from '$lib/haptics';
	import { whileVisible } from '$lib/visible';
	import { S } from '$lib/state.svelte';
	import { TOUR } from '$lib/tour.svelte';

	const timers: ReturnType<typeof setTimeout>[] = [];
	onDestroy(() => timers.forEach(clearTimeout));
	let added = $state(0);
	let landing = $state(false);
	let firstLoad: Promise<void> | null = null; // 들어올 때 새로 읽는 것 — 알림에서 왔을 때 한 번 더 읽지 않고 같이 기다린다
	$effect(() => {
		const loaded = (firstLoad = untrack(reloadMailbox));
		// 방금 편지를 보냈다 (Phase 72) — 목록을 새로 읽은 뒤(더미 맨 위가 그 편지) 우체통 위에 "+✉" · 책상 더미에 내려앉는다
		if (POSTED.pending) {
			POSTED.pending = false;
			if (!reducedMotion())
				void loaded.then(() => {
					landing = true;
					added++;
					timers.push(setTimeout(() => (landing = false), 1400));
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
			KNOCK.hand = { w: p.width, top: p.top - w.top, wallH: w.height, count: unread.length };
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
	// 더미 맨 위 한 장 = 가장 최근에 읽은 받은 편지 (없으면 가장 최근에 보낸 편지)
	const top = $derived.by(() => {
		const r = BOX.received.find((i) => i.opened);
		const s = BOX.sent[0];
		if (r && (!s || r.id > s.id)) return { it: r, box: 'received' as const };
		return s ? { it: s, box: 'sent' as const } : null;
	});
	// 한 통이라도 있으면 겹겹이 쌓인 느낌이 나게 최소 네 장
	const pileSize = $derived(readCount + sentCount ? Math.min(7, Math.max(4, readCount + sentCount + 1)) : 0);
	const loaded = $derived(BOX.loaded.received && BOX.loaded.sent && !BOX.loading.received && !BOX.loading.sent);
	const loadError = $derived(BOX.error.received ?? BOX.error.sent);
	// 봉투에 적힌 나 (받은 편지의 To. · 보낸 편지의 From.)
	const me = (it: (typeof BOX.received)[number], box: 'received' | 'sent') => myLabel(it, box, { name: S.me?.name, gender: S.profile?.gender });

	// 서류 더미 — 한 장씩 조금씩 어긋나게 (맨 아래일수록 크게)
	// 책상 비율 — 폭 390 · 높이 844 폰에서 1. 좁거나 낮은 화면은 작게, 넓고 높은 화면(태블릿 · 데스크톱 창)은 크게
	// 아래 끝 0.75 = 아이폰 SE(375×667) · 큰 글꼴 안드로이드(≈280×574)에서도 책상 이름표가 편지 쓰기 단추 위에 오게 (Phase 47)
	let deskW = $state(390);
	let vh = $state(844);
	const k = $derived(Math.min(1.5, Math.max(0.75, Math.min(deskW / 390, vh / 844))));

	// 책상 누르기 (Phase 82) — 책상이 통째로 줄지 않고 누른 것만 반응한다: 서류 더미 · 이름표는 눌리고 → 보관함,
	// 책상 위 물건(머그 · 펜 · 연필 · 포스트잇 · 봉인 · 클립)은 그것만 톡 튀어 오른다 (보관함으로 가지 않는다)
	function tapDesk(e: MouseEvent) {
		const prop = (e.target as Element | null)?.closest<SVGElement>('.prop');
		if (!prop) return void goto('/letters/archive');
		haptic.select();
		if (reducedMotion()) return;
		prop.animate(
			[
				{ transform: 'none' },
				{ transform: 'translateY(-7%) scale(1.1) rotate(-5deg)', offset: 0.3 },
				{ transform: 'translateY(0) scale(0.96) rotate(3deg)', offset: 0.6 },
				{ transform: 'scale(1.02) rotate(-1deg)', offset: 0.8 },
				{ transform: 'none' }
			],
			{ duration: 480, easing: 'ease-out' }
		);
	}

	// 편지 쓰기 단추는 보관함 이름표와 한 줄 (Phase 71) — 이름표 높이에 맞춘다 (글이 두 줄로 접혀도 같이)
	let plateH = $state(64);

	const LAYERS = [
		{ r: -7, x: -14, y: 10, kind: 'paper' },
		{ r: 5, x: 16, y: 8, kind: 'env' },
		{ r: -3, x: -6, y: 6, kind: 'paper' },
		{ r: 8, x: 10, y: 4, kind: 'env' },
		{ r: -5, x: -12, y: 3, kind: 'env' },
		{ r: 3, x: 6, y: 1, kind: 'paper' }
	];
</script>

<svelte:window bind:innerHeight={vh} />

<div class="topbar">
	<span class="title display">익명편지</span>
	<TopbarMe />
</div>

<div class="page mailbox" style:--k={k} style:--plate-h="{plateH}px">
	<h2 class="sr-only">새 편지</h2>
	<!-- 벽 — 우체통이 걸려 있다. 새 편지가 여기로 온다 -->
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

	<!-- 책상 — 벽 아래로 이어지는 한 장의 나무 판. 아래쪽엔 편지 보관함(서류 더미) -->
	<div class="surface">
	{#if loadError}
		<div class="load-error" role="status">
			<p>{loadError}</p>
			<button class="btn-text" onclick={reloadMailbox}>다시 시도</button>
		</div>
	{/if}

	<!-- 편지 보관함 — 책상 위 서류 더미. 앞 한 줄은 [이름표 | 편지 쓰기] -->
	<div class="desk-area">
	<button class="desk" bind:clientWidth={deskW} onclick={tapDesk} aria-label="편지 보관함 — 받은 편지 {count(readCount, BOX.more.received)}통, 보낸 편지 {count(sentCount, BOX.more.sent)}통{BOX.folders.length ? `, 폴더 ${BOX.folders.length}개` : ''}">
		<span class="wood" aria-hidden="true">
			<!-- 책상 위 물건들 (Phase 58) — 서류 더미를 피해 가장자리에. 위에서 내려다본 모습, 책상 비율(--k)대로 커지고 작아진다 -->
			<span class="props">
				<!-- 책상 위 물건 (Phase 58 · 76) — 우체통과 같은 결: 납작하고 부드러운 그림 · 우체통과 같은 붉은 계열(주황 → 코랄 → 핑크 — 테마 색을 따르지 않는다) · 크림 -->
				<svg class="prop defs" viewBox="0 0 1 1" aria-hidden="true">
					<defs>
						<linearGradient id="desk-brand" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0" stop-color="#ff7a50" />
							<stop offset=".5" stop-color="#fb5c68" />
							<stop offset="1" stop-color="#f0396e" />
						</linearGradient>
						<linearGradient id="desk-brand-x" x1="0" y1="0" x2="1" y2="0">
							<stop offset="0" stop-color="#ff7a50" />
							<stop offset=".5" stop-color="#fb5c68" />
							<stop offset="1" stop-color="#f0396e" />
						</linearGradient>
						<radialGradient id="desk-knob" cx="38%" cy="32%" r="72%">
							<stop offset="0" stop-color="#fff" />
							<stop offset="1" stop-color="#f3e3de" />
						</radialGradient>
					</defs>
				</svg>
				<!-- 포스트잇 — 살구빛 · 코랄 하트 -->
				<svg class="prop note" viewBox="0 0 64 64">
					<rect x="2" y="2" width="60" height="60" rx="6" fill="#ffe3b8" />
					<path d="M11 17h36M11 27h29" stroke="#f0b27a" stroke-width="2.6" stroke-linecap="round" />
					<path d="M42 48c-3.4-2.5-6.6-5-6.6-8a3.3 3.3 0 0 1 6.6-1.3 3.3 3.3 0 0 1 6.6 1.3c0 3-3.2 5.5-6.6 8z" fill="#fb5c68" />
				</svg>
				<!-- 컵 자국 -->
				<svg class="prop ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="rgb(230 110 90 / .2)" stroke-width="3" stroke-dasharray="120 14 30 8" /></svg>
				<!-- 머그 — 브랜드 그라디언트 잔 · 라테 하트 -->
				<svg class="prop mug" viewBox="0 0 86 72">
					<path d="M64 25a12 12 0 0 1 0 22" fill="none" stroke="url(#desk-brand)" stroke-width="7.5" stroke-linecap="round" />
					<circle cx="36" cy="36" r="32" fill="url(#desk-brand)" />
					<circle cx="36" cy="36" r="27" fill="#fff" />
					<circle cx="36" cy="36" r="23" fill="#c98a5e" />
					<path d="M36 46c-6-3.8-10-6.9-10-10.5a4.8 4.8 0 0 1 10-1.4 4.8 4.8 0 0 1 10 1.4c0 3.6-4 6.7-10 10.5z" fill="#fbe7d3" />
				</svg>
				<!-- 펜 — 브랜드 그라디언트 몸통 · 흰 클립 (펜촉이 왼쪽 아래로) -->
				<svg class="prop pen" viewBox="0 0 170 20">
					<path d="M2 10l22-5h6v10h-6z" fill="#ffe0cc" />
					<circle cx="8" cy="10" r="2" fill="#7a1330" />
					<rect x="28" y="3" width="134" height="14" rx="7" fill="url(#desk-brand-x)" />
					<rect x="104" y="1" width="46" height="4" rx="2" fill="#fff" />
					<rect x="34" y="5" width="120" height="2.4" rx="1.2" fill="#fff" opacity=".35" />
				</svg>
				<!-- 연필 — 살구색 · 분홍 지우개 -->
				<svg class="prop pencil" viewBox="0 0 150 14">
					<path d="M0 7l20-6v12z" fill="#ffe0cc" />
					<path d="M0 7l7-2.1v4.2z" fill="#6b3a44" />
					<rect x="20" y="1" width="106" height="12" fill="#ffb28f" />
					<rect x="20" y="5" width="106" height="4" fill="#ff9f7c" />
					<rect x="126" y="1" width="10" height="12" fill="#f2e6e0" />
					<rect x="136" y="1" width="13" height="12" rx="3" fill="#f78aa6" />
				</svg>
				<!-- 봉인 — 분홍 밀랍 막대 · 하트 도장 -->
				<svg class="prop sealkit" viewBox="0 0 96 52">
					<rect x="2" y="34" width="56" height="11" rx="5.5" fill="url(#desk-brand-x)" transform="rotate(-8 30 40)" />
					<circle cx="72" cy="24" r="21" fill="url(#desk-brand)" />
					<circle cx="72" cy="24" r="15" fill="url(#desk-knob)" />
					<path d="M72 30c-3.4-2.4-6-4.4-6-6.8a3 3 0 0 1 6-.9 3 3 0 0 1 6 .9c0 2.4-2.6 4.4-6 6.8z" fill="#fb5c68" />
				</svg>
				<!-- 종이 클립 -->
				<svg class="prop clip c1" viewBox="0 0 14 40"><path d="M4 30V8a3.5 3.5 0 0 1 7 0v24a5.5 5.5 0 0 1-11 0V10" fill="none" stroke="#f7a6a0" stroke-width="2" stroke-linecap="round" /></svg>
				<svg class="prop clip c2" viewBox="0 0 14 40"><path d="M4 30V8a3.5 3.5 0 0 1 7 0v24a5.5 5.5 0 0 1-11 0V10" fill="none" stroke="#ffc39a" stroke-width="2" stroke-linecap="round" /></svg>
			</span>
			<span class="pile">
				{#each LAYERS.slice(0, Math.max(0, pileSize - 1)) as l, i (i)}
					<i class="layer {l.kind}" style:--r="{l.r}deg" style:--x="{l.x}px" style:--y="{l.y}px"></i>
				{/each}
				{#if top}
					<span class="top-env" class:land={landing}>
						<Envelope
							to={top.box === 'received' ? me(top.it, top.box) : otherLabel(top.it, top.box)}
							from={top.box === 'received' ? otherLabel(top.it, top.box) : me(top.it, top.box)}
							date={stampDate(top.it.created_at)}
							border={borderOf(top.it, top.box)}
							postmark={stampDate(top.it.created_at)}
							w={Math.round(176 * k)}
						/>
					</span>
				{:else if loaded && !pileSize && !loadError}
					<span class="empty-desk">아직 쌓인 편지가 없어요</span>
				{/if}
			</span>
		</span>
		<span class="plate" bind:clientHeight={plateH}>
			<span class="plate-text">
				<strong>편지 보관함</strong>
				<span class="muted num">받은 편지 {count(readCount, BOX.more.received)} · 보낸 편지 {count(sentCount, BOX.more.sent)}{#if BOX.folders.length}&nbsp;· 폴더 {BOX.folders.length}{/if}</span>
			</span>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
		</span>
	</button>
	<a class="fab" href="/letters/new" aria-label="편지 쓰기">
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
			<path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="2" />
		</svg>
		<span>편지 쓰기</span>
	</a>
	</div>
	</div>
</div>


<style>
	.load-error {
		padding: 12px var(--side);
		text-align: center;
		color: var(--wood-ink);
	}
	.load-error p {
		margin: 0;
	}
	/* 한 장면 (Phase 73): 벽(우체통) → 그 아래로 이어지는 나무 책상 한 장(새 편지 · 물건 · 서류 더미) → 책상 앞 모서리에 [이름표 | 편지 쓰기] */
	.mailbox {
		/* 책상이 화면 양옆보다 이만큼 더 넓다 (Phase 71) — 눌러서 살짝 줄어도 모서리에 바깥 바탕이 비치지 않게 */
		--bleed: 14px;
		--side: calc(var(--pad) + var(--bleed));
		gap: 0;
		/* 이름표 줄이 책상 앞 모서리 아래로 내려온 만큼 */
		padding-bottom: calc(18px + var(--plate-h, 64px) - 26px);
		background: var(--desk);
		overflow-x: clip;
	}

	/* ── 벽 · 우체통 (Phase 71 · 72 · 73) — 벽에 걸린 칠한 쇠 우편함. 위 여백은 "+✉" 가 튀어나올 자리 ── */
	.wall {
		display: flex;
		justify-content: center;
		margin: 0 calc(var(--side) * -1);
		padding: calc(30px * var(--k, 1)) var(--side) calc(22px * var(--k, 1));
		background: var(--wall);
	}
	.post {
		display: block;
		width: min(74%, calc(270px * var(--k, 1)));
		-webkit-tap-highlight-color: transparent;
	}
	.post:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 6px;
		border-radius: 12px;
	}

	/* ── 책상 — 벽 바로 아래에서 시작하는 나무 판 한 장. 벽과 닿는 뒤쪽 가장자리엔 그늘, 앞 모서리엔 두께 ── */
	.surface {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		margin: 0 calc(var(--side) * -1);
		background: var(--wood);
		border-top: 2px solid rgb(255 255 255 / 0.35);
		box-shadow: inset 0 14px 16px -12px var(--wood-shade);
	}
	.surface::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 12px;
		background: var(--wood-edge);
		box-shadow: 0 -1px 0 rgb(255 255 255 / 0.3);
		pointer-events: none;
	}
	/* ── 책상 위 서류 더미 · 이름표 줄 ── */
	/* 더미는 책상 아래쪽 — 남는 자리는 새 편지와 더미 사이로 (margin-top: auto). 이름표 줄은 책상 앞 모서리에 걸쳐 아래로 나온다 */
	.desk-area {
		position: relative;
		z-index: 1;
		margin: auto 0 calc(26px - var(--plate-h, 64px));
	}
	.desk {
		display: flex;
		flex-direction: column;
		width: 100%;
		text-align: left;
	}
	/* 누른 것만 반응 (Phase 82 — 전엔 책상이 물건 · 더미 · 이름표째 통째로 줄었다).
	   더미: 더미나 빈 판자를 누르면 / 이름표: 이름표를 누르면 / 물건: 누르면 톡 (tapDesk) */
	.pile,
	.plate {
		transition: scale 0.25s cubic-bezier(0.3, 0.7, 0.3, 1);
	}
	.desk:active:not(:has(.prop:active, .plate:active)) .pile {
		scale: 0.95;
	}
	.plate:active {
		scale: 0.97;
	}
	.wood {
		position: relative;
		display: grid;
		place-items: center;
		height: calc(380px * var(--k, 1)); /* Phase 48 — 판자를 더 길게 (230 → 300), Phase 58 — 물건을 올려 둘 자리까지 (300 → 380) */
		/* 나뭇결은 책상 한 장(.surface)에 — 여기는 물건 · 더미가 놓이는 자리일 뿐 (눌러서 줄어도 판자는 그대로) */
		overflow: hidden;
	}
	/* ── 책상 위 물건들 (Phase 58) — 가운데 서류 더미(190 × 130)와 아래 이름표(아래 26px)를 피해 가장자리에 ── */
	.props {
		position: absolute;
		inset: 0 var(--bleed); /* 화면 밖으로 넓힌 만큼은 빼고 — 물건은 보이는 자리에 */
		pointer-events: none;
	}
	.prop {
		position: absolute;
		height: auto;
		pointer-events: auto; /* 누르면 그 물건만 톡 (tapDesk) */
		-webkit-tap-highlight-color: transparent;
		filter: drop-shadow(0 calc(3px * var(--k, 1)) calc(4px * var(--k, 1)) var(--wood-drop));
	}
	.defs {
		width: 0;
		height: 0;
	}
	.defs,
	.ring {
		pointer-events: none; /* 컵 자국은 물건이 아니다 */
	}
	.note {
		left: calc(16px * var(--k, 1));
		top: calc(20px * var(--k, 1));
		width: calc(62px * var(--k, 1));
		rotate: -9deg;
	}
	.ring {
		right: calc(76px * var(--k, 1));
		top: calc(62px * var(--k, 1));
		width: calc(56px * var(--k, 1));
		filter: none;
	}
	.mug {
		right: calc(16px * var(--k, 1));
		top: calc(16px * var(--k, 1));
		width: calc(84px * var(--k, 1));
	}
	.pen {
		left: calc(10px * var(--k, 1));
		bottom: calc(60px * var(--k, 1));
		width: calc(168px * var(--k, 1));
		rotate: -24deg;
	}
	/* 연필은 책상 오른쪽 끝에 걸쳐 있다 (끝이 책상 밖으로 조금 나가 잘린다) */
	.pencil {
		right: calc(-40px * var(--k, 1));
		top: calc(175px * var(--k, 1));
		width: calc(140px * var(--k, 1));
		rotate: 72deg;
	}
	.sealkit {
		right: calc(18px * var(--k, 1));
		bottom: calc(58px * var(--k, 1));
		width: calc(96px * var(--k, 1));
	}
	.clip {
		width: calc(12px * var(--k, 1));
	}
	.clip.c1 {
		left: calc(34px * var(--k, 1));
		top: calc(150px * var(--k, 1));
		rotate: 24deg;
	}
	.clip.c2 {
		left: calc(50% + 30px * var(--k, 1));
		bottom: calc(66px * var(--k, 1));
		rotate: -68deg;
	}
	/* 낮은 화면(아이폰 SE · 큰 글꼴 안드로이드) — 판자는 예전 길이(300)로 두어 보관함 이름표가 편지 쓰기 단추 위에 보이게 (Phase 47).
	   물건은 서류 더미와 겹치지 않게 줄이고 옮긴다 */
	@media (max-height: 759px) {
		.wood {
			height: calc(300px * var(--k, 1));
		}
		.ring,
		.pencil,
		.clip.c2 {
			display: none;
		}
		.mug {
			top: calc(12px * var(--k, 1));
			right: calc(12px * var(--k, 1));
			width: calc(70px * var(--k, 1));
		}
		.pen {
			left: calc(12px * var(--k, 1));
			bottom: calc(50px * var(--k, 1));
			width: calc(140px * var(--k, 1));
			rotate: -12deg;
		}
		.sealkit {
			right: calc(12px * var(--k, 1));
			bottom: calc(46px * var(--k, 1));
			width: calc(70px * var(--k, 1));
		}
	}
	.pile {
		position: relative;
		display: grid;
		place-items: center;
		width: calc(190px * var(--k, 1));
		height: calc(130px * var(--k, 1));
		margin-top: calc(-8px * var(--k, 1));
		transform: perspective(700px) rotateX(18deg);
	}
	.layer {
		position: absolute;
		width: calc(176px * var(--k, 1));
		height: calc(109px * var(--k, 1));
		border-radius: 4px;
		transform: translate(calc(var(--x) * var(--k, 1)), calc(var(--y) * var(--k, 1))) rotate(var(--r));
		box-shadow: 0 3px 8px var(--wood-drop);
	}
	.layer.paper {
		width: calc(150px * var(--k, 1));
		height: calc(118px * var(--k, 1));
		background:
			repeating-linear-gradient(180deg, transparent 0 calc(11px * var(--k, 1)), rgb(90 70 50 / 0.14) calc(11px * var(--k, 1)) calc(12px * var(--k, 1))) 0 calc(14px * var(--k, 1)) / 100% 100% no-repeat,
			#fffaf0;
	}
	.layer.env {
		background:
			linear-gradient(to bottom right, transparent calc(50% - 0.6px), rgb(80 60 40 / 0.18) 50%, transparent calc(50% + 0.6px)) left top / 50% 60% no-repeat,
			linear-gradient(to bottom left, transparent calc(50% - 0.6px), rgb(80 60 40 / 0.18) 50%, transparent calc(50% + 0.6px)) right top / 50% 60% no-repeat,
			var(--env-paper);
	}
	.top-env {
		position: relative;
		transform: rotate(-2deg);
		filter: drop-shadow(0 4px 8px var(--wood-drop));
	}
	/* 방금 보낸 편지가 더미 위로 내려앉는다 (Phase 72) */
	.top-env.land {
		animation: land 0.7s 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
	}
	@keyframes land {
		from {
			opacity: 0;
			transform: translateY(calc(-70px * var(--k, 1))) rotate(-10deg) scale(1.12);
		}
	}
	.empty-desk {
		color: var(--wood-ink);
		font-size: 13px;
		font-weight: 600;
	}
	/* 이름표 — 오른쪽은 편지 쓰기 단추 자리(--fab-w)만큼 비운다 */
	.desk-area {
		--fab-w: 128px;
		--side: calc(var(--pad) + var(--bleed));
	}
	.plate {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: -26px calc(var(--side) + var(--fab-w) + 10px) 0 var(--side);
		padding: 14px 16px;
		border-radius: var(--r-card);
		background: var(--surface);
		box-shadow: var(--shadow-2);
		position: relative;
	}
	.plate-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.plate strong {
		font-size: 16px;
		font-weight: 650;
	}
	.plate .muted {
		font-size: 13px;
	}
	.plate svg {
		width: 20px;
		height: 20px;
		color: var(--text-2);
	}

	/* 편지 쓰기 — 이름표와 한 줄 · 같은 높이 (Phase 71). 테마 색 (설정 > 테마 색상과 같이 바뀐다) */
	.fab {
		position: absolute;
		right: var(--side);
		bottom: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: var(--fab-w);
		height: var(--plate-h, 64px);
		border-radius: var(--r-card);
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		font-size: 15px;
		font-weight: 650;
		text-decoration: none;
		box-shadow: var(--glow);
		transition: transform 0.2s cubic-bezier(0.3, 0.7, 0.3, 1.4);
	}
	.fab:active {
		transform: scale(0.95);
	}
	.fab span {
		white-space: nowrap;
	}
	.fab svg {
		flex: none;
		width: 22px;
		height: 22px;
	}
	/* 좁은 화면(큰 글꼴 안드로이드 ≈ 280) — 연필만 있는 네모 단추, 이름표에 자리를 더 준다 */
	@media (max-width: 359px) {
		.desk-area {
			--fab-w: 60px;
		}
		.fab span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
</style>

<script lang="ts">
	/**
	 * 업적 화면 본문 (Phase 31) — /me/achievements 와 개발용 미리보기(/dev/achievements)가 같이 쓴다.
	 * 위: 금 · 은 · 동 개수와 대표 업적(대화 상대에게 보이는 3개). 아래: 분류 탭 + 메달 격자.
	 * 메달을 누르면 어떻게 얻는지 · 등급 기준(BadgeDetail — 대화 상대 · 프로필의 메달을 눌렀을 때와 같은 모양)과 "대표 업적으로 걸기".
	 * Phase 69 — 대표 업적은 교복(프로필과 같은 그림)으로. 클래시로얄 덱처럼 딴 메달을 꾹 눌러 교복 깃의 칸으로 끌어 놓으면
	 *   그 칸의 대표 업적이 되고(있던 배지는 밀려난다), 교복의 배지도 꾹 눌러 다른 칸과 자리를 바꾼다 (lib/ui/badgeDrag).
	 *   집는 순간 교복이 화면 밖이면 보이게 스크롤한다. 잠긴 메달은 집히지 않는다.
	 * Phase 84 — 대표 칸은 3개, Landy 금 뱃지 5개면 5개 (교복 가슴 주머니 위에 둘 더) · 금 뱃지 진행도.
	 *   CNSA 탭 위에는 "CNSA 뱃지 안내" · "뱃지 제출하기" (onguide · submitHref).
	 */
	import Badge from './Badge.svelte';
	import BadgeDetail from './BadgeDetail.svelte';
	import Sheet from './Sheet.svelte';
	import Uniform from './Uniform.svelte';
	import { badgeDrag } from './badgeDrag';
	import {
		CATEGORIES,
		GOLDS_FOR_FIVE,
		placedFeatured,
		slotsOf,
		progress,
		progressText,
		toggledFeatured,
		type Achievement,
		type Category,
		type MyAchievements
	} from '$lib/achievements';

	let {
		data,
		onfeature,
		neck = 'tie',
		onguide,
		submitHref
	}: {
		data: MyAchievements;
		/** 대표 업적 바꾸기 — quiet 면 알림 없이 (끌어 놓기는 교복이 바로 바뀌는 게 알림이다) */
		onfeature: (codes: string[], quiet?: boolean) => Promise<boolean>;
		neck?: 'tie' | 'ribbon';
		/** CNSA 뱃지 안내 열기 (Phase 84) */
		onguide?: () => void;
		/** 뱃지 제출 화면 주소 (Phase 84) */
		submitHref?: string;
	} = $props();
	const slots = $derived(slotsOf(data));
	const golds = $derived(data.golds ?? 0);
	let dress: HTMLDivElement | undefined = $state();

	let cat = $state<Category | 'all'>('all');
	let open = $state<Achievement | null>(null);
	let busy = $state(false);

	const earned = $derived(data.items.filter((a) => a.tier > 0));
	// 특별 업적(운영진이 주는 것)은 금 · 은 · 동에 세지 않는다
	const count = (t: 1 | 2 | 3) => data.items.filter((a) => a.tier === t && !a.granted).length;
	const shown = $derived(cat === 'all' ? data.items : data.items.filter((a) => a.category === cat));
	const featuredCodes = $derived(data.featured.map((b) => b.code));

	async function toggleFeature(a: Achievement) {
		if (busy) return;
		busy = true;
		const ok = await onfeature(toggledFeatured(data, a.code));
		busy = false;
		if (ok) open = null;
	}
	/** 메달을 교복 칸에 놓았다 (목록에서 끌어 왔든, 교복 안에서 옮겼든) */
	function place(code: string, slot: number) {
		const codes = placedFeatured(data, code, slot);
		if (codes.join() !== featuredCodes.join()) void onfeature(codes, true);
	}
</script>

<section class="summary" aria-label="업적 요약">
	<div class="big">
		<strong class="num">{earned.length}</strong><span class="num">/ {data.items.length}</span>
		<small>모은 업적</small>
	</div>
	<ul class="metals">
		<li><span class="dot g"></span>금 <b class="num">{count(3)}</b></li>
		<li><span class="dot s"></span>은 <b class="num">{count(2)}</b></li>
		<li><span class="dot b"></span>동 <b class="num">{count(1)}</b></li>
	</ul>
</section>

<section class="featured" aria-labelledby="feat-h">
	<div class="feat-head">
		<h2 id="feat-h">대표 업적 <small class="num">{data.featured.length}/{slots}</small></h2>
		{#if earned.length}<span class="hint">메달을 꾹 눌러 교복에 달아요</span>{/if}
	</div>
	<!-- 교복 — 깃의 칸에 메달을 끌어 놓는다 -->
	<div class="dress" bind:this={dress}>
		<Uniform {neck} badges={data.featured} {slots} onpick={(b) => (open = data.items.find((a) => a.code === b.code) ?? null)} onplace={place} />
	</div>
	<!-- 금 뱃지 5개면 칸이 5개 (Phase 84) -->
	<p class="five" class:done={slots >= 5}>
		{#if slots >= 5}
			<b>금 뱃지 {golds}개</b> · 대표 칸이 5개로 늘었어요
		{:else}
			<span class="five-bar" aria-hidden="true"><i style:width="{(Math.min(golds, GOLDS_FOR_FIVE) / GOLDS_FOR_FIVE) * 100}%"></i></span>
			<span>Landy 금 뱃지 <b class="num">{golds}/{GOLDS_FOR_FIVE}</b> · 다 모으면 대표 칸이 5개</span>
		{/if}
	</p>
</section>

<nav class="cats" aria-label="분류">
	{#each CATEGORIES as c (c.k)}
		<button class:on={cat === c.k} aria-pressed={cat === c.k} onclick={() => (cat = c.k)}>{c.label}</button>
	{/each}
</nav>

{#if cat === 'cnsa' && (onguide || submitHref)}
	<!-- CNSA 뱃지 (Phase 84) — 무엇인지 · 얻는 법 안내, 운영진에게 뱃지 사진 보내기 -->
	<div class="cnsa-acts">
		{#if onguide}<button class="cnsa-btn u-tap" onclick={onguide}>CNSA 뱃지 안내</button>{/if}
		{#if submitHref}<a class="cnsa-btn primary u-tap" href={submitHref}>뱃지 제출하기</a>{/if}
	</div>
{/if}

<ul class="grid">
	{#each shown as a (a.code)}
		<li>
			<button
				class="card"
				class:locked={a.tier === 0}
				onclick={() => (open = a)}
				use:badgeDrag={{ enabled: a.tier > 0, scope: () => dress?.querySelector<HTMLElement>('.uniform'), grab: (n) => n.querySelector('.medal'), reveal: true, ondrop: (slot) => place(a.code, slot) }}
			>
				{#if a.new}<span class="new" aria-label="새 업적">NEW</span>{/if}
				<Badge code={a.code} icon={a.icon} tier={a.tier} title={a.title} size={52} label shine={a.new} />
				<span class="name">{a.title}</span>
				<span class="desc">{a.description}</span>
				<span class="bar" aria-hidden="true"><i style:width="{progress(a) * 100}%"></i></span>
				<span class="prog num">{progressText(a)}</span>
			</button>
		</li>
	{/each}
</ul>

{#if open}
	{@const a = open}
	<Sheet onclose={() => (open = null)} label={a.title}>
		<BadgeDetail badge={a} def={a} sub={a.granted ? '' : progressText(a)}>
			{#if a.tier > 0}
				<button aria-busy={busy} class="btn feat" onclick={() => toggleFeature(a)} disabled={busy}>
					{featuredCodes.includes(a.code) ? '대표 업적에서 내리기' : '대표 업적으로 걸기'}
				</button>
			{:else}
				<p class="muted small locked-note">아직 잠겨 있어요</p>
			{/if}
		</BadgeDetail>
	</Sheet>
{/if}

<style>
	.summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px;
		border-radius: var(--r-card);
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.big {
		display: flex;
		align-items: baseline;
		gap: 4px;
		flex-wrap: wrap;
	}
	.big strong {
		font-size: 34px;
		font-weight: 650;
		letter-spacing: -0.03em;
	}
	.big span {
		font-size: 16px;
		font-weight: 600;
		opacity: 0.85;
	}
	.big small {
		flex-basis: 100%;
		font-size: 12px;
		opacity: 0.85;
	}
	.metals {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 13px;
		font-weight: 600;
	}
	.metals li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.metals b {
		min-width: 18px;
		text-align: right;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: 0 0 0 1.5px rgb(255 255 255 / 0.7);
	}
	.dot.g {
		background: #f2c14e;
	}
	.dot.s {
		background: #cfd6de;
	}
	.dot.b {
		background: #c98a55;
	}

	.featured {
		padding: 16px;
		border-radius: var(--r-card);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.feat-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		/* 좁은 화면(폭 280)에서는 안내가 아랫줄로 — 제목이 두 줄로 꺾이지 않게 */
		flex-wrap: wrap;
		gap: 2px 10px;
		margin-bottom: 12px;
	}
	.feat-head h2 {
		margin: 0;
		font-size: 15px;
		white-space: nowrap;
	}
	.feat-head h2 small {
		margin-left: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	/* 금 뱃지 진행도 — 5개면 대표 칸 5개 */
	.five {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 0 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.five b {
		color: var(--text);
	}
	.five.done {
		color: #9b6c05;
	}
	.five-bar {
		flex: none;
		width: 64px;
		height: 6px;
		border-radius: 999px;
		background: var(--field);
		overflow: hidden;
	}
	.five-bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #f5c95a, #c48a0c);
	}
	.cnsa-acts {
		display: flex;
		gap: 8px;
	}
	.cnsa-btn {
		flex: 1;
		display: grid;
		place-items: center;
		min-height: 44px;
		border-radius: 14px;
		background: var(--field);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
	}
	.cnsa-btn.primary {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.hint {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}

	/* 위아래 여백은 칸(36)의 누름 영역 44 가 잘리지 않게 */
	.cats {
		display: flex;
		gap: 8px;
		padding: 4px 0;
		margin: -4px 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.cats button::after {
		content: '';
		position: absolute;
		inset: -4px min(-4px, calc(50% - 22px));
	}
	.cats button:active {
		transform: scale(0.95);
	}
	.cats button {
		position: relative;
		flex: none;
		min-height: 36px;
		padding: 0 16px;
		transition: transform 0.15s;
		border-radius: 999px;
		background: var(--field);
		font-size: 13px;
		font-weight: 600;
	}
	.cats button.on {
		background: var(--text);
		color: var(--bg);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px 12px 14px;
		border-radius: 20px;
		background: var(--surface);
		border: 1px solid var(--line);
		text-align: center;
		transition: transform 0.15s ease-out;
	}
	.card:active {
		transform: scale(0.97);
	}
	.name {
		margin-top: 4px;
		font-size: 14px;
		font-weight: 600;
	}
	.locked .name {
		color: var(--text-2);
	}
	.desc {
		font-size: 11px;
		color: var(--text-2);
		line-height: 1.35;
	}
	.bar {
		width: 100%;
		height: 5px;
		margin-top: 4px;
		border-radius: 999px;
		background: var(--field);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent-fill-deep);
	}
	.prog {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
	}
	.new {
		position: absolute;
		top: 10px;
		right: 10px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		font-size: 9px;
		font-weight: 650;
		letter-spacing: 0.04em;
	}

	/* 자세히(BadgeDetail) 아래 — 대표 업적 걸기 */
	.feat {
		width: 100%;
		max-width: 320px;
	}
	.locked-note {
		margin: 0;
	}
</style>

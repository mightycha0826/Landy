<script lang="ts">
	/**
	 * 업적 메달 자세히 (Phase 44 에서 하나로) — 업적 화면에서 메달을 눌렀을 때 · 대화 상대 · 프로필의 메달을 눌렀을 때 같은 모양.
	 * 큰 메달 · 이름 · 어떻게 얻는지(설명) · 등급 기준(동 · 은 · 금, 가진 등급까지 ✓). 운영진이 주는 특별 업적은 기준 대신 한 줄.
	 * def 가 아직 없으면(카탈로그를 받는 중) 이름 · 메달만 먼저 그리고 설명 자리를 잡아 둔다.
	 * 아래 버튼(대표 업적 걸기 등)은 children 으로.
	 */
	import type { Snippet } from 'svelte';
	import Badge from './Badge.svelte';
	import { TIER_NAME, tierLine, type AchievementDef, type BadgeLite } from '$lib/achievements';

	let {
		badge,
		def,
		sub = '',
		loading = false,
		children
	}: {
		badge: BadgeLite;
		def: AchievementDef | null;
		/** 설명 옆에 붙는 한 줄 — 내 업적이면 진행도 ("7 / 20번") */
		sub?: string;
		loading?: boolean;
		children?: Snippet;
	} = $props();
</script>

<div class="detail">
	<Badge code={badge.code} icon={badge.icon} tier={badge.tier} title={badge.title} size={88} label shine />
	<h3>{badge.title}</h3>
	{#if def}
		<p class="how">{def.description}{#if sub}<span class="muted"> · {sub}</span>{/if}</p>
		{#if def.granted}
			<p class="special" class:done={badge.tier > 0}>
				<span class="spark" aria-hidden="true">✦</span>{def.category !== 'cnsa' ? '운영진이 주는 특별 업적' : def.code.startsWith('club_') ? '동아리 부원에게 주는 CNSA 뱃지' : '운영진이 주는 CNSA 뱃지'}
				{#if badge.tier > 0}<span class="check" aria-label="받음">✓</span>{/if}
			</p>
		{:else}
			<ol class="tiers">
				{#each [1, 2, 3] as const as t (t)}
					<li class:done={badge.tier >= t}>
						<span class="dot {t === 3 ? 'g' : t === 2 ? 's' : 'b'}"></span>
						<b>{TIER_NAME[t]}</b>
						<span class="num">{tierLine(def, t)}</span>
						{#if badge.tier >= t}<span class="check" aria-label="달성">✓</span>{/if}
					</li>
				{/each}
			</ol>
		{/if}
	{:else if loading}
		<p class="sr-only">불러오는 중…</p>
		<i class="skeleton line" aria-hidden="true"></i>
		<div class="tiers" aria-hidden="true">{#each [0, 1, 2] as i (i)}<i class="skeleton row"></i>{/each}</div>
	{:else}
		<p class="how muted">설명을 불러오지 못했어요</p>
	{/if}
	{@render children?.()}
</div>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 18px var(--pad) 10px;
		text-align: center;
	}
	h3 {
		margin: 6px 0 0;
		font-size: 20px;
	}
	.how {
		margin: 0;
		font-size: 14px;
		color: var(--text-2);
	}
	.tiers {
		width: 100%;
		max-width: 320px;
		margin: 8px 0 10px;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tiers li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		border-radius: 14px;
		background: var(--field);
		font-size: 14px;
		opacity: 0.6;
	}
	.tiers li.done {
		opacity: 1;
	}
	.tiers .num {
		margin-left: auto;
		color: var(--text-2);
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
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
	.check {
		color: var(--accent);
		font-weight: 650;
	}
	.special {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		max-width: 320px;
		margin: 8px 0 10px;
		padding: 12px 14px;
		border-radius: 14px;
		background: linear-gradient(100deg, color-mix(in srgb, #7b5cff 14%, var(--field)), color-mix(in srgb, #ff7ab8 12%, var(--field)));
		font-size: 14px;
		font-weight: 600;
	}
	.special .check {
		margin-left: auto;
	}
	.spark {
		color: #7b5cff;
	}
	.line {
		width: 70%;
		height: 14px;
	}
	.row {
		height: 42px;
		border-radius: 14px;
	}
</style>

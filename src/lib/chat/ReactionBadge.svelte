<script lang="ts">
	/** 말풍선 아래 모서리의 공감 표시 — 내 말풍선은 오른쪽, 상대는 왼쪽. 누르면 공감 고르기. */
	import type { ReactionSummary } from './reactions';
	import { surface } from '$lib/transitions';

	let { summary, mine, onclick }: { summary: ReactionSummary; mine: boolean; onclick: (e: MouseEvent) => void } =
		$props();
</script>

<button
	class="reacts"
	class:mine
	{onclick}
	in:surface={{ y: -3, scale: 0.7 }}
	out:surface={{ y: -3, scale: 0.9 }}
	aria-label="공감 {summary.emojis.join(' ')}{summary.count ? ' 2개' : ''}"
>
	<span class="pill">
		{#each summary.emojis as e, i (i)}<span>{e}</span>{/each}
		{#if summary.count}<span class="n">{summary.count}</span>{/if}
	</span>
</button>

<style>
	/* 보이는 알약은 22 지만 누름은 44 × 44 (G1) — 알약 윗변에서 아래로 넓힌다. 말풍선과 겹치는 건 알약이 걸친 7px 줄뿐이라
	   말풍선의 길게 누르기 · 두 번 톡 · 밀기 · 오른쪽 클릭 · 글자 고르기를 가로채지 않는다 (G1.3).
	   (예전엔 가운데에서 위아래로 넓혀 말풍선 아래쪽 절반을 덮었고, 그걸 말풍선 밑에 깔자 위 절반이 가려 44 가 안 됐다)
	   아래로 넓힌 자리는 ChatView .bwrap.reacted 가 비워 둔다 */
	.reacts {
		position: absolute;
		top: calc(100% - 7px);
		left: 2px;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		min-width: 44px;
		height: 44px;
	}
	.reacts.mine {
		left: auto;
		right: 2px;
	}
	.pill {
		display: flex;
		align-items: center;
		gap: 1px;
		height: 22px;
		padding: 0 6px;
		border-radius: 999px;
		border: 2px solid var(--bg);
		background: var(--field);
		font-size: 12px;
		line-height: 1;
		transition: transform var(--dur-3) var(--ease-settle);
	}
	.reacts:active .pill {
		transform: scale(0.9);
		transition-duration: var(--dur-press);
	}
	.n {
		margin-left: 2px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>

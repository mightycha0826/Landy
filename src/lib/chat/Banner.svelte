<script lang="ts">
	/**
	 * 대화방 위쪽 알림 띠 (인스타 "메시지 요청" 배너 모양) — 제목 · 한 줄 설명 · 오른쪽 버튼.
	 * 연장 · 고정 투표(VoteBanner)와 "상대가 자리를 비운 것 같아요"가 같이 쓴다.
	 * 버튼은 actions 에 .no(글자) · .yes(채운 알약) 로 넣는다. children 은 아래 한 줄 전체(적는 칸 등).
	 */
	import type { Snippet } from 'svelte';
	import { expand } from '$lib/transitions';

	let {
		title,
		sub = '',
		want = false,
		children,
		actions
	}: { title: string; sub?: string; want?: boolean; children?: Snippet; actions?: Snippet } = $props();
</script>

<div class="extend" in:expand out:expand>
	<div class="q">
		<strong>{title}</strong>
		{#if sub}<span class:want>{sub}</span>{/if}
	</div>
	{@render children?.()}
	{#if actions}<div class="acts">{@render actions()}</div>{/if}
</div>

<style>
	.extend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		padding: 10px var(--pad);
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	/* 글 칸은 11em 아래로 줄지 않는다 — 좁은 폰(글꼴을 키운 안드로이드 ≈ 280)에서는 글을 낱말 중간에서 자르는 대신
	   버튼 줄이 아래로 내려간다 ("이 채팅을 고정하시겠습/니까?" 였던 것, Phase 46) */
	.q {
		flex: 1 1 11em;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.q strong {
		font-size: 15px;
		font-weight: 700;
	}
	.q span {
		font-size: 12px;
		color: var(--text-2);
	}
	.q .want {
		color: var(--accent);
		font-weight: 700;
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		margin-left: auto; /* 아래 줄로 내려가도 오른쪽에 */
	}
	.acts :global(.no) {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-2);
	}
	.acts :global(.yes) {
		height: 36px;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		font-size: 14px;
		font-weight: 700;
	}
	.acts :global(button:disabled) {
		opacity: 0.5;
	}
</style>

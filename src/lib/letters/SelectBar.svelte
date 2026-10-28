<script lang="ts">
	/**
	 * 편지 선택 중의 아래 막대 (Phase 47 · 69) — 보관함 · 폴더 화면. "n통 선택했어요" + 할 일 단추들(children).
	 * 화면 아래(아이폰 홈 막대 위)에 붙는다. 아무것도 선택하지 않았으면 안내만. 좁은 폰에서는 단추를 조금 줄여 한 줄에.
	 */
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { reducedMotion } from '$lib/motion';

	let { count, children }: { count: number; children: Snippet } = $props();
</script>

<div class="bar" role="region" aria-label="선택한 편지" transition:fly={{ y: 80, duration: reducedMotion() ? 0 : 220 }}>
	<p class="count" aria-live="polite">{count ? `${count}통 선택했어요` : '편지를 선택해 주세요'}</p>
	<div class="acts">{@render children()}</div>
</div>

<style>
	.bar {
		position: fixed;
		left: 50%;
		bottom: 0;
		z-index: 20;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		width: min(100%, 520px);
		padding: 12px var(--pad) calc(12px + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		background: var(--glass);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		backdrop-filter: saturate(180%) blur(20px);
		border-top: 1px solid var(--glass-line);
	}
	.count {
		flex: 1 1 auto;
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.acts {
		display: flex;
		flex: 0 1 auto;
		gap: 8px;
		margin-left: auto;
	}
	.acts :global(button) {
		height: 46px;
		padding: 0 18px;
		border-radius: 999px;
		font-size: 15px;
		font-weight: 650;
		white-space: nowrap;
	}
	.acts :global(.go) {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.acts :global(.go:disabled) {
		background: var(--field);
		color: var(--text-2);
	}
	.acts :global(.plain) {
		background: var(--field);
	}
	/* 삭제 (Phase 69) — 되돌릴 수 없는 일이라 빨간 글씨 (누르면 확인 시트) · 옆 단추와 12 띄운다 (G1.4) */
	.acts :global(.danger) {
		margin-right: 4px;
		background: var(--field);
		color: var(--danger);
	}
	.acts :global(.danger:disabled) {
		color: var(--text-2);
	}
	.acts :global(button:active:not(:disabled)) {
		transform: scale(0.96);
	}
	/* 좁은 폰 — 단추 셋(폴더 화면: 삭제 · 폴더에서 빼기 · 다른 폴더로)이 한 줄에 들어가게 */
	@media (max-width: 380px) {
		.acts {
			gap: 6px;
		}
		.acts :global(button) {
			padding: 0 12px;
			font-size: 14px;
		}
		.acts :global(.danger) {
			margin-right: 6px;
		}
	}
</style>

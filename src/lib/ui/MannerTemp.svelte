<script lang="ts">
	/**
	 * 매너 온도 표시 (Phase 30).
	 *   full — 이름표 · 큰 숫자 · 온도계 막대 · 한마디 (내 프로필 · 상대 프로필)
	 *   chip — 알약 하나 "🙂 40.0°C" (대화 맨 위 소개)
	 */
	import { BASE_TEMP, fmtTemp, tempFill, tempLook } from '$lib/manner';

	let { temp = BASE_TEMP, size = 'full' }: { temp?: number | null; size?: 'full' | 'chip' } = $props();

	const t = $derived(temp ?? BASE_TEMP);
	const look = $derived(tempLook(t));
</script>

{#if size === 'chip'}
	<span class="chip num" style:--c={look.color} style:--cd={look.dark} aria-label="매너 온도 {fmtTemp(t)}">
		<span aria-hidden="true">{look.face}</span>{fmtTemp(t)}
	</span>
{:else}
	<div class="temp" style:--c={look.color} style:--cd={look.dark} role="group" aria-label="매너 온도 {fmtTemp(t)}, {look.label}">
		<div class="row">
			<span class="label">매너 온도</span>
			<span class="val num"><span class="face" aria-hidden="true">{look.face}</span>{fmtTemp(t)}</span>
		</div>
		<div class="bar" aria-hidden="true"><i style:width="{tempFill(t)}%"></i></div>
		<span class="say">{look.label}</span>
	</div>
{/if}

<style>
	/* 밝은 바탕은 --c, 어두운 바탕은 --cd (설정의 화면 모드 · 기기 설정 둘 다) */
	.chip,
	.temp {
		--col: var(--c);
	}
	:global(:root[data-theme='dark']) :is(.chip, .temp) {
		--col: var(--cd);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) :is(.chip, .temp) {
			--col: var(--cd);
		}
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--col) 14%, transparent);
		color: var(--col);
		font-size: 13px;
		font-weight: 600;
	}
	.temp {
		width: 100%;
		max-width: 280px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.label {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	.val {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--col);
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.face {
		font-size: 16px;
	}
	.bar {
		height: 6px;
		border-radius: 999px;
		background: var(--field);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--col);
		transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.say {
		align-self: flex-end;
		font-size: 12px;
		color: var(--text-2);
	}
</style>

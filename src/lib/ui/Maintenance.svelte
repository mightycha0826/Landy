<script lang="ts">
	/**
	 * 서버 점검 화면 (Phase 52) — 운영자 화면에서 점검을 켜면 앱 전체가 이 화면.
	 * 안내 문구 · 끝나는 시각(있으면 남은 시간). 끝나면 다음 박동(1분)이나 "다시 확인"으로 저절로 풀린다.
	 * "다시 확인"은 10초에 한 번만 (요청을 늘리지 않게).
	 */
	import { S, recheckMaint } from '$lib/state.svelte';

	let { msg, until }: { msg: string; until: string | null } = $props();

	const end = $derived(until ? new Date(until) : null);
	const left = $derived(end ? Math.max(0, Math.round((end.getTime() - S.now) / 60000)) : null);
	const endText = $derived(
		end ? end.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) + (end.toDateString() === new Date(S.now).toDateString() ? '' : ` (${end.getMonth() + 1}/${end.getDate()})`) : ''
	);
	let wait = $state(0);
	let checking = $state(false);
	async function check() {
		if (checking || S.now < wait) return;
		checking = true;
		wait = Date.now() + 10_000;
		await recheckMaint();
		checking = false;
	}
</script>

<div class="maint" role="alert">
	<div class="ic" aria-hidden="true">
		<svg viewBox="0 0 48 48">
			<g class="gear">
				<path d="M24 15a9 9 0 110 18 9 9 0 010-18z" fill="none" stroke="currentColor" stroke-width="3.2" />
				<path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" />
			</g>
		</svg>
	</div>
	<h1>서버 점검 중이에요</h1>
	<p class="msg">{msg || '더 좋은 랜디를 위해 잠시 손보고 있어요. 조금만 기다려 주세요!'}</p>
	{#if end}
		<p class="until">
			<b class="num">{endText}</b>쯤 끝나요{#if left !== null && left > 0}<span class="num">&nbsp;· {left >= 60 ? `${Math.floor(left / 60)}시간 ${left % 60}분` : `${left}분`} 남음</span>{/if}
		</p>
	{/if}
	<button class="btn-ghost again" onclick={check} disabled={checking || S.now < wait} aria-busy={checking}>
		{checking ? '확인하는 중…' : S.now < wait ? '잠시 뒤에 다시 확인할 수 있어요' : '다시 확인'}
	</button>
	<p class="note muted">점검이 끝나면 저절로 앱이 열려요. 대화 · 편지는 그대로 남아 있어요.</p>
</div>

<style>
	.maint {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 100dvh;
		padding: calc(24px + var(--safe-top)) var(--pad) 40px;
		text-align: center;
		background: var(--ambient, var(--bg));
	}
	.ic {
		display: grid;
		place-items: center;
		width: 96px;
		height: 96px;
		margin-bottom: 8px;
		border-radius: 30px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		box-shadow: var(--glow);
	}
	.ic svg {
		width: 54px;
		height: 54px;
	}
	.gear {
		transform-origin: 24px 24px;
		animation: spin 6s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.gear {
			animation: none;
		}
	}
	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 26px;
		font-weight: 650;
	}
	.msg {
		max-width: 22em;
		margin: 0;
		font-size: 15px;
		line-height: 1.6;
		white-space: pre-line;
	}
	.until {
		margin: 4px 0 0;
		padding: 8px 14px;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: var(--shadow-1);
		font-size: 14px;
	}
	.until span {
		color: var(--text-2);
	}
	.again {
		width: auto;
		margin-top: 14px;
		padding: 0 22px;
	}
	.note {
		margin: 6px 0 0;
		font-size: 12px;
	}
</style>

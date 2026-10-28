<script lang="ts">
	/**
	 * 인터넷이 끊기면 위쪽에 얇은 띠 (Phase 54) — 예전엔 아무 표시가 없어서 보낸 말이 안 가도 앱이 멈춘 것처럼만 보였다.
	 * 다시 이어지면 띠를 걷고 "다시 연결됐어요" + 박동 한 번(점검 여부 · 접속 상태를 바로 맞춘다). 요청은 다시 이어질 때 한 번뿐.
	 * (브라우저의 online/offline 신호 — 와이파이는 잡혔는데 인터넷이 안 되는 경우까지는 못 잡는다)
	 */
	import { recheckMaint, toast } from '$lib/state.svelte';

	let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	$effect(() => {
		const up = () => {
			if (online) return;
			online = true;
			toast('다시 연결됐어요');
			void recheckMaint();
		};
		const down = () => (online = false);
		addEventListener('online', up);
		addEventListener('offline', down);
		return () => {
			removeEventListener('online', up);
			removeEventListener('offline', down);
		};
	});
</script>

{#if !online}
	<div class="offline" role="status">
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0120 0M5.5 12a10 10 0 0113 0M9 15.5a5 5 0 016 0M12 19h.01M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
		인터넷 연결이 끊겼어요 · 다시 이어지면 저절로 계속돼요
	</div>
{/if}

<style>
	.offline {
		position: fixed;
		top: calc(var(--safe-top) + 8px);
		left: 50%;
		z-index: 1001;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: calc(100% - 32px);
		padding: 8px 14px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text) 90%, transparent);
		color: var(--bg);
		font-size: 13px;
		font-weight: 600;
		transform: translateX(-50%);
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.2);
		animation: drop 0.25s ease-out;
	}
	.offline svg {
		flex: none;
		width: 16px;
		height: 16px;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translate(-50%, -8px);
		}
	}
</style>

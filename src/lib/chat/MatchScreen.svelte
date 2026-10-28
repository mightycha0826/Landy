<script lang="ts">
	/**
	 * 연결 순간 — 새로 매칭된 방에 처음 들어올 때 1.8초 동안 (틴더의 "It's a Match" 처럼).
	 * 내 얼굴과 상대 얼굴이 양쪽에서 날아와 맞닿고, 가운데 하트 · 브랜드 글씨(파셜산스) "연결됐어요!".
	 * 바로 대화방으로 튀어 들어가면 시작이 흐릿해서, 짧게 숨 고를 틈을 준다. 누르면 바로 닫힌다.
	 */
	import Avatar from '$lib/ui/Avatar.svelte';
	import { S } from '$lib/state.svelte';

	let { alias, minutes, ondone }: { alias: string; minutes: number; ondone: () => void } = $props();

	$effect(() => {
		const t = setTimeout(ondone, 1800);
		return () => clearTimeout(t);
	});
</script>

<!-- 어디를 눌러도 닫힌다 (1.8초 뒤 저절로도) -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="match" role="status" aria-live="polite" onclick={ondone}>
	<div class="glow" aria-hidden="true"></div>
	<p class="headline">연결됐어요!</p>
	<div class="pair" aria-hidden="true">
		<span class="face me"><Avatar name={S.profile?.nickname ?? '나'} size={104} /></span>
		<span class="heart">
			<svg viewBox="0 0 24 24"><path d="M12 20.5s-8-4.9-8-11.1A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8 2.8c0 6.2-8 11.1-8 11.1z" fill="url(#mh)" /><defs><linearGradient id="mh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: var(--primary)" /><stop offset="1" style="stop-color: var(--point)" /></linearGradient></defs></svg>
		</span>
		<span class="face you"><Avatar name={alias} size={104} /></span>
	</div>
	<p class="title"><b>{alias}</b>님과 {minutes}분 동안 이야기해요</p>
</div>

<style>
	.match {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		overflow: hidden;
		background: rgb(16 8 10 / 0.86);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		color: #fff;
		animation:
			in 0.2s ease-out,
			out 0.3s ease-in 1.5s forwards;
	}
	.glow {
		position: absolute;
		width: 520px;
		height: 520px;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--g-pink) 55%, transparent), color-mix(in srgb, var(--g-orange) 25%, transparent) 45%, transparent 70%);
		filter: blur(30px);
		animation: pulse 1.8s ease-in-out;
	}
	.headline {
		position: relative;
		margin: 0;
		padding-bottom: 0.08em;
		font-family: var(--display);
		/* 파셜산스는 넓은 글씨라 좁은 폰에선 폭에 맞춰 줄인다 (Phase 56) */
		font-size: min(46px, 13vw);
		white-space: nowrap;
		line-height: 1;
		background: linear-gradient(90deg, #ffb347, var(--g-orange), var(--g-pink));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		transform: rotate(-4deg);
		animation: pop 0.55s cubic-bezier(0.2, 1.5, 0.4, 1) 0.1s both;
	}
	.pair {
		position: relative;
		display: flex;
		align-items: center;
	}
	.face {
		padding: 4px;
		border-radius: 50%;
		background: var(--brand);
		box-shadow: 0 14px 40px -10px color-mix(in srgb, var(--g-pink) 70%, transparent);
	}
	.face :global(.av) {
		border: 4px solid #1a0f12;
	}
	.me {
		transform: rotate(-8deg);
		animation: from-left 0.5s cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	.you {
		margin-left: -18px;
		transform: rotate(8deg);
		animation: from-right 0.5s cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	.heart {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		margin: -24px 0 0 -24px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
		animation: pop 0.45s cubic-bezier(0.2, 1.8, 0.4, 1) 0.4s both;
	}
	.heart svg {
		width: 28px;
		height: 28px;
	}
	.title {
		position: relative;
		margin: 6px 0 0;
		font-size: 16px;
		opacity: 0.92;
		animation: in 0.4s ease-out 0.45s both;
	}
	@keyframes in {
		from {
			opacity: 0;
		}
	}
	@keyframes out {
		to {
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			transform: scale(0.3) rotate(-10deg);
			opacity: 0;
		}
	}
	@keyframes pulse {
		from {
			transform: scale(0.4);
			opacity: 0;
		}
	}
	@keyframes from-left {
		from {
			transform: translateX(-60vw) rotate(-30deg);
		}
	}
	@keyframes from-right {
		from {
			transform: translateX(60vw) rotate(30deg);
		}
	}
</style>

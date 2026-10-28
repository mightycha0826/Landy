<script lang="ts">
	/**
	 * 매너 평가 카드 (Phase 35) — 홈 가운데에 크게 뜨는 카드 (광고처럼). 아래에서 올라오는 시트 없이 이 카드 안에서 끝낸다:
	 * 표정을 고르면 그 자리에서 이유 칩이 펼쳐지고, 보내면 "고마워요" 뒤 카드가 닫힌다.
	 * ✕ · 바깥 · Esc = 나중에 (이 대화는 다시 묻지 않는다 — 부르는 쪽이 skipRating). 카드가 다 닫힌 뒤 onclose 로 알린다.
	 */
	import { focustrap } from '$lib/focustrap';
	import { backClose } from '$lib/overlay.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import RateForm from './RateForm.svelte';
	import type { PendingRating, Reason, Score } from '$lib/manner';

	let {
		p,
		onsubmit,
		onclose
	}: {
		p: PendingRating;
		/** 보내기 — 됐으면 true */
		onsubmit: (score: Score, reasons: Reason[]) => Promise<boolean>;
		/** 카드가 닫혔다 — sent: 보냄 · skip: 나중에 */
		onclose: (how: 'sent' | 'skip') => void;
	} = $props();
	const skip = () => close(() => onclose('skip'));
	// 저절로 뜨는 카드 — 누른 적이 있는 화면에서만 뒤로가기 기록을 쌓는다 (auto)
	backClose(skip, { auto: true });

	let done = $state(false);
	let leaving = $state(false);

	function close(after: () => void) {
		leaving = true;
		setTimeout(after, 220);
	}
	async function send(score: Score, reasons: Reason[]) {
		if (!(await onsubmit(score, reasons))) return;
		done = true;
		setTimeout(() => close(() => onclose('sent')), 1100);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !done && skip()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" class:leaving role="presentation" onclick={() => !done && skip()}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="card" role="dialog" aria-modal="true" aria-label="매너 평가" tabindex="-1" onclick={(e) => e.stopPropagation()} use:focustrap>
		<div class="hero" aria-hidden="true">
			<i class="orb a"></i><i class="orb b"></i>
			<span class="ring"><Avatar name={p.partner_alias} size={76} /></span>
		</div>
		{#if !done}
			<button class="x u-tap icon" onclick={skip} aria-label="나중에 하기">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
			</button>
			<p class="kicker">{p.pinned ? '고정한 대화' : '방금 끝난 대화'}</p>
			<RateForm alias={p.partner_alias} onsubmit={send} />
		{:else}
			<div class="thanks" role="status">
				<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3" /><path d="M14 25l7 7 13-15" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
				<strong>고마워요!</strong>
				<span>평가는 익명으로 전해져요</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgb(14 6 9 / 0.5);
		-webkit-backdrop-filter: blur(6px);
		backdrop-filter: blur(6px);
		animation: fade 0.3s ease-out;
		transition: opacity 0.22s ease-in;
	}
	.scrim.leaving {
		opacity: 0;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.card {
		position: relative;
		width: 100%;
		max-width: 380px;
		max-height: calc(100dvh - 40px);
		overflow-y: auto;
		padding: 0 0 14px;
		border-radius: 30px;
		background: var(--surface);
		box-shadow: var(--shadow-2);
		outline: none;
		animation: pop 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.12);
		transition: transform 0.22s ease-in;
	}
	.leaving .card {
		transform: scale(0.94) translateY(8px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.86) translateY(24px);
		}
	}
	/* 위쪽 — 테마 색 빛 덩어리 위에 상대 얼굴 */
	.hero {
		position: relative;
		display: grid;
		place-items: center;
		height: 128px;
		margin-bottom: -6px;
		overflow: hidden;
		border-radius: 30px 30px 0 0;
		background: var(--accent-fill);
	}
	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(18px);
		opacity: 0.7;
		animation: float 6s ease-in-out infinite alternate;
	}
	.orb.a {
		width: 150px;
		height: 150px;
		left: -30px;
		top: -50px;
		background: rgb(255 255 255 / 0.45);
	}
	.orb.b {
		width: 120px;
		height: 120px;
		right: -20px;
		bottom: -60px;
		background: rgb(255 220 160 / 0.5);
		animation-delay: -3s;
	}
	@keyframes float {
		to {
			transform: translate(20px, 12px) scale(1.1);
		}
	}
	.ring {
		position: relative;
		padding: 4px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.35);
		transform: translateY(26px);
		animation: bob 0.6s 0.15s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
	}
	@keyframes bob {
		from {
			transform: translateY(60px) scale(0.7);
		}
	}
	/* 보이는 원은 34, 누름은 44 (G1) */
	.x {
		position: absolute;
		top: 12px;
		right: 12px;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.28);
		color: #fff;
	}
	.x::after {
		content: '';
		position: absolute;
		inset: -5px;
	}
	.x svg {
		width: 18px;
		height: 18px;
	}
	.kicker {
		margin: 34px 0 6px;
		text-align: center;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.thanks {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 44px 20px 24px;
		color: var(--accent);
		text-align: center;
	}
	.thanks svg {
		width: 56px;
		height: 56px;
	}
	.thanks svg path {
		stroke-dasharray: 40;
		stroke-dashoffset: 40;
		animation: draw 0.45s 0.1s ease-out forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	.thanks strong {
		font-size: 20px;
		color: var(--text);
	}
	.thanks span {
		font-size: 13px;
		color: var(--text-2);
	}
</style>

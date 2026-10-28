<script lang="ts">
	/**
	 * 익명편지 잠금 화면 (Phase 44) — 가입한 학생이 모일 때까지 (lib/letters/gate.svelte.ts).
	 * 가운데 봉인된 봉투 · "○명이 모이면 열려요" · 실시간 가입 인원(숫자가 오르면 톡 튄다) · 채워지는 막대 · 친구에게 알리기.
	 */
	import { toast } from '$lib/state.svelte';
	import { GATE, gateMin } from './gate.svelte';

	let { checking = false }: { checking?: boolean } = $props();

	const min = $derived(gateMin());
	const n = $derived(GATE.students ?? 0);
	const pct = $derived(Math.min(100, Math.round((n / Math.max(1, min)) * 100)));
	const left = $derived(Math.max(0, min - n));

	async function share() {
		const url = location.origin + '/';
		const text = '우리 학교 익명 대화 앱 랜디 — 가입자가 모이면 익명편지가 열려요!';
		try {
			if (navigator.share) {
				await navigator.share({ title: 'Landy', text, url });
				return;
			}
			await navigator.clipboard.writeText(url);
			toast('링크를 복사했어요');
		} catch (e) {
			if ((e as Error)?.name !== 'AbortError') toast('링크를 복사하지 못했어요');
		}
	}
</script>

<div class="gate">
	<div class="art" aria-hidden="true">
		<span class="glow"></span>
		<svg viewBox="0 0 120 84" class="env">
			<rect x="4" y="6" width="112" height="74" rx="8" fill="var(--env-paper)" />
			<path d="M6 12l54 38 54-38" fill="none" stroke="var(--env-line)" stroke-width="3" stroke-linejoin="round" />
			<circle cx="60" cy="48" r="13" fill="#b8142f" />
			<path d="M55 47.5v-2.8a5 5 0 0 1 10 0v2.8M53.5 47.5h13v8h-13z" fill="none" stroke="#ffd6dc" stroke-width="2" stroke-linejoin="round" />
		</svg>
	</div>

	<h1>익명편지는 {min}명이 모이면 열려요</h1>
	<p class="why">가입한 학생이 적을 때는 누가 보냈는지 짐작하기 쉬워요. 모두의 익명을 지키려고 잠시 잠가 두었어요.</p>

	<div class="count" aria-live="polite">
		<span class="live"><i></i>실시간 가입</span>
		{#if checking}
			<span class="big num skeleton-text">··</span>
		{:else}
			{#key n}<strong class="big num">{n}</strong>{/key}
		{/if}
		<span class="of num">/ {min}명</span>
		<span class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={min} aria-valuenow={n} aria-label="가입 인원"><i style:width="{checking ? 0 : pct}%"></i></span>
		{#if !checking}<small class="left">{left > 0 ? `${left}명 더 모이면 열려요` : '곧 열려요'}</small>{/if}
	</div>

	<button class="btn share" onclick={share}>친구에게 알리기</button>
</div>

<style>
	.gate {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 28px var(--pad) 40px;
		text-align: center;
	}
	.art {
		position: relative;
		display: grid;
		place-items: center;
		width: 160px;
		height: 120px;
		margin-bottom: 6px;
	}
	.glow {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--g-coral) 35%, transparent), transparent 70%);
		filter: blur(10px);
		animation: breathe 3s ease-in-out infinite;
	}
	.env {
		position: relative;
		width: 128px;
		filter: drop-shadow(0 8px 16px rgb(60 30 20 / 0.25));
		animation: bob 3.2s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			transform: scale(1.12);
			opacity: 0.8;
		}
	}
	@keyframes bob {
		50% {
			transform: translateY(-5px) rotate(-2deg);
		}
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.03em;
	}
	.why {
		margin: 0;
		max-width: 320px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-2);
	}
	.count {
		display: grid;
		grid-template-columns: auto auto;
		justify-content: center;
		align-items: baseline;
		column-gap: 6px;
		width: 100%;
		max-width: 320px;
		margin-top: 10px;
		padding: 18px 18px 16px;
		border-radius: var(--r-card);
		background: var(--surface);
		box-shadow: var(--shadow-1);
	}
	.live {
		grid-column: 1 / -1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.live i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #22c55e;
		box-shadow: 0 0 0 0 rgb(34 197 94 / 0.6);
		animation: ping 1.6s ease-out infinite;
	}
	@keyframes ping {
		to {
			box-shadow: 0 0 0 8px rgb(34 197 94 / 0);
		}
	}
	.big {
		font-family: var(--display);
		font-size: 52px;
		font-weight: 650;
		line-height: 1;
		background: var(--brand);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: pop 0.45s cubic-bezier(0.3, 1.5, 0.5, 1);
	}
	@keyframes pop {
		from {
			transform: scale(1.35);
		}
	}
	.skeleton-text {
		animation: none;
		opacity: 0.4;
	}
	.of {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-2);
	}
	.bar {
		grid-column: 1 / -1;
		height: 8px;
		margin-top: 14px;
		border-radius: 999px;
		background: var(--field);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent-fill);
		transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.left {
		grid-column: 1 / -1;
		margin-top: 8px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.share {
		width: 100%;
		max-width: 320px;
		margin-top: 10px;
	}
</style>

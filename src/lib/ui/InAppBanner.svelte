<script lang="ts">
	/**
	 * 앱 안 알림 띠 (Phase 35) — 화면 위에서 내려오는 유리 카드. 누르면 그 화면으로, 위로 밀면 닫힌다.
	 * 새 알림이 오면 같은 자리에서 내용이 바뀐다 (쌓이지 않는다). 동작 줄이기면 app.css 가 움직임을 끈다.
	 */
	import { navigateFromOverlay } from '$lib/overlay.svelte';
	import { fly } from 'svelte/transition';
	import { depart, MOTION, motionDuration } from '$lib/motion';
	import { surface } from '$lib/transitions';
	import { INAPP, dismissInApp, holdInApp } from '$lib/inapp.svelte';
	import Avatar from './Avatar.svelte';

	let dy = $state(0);
	let startY = 0;
	let dragging = $state(false);
	let pointerId = -1;
	let suppressClick = false;
	let sample = { y: 0, t: 0, velocity: 0 };

	function open() {
		const n = INAPP.cur;
		if (!n) return;
		dismissInApp();
		void navigateFromOverlay(n.url); // 시트가 열려 있어도 이동이 취소되지 않게
	}
	function down(e: PointerEvent) {
		if (e.button !== 0 || dragging) return;
		startY = e.clientY;
		pointerId = e.pointerId;
		suppressClick = false;
		sample = { y: startY, t: performance.now(), velocity: 0 };
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		holdInApp(true);
	}
	function move(e: PointerEvent) {
		if (!dragging || e.pointerId !== pointerId) return;
		const distance = e.clientY - startY;
		dy = distance < 0 ? distance : distance / (1 + distance / 8);
		if (Math.abs(distance) > 4) suppressClick = true;
		const now = performance.now();
		if (now > sample.t) sample = { y: e.clientY, t: now, velocity: (e.clientY - sample.y) / (now - sample.t) };
	}
	function up(e: PointerEvent) {
		if (!dragging || e.pointerId !== pointerId) return;
		dragging = false;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		const velocity = performance.now() - sample.t < 100 ? sample.velocity : 0;
		if (e.type !== 'pointercancel' && (dy < -28 || (dy < -12 && velocity < -0.6))) dismissInApp();
		else { holdInApp(false); dy = 0; }
	}
	function cancel() {
		if (!dragging) return;
		dragging = false;
		suppressClick = true;
		holdInApp(false);
		dy = 0;
	}
	function bannerIn(node: Element) {
		dy = 0;
		return surface(node, { y: -node.getBoundingClientRect().height - 24, scale: 1 }, { direction: 'in' });
	}
</script>

{#if INAPP.cur}
	{@const n = INAPP.cur}
	{#key n.key}
		<div class="wrap inapp" role="status" aria-live="polite" in:bannerIn|global out:fly|global={{ y: -48, duration: motionDuration(MOTION.exit), easing: depart }}>
			<button
				class="card"
				class:drag={dragging}
				style:transform="translateY({dy}px)"
				onclick={(e) => (e.detail === 0 || !suppressClick) && open()}
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				onlostpointercapture={cancel}
			>
				{#key n.n}<span class="bump" aria-hidden="true"></span>{/key}
				<span class="ico {n.kind}" aria-hidden="true">
					{#if n.kind === 'chat' || n.kind === 'reaction'}
						<Avatar name={n.title} size={40} />
					{:else if n.kind === 'letter'}
						<svg viewBox="0 0 24 24"><path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="currentColor" /><path d="M4.5 7l7.5 5.5L19.5 7" fill="none" stroke="rgb(120 20 50 / .55)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
					{:else}
						<svg viewBox="0 0 24 24"><path d="M12 20.3s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor" /></svg>
					{/if}
				</span>
				<span class="txt">
					<span class="top"><strong>{n.title}</strong><small>지금</small></span>
					<span class="body">{n.body}</span>
				</span>
			</button>
		</div>
	{/key}
{/if}

<style>
	.wrap {
		position: fixed;
		left: 0;
		right: 0;
		top: calc(8px + var(--safe-top));
		z-index: 120;
		display: flex;
		justify-content: center;
		padding: 0 10px;
		pointer-events: none;
		view-transition-name: inapp;
	}
	.card:active:not(.drag) {
		filter: brightness(0.94);
	}
	.card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		max-width: 500px;
		padding: 12px 14px;
		border-radius: 22px;
		background: color-mix(in srgb, var(--surface) 82%, transparent);
		-webkit-backdrop-filter: saturate(180%) blur(24px);
		backdrop-filter: saturate(180%) blur(24px);
		border: 1px solid var(--glass-line);
		box-shadow: var(--shadow-2);
		text-align: left;
		pointer-events: auto;
		touch-action: none;
		transition: transform var(--dur-3) var(--ease-settle);
	}
	.card.drag {
		transition: none;
	}
	/* 같은 대화에서 새 말이 오면 살짝 튄다 */
	.bump {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		animation: bump 0.4s ease-out;
		pointer-events: none;
	}
	@keyframes bump {
		from {
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
		}
	}
	.ico {
		flex: none;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
	}
	.ico.letter,
	.ico.notice {
		background: var(--accent-fill-deep);
		color: #fff;
	}
	.ico svg {
		width: 22px;
		height: 22px;
	}
	.txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.top {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.top strong {
		flex: 1;
		min-width: 0;
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.top small {
		flex: none;
		font-size: 12px;
		color: var(--text-2);
	}
	.body {
		font-size: 14px;
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
</style>

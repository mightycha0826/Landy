<script lang="ts">
	/**
	 * 아래에서 올라오는 시트 — 대화방·편지 메뉴, 신고·차단 확인, 알림 권한 안내가 같이 쓴다.
	 * onclose 가 있으면 바깥을 누르거나 · Esc · 안드로이드 뒤로가기 · 손잡이를 아래로 끌어 닫힌다.
	 * 없으면(꼭 골라야 하는 안내) 버튼으로만 닫히고 뒤로가기 기록도 쌓지 않는다 (docs/UX-GUIDELINES.md G5.1).
	 *
	 * 안에 넣는 공용 모양: .item (한 줄 버튼, .danger) · .warn (확인 문구, .left)
	 */
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { focustrap } from '$lib/focustrap';
	import { backClose } from '$lib/overlay.svelte';
	import { depart, MOTION, motionDuration, settle } from '$lib/motion';

	let { onclose, label, children }: { onclose?: () => void; label?: string; children: Snippet } = $props();

	// svelte-ignore state_referenced_locally — 닫을 수 있는 시트인지는 열릴 때 한 번 정해진다
	if (onclose) backClose(() => onclose?.());

	// ── 끌어서 닫기 — 손잡이 · 시트 윗부분을 아래로. 80px 넘게 또는 빠르게 튕기면 닫고, 아니면 스프링으로 제자리 ──
	let sheetEl: HTMLDivElement | undefined = $state();
	let dy = $state(0);
	let dragging = $state(false);
	let start = { y: 0, t: 0, id: -1 };
	let sample = { y: 0, t: 0, velocity: 0 };
	function down(e: PointerEvent) {
		// 손잡이 띠(.grab)에서 시작한 끌기만 — 시트 안의 스크롤 · 버튼과 헷갈리지 않게
		if (!onclose || e.button !== 0 || !sheetEl || !(e.target as Element).closest('.grab')) return;
		start = { y: e.clientY, t: performance.now(), id: e.pointerId };
		sample = { y: e.clientY, t: start.t, velocity: 0 };
		dragging = true;
		sheetEl.setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!dragging || e.pointerId !== start.id) return;
		const d = e.clientY - start.y;
		dy = d > 0 ? d : d / 4; // 위로는 살짝만 (고무줄)
		const now = performance.now();
		const dt = now - sample.t;
		if (dt > 0) sample = { y: e.clientY, t: now, velocity: (e.clientY - sample.y) / dt };
	}
	function up(e: PointerEvent) {
		if (!dragging || e.pointerId !== start.id) return;
		dragging = false;
		if (sheetEl?.hasPointerCapture(e.pointerId)) sheetEl.releasePointerCapture(e.pointerId);
		const v = performance.now() - sample.t < 100 ? sample.velocity : 0;
		if (e.type !== 'pointercancel' && (dy > 80 || (dy > 24 && v > 0.6))) onclose?.();
		else dy = 0;
	}
	function cancel() {
		if (!dragging) return;
		dragging = false;
		dy = 0;
	}
	function slideIn(node: Element) {
		const h = node.getBoundingClientRect().height;
		return { duration: motionDuration(MOTION.sheet), easing: settle, css: (t: number) => `transform: translateY(${(1 - t) * h}px)` };
	}

	/** 사라질 때 — 시트는 아래로 미끄러지고(끌던 자리에서 이어서) 바탕은 흐려진다 (G7.1) */
	function slideOut(node: Element) {
		// Closing during entrance or spring-back continues from the rendered position.
		const transform = getComputedStyle(node).transform;
		const from = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
		const h = node.getBoundingClientRect().height;
		return {
			duration: motionDuration(MOTION.sheetExit),
			easing: depart,
			css: (t: number) => `transform: translateY(${from + (1 - t) * (h - from)}px)`
		};
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose?.()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" role="presentation" onclick={() => onclose?.()} in:fade={{ duration: motionDuration(MOTION.enter) }} out:fade={{ duration: motionDuration(MOTION.sheetExit) }}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="sheet"
		class:dragging
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
		bind:this={sheetEl}
		style:transform={dy ? `translateY(${dy}px)` : null}
		onclick={(e) => e.stopPropagation()}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onlostpointercapture={cancel}
		use:focustrap
		in:slideIn
		out:slideOut
	>
		{#if onclose}<div class="grab" aria-hidden="true"></div>{/if}
		{@render children()}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		/* 아이폰은 키보드가 시트 아래를 가린다 — 그만큼 올려서 신고 메모 · 버튼이 키보드 위에 (Phase 41) */
		padding-bottom: var(--kb, 0px);
		background: rgb(14 6 9 / 0.48);
		-webkit-backdrop-filter: blur(3px);
		backdrop-filter: blur(3px);
	}
	/* 아래에서 튀어 오르는 둥근 판 — 위에 손잡이 */
	.sheet {
		position: relative;
		width: 100%;
		max-width: 520px;
		max-height: calc(var(--vvh, 100dvh) * 0.92);
		overflow-y: auto;
		padding: 22px 0 calc(10px + env(safe-area-inset-bottom));
		border-radius: 28px 28px 0 0;
		background: var(--surface);
		box-shadow: var(--shadow-2);
		outline: none;
		/* 끌기를 놓으면 스프링으로 제자리 (끄는 동안은 손가락을 바로 따라간다) */
		transition: transform var(--dur-3) var(--ease-settle);
		touch-action: pan-y;
	}
	.sheet.dragging {
		transition: none;
	}
	/* 손잡이 띠 — 윗 여백 전체. 여기서만 끌어 닫는다(브라우저 스크롤이 가로채지 않게 touch-action: none) */
	.grab {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 22px;
		touch-action: none;
		cursor: grab;
	}
	.sheet::before {
		content: '';
		position: absolute;
		top: 8px;
		left: 50%;
		width: 40px;
		height: 5px;
		margin-left: -20px;
		border-radius: 999px;
		background: var(--line);
	}
	.sheet :global(.item) {
		display: block;
		width: 100%;
		height: 54px;
		font-size: 16px;
		font-weight: 600;
		border-top: 1px solid var(--line);
		transition: background 0.15s;
	}
	.sheet :global(.item:active:not(:disabled)) {
		background: var(--field);
	}
	.sheet :global(.item:first-child),
	.grab + :global(.item) {
		border-top: 0;
	}
	.sheet :global(.item.danger) {
		color: var(--danger);
		font-weight: 600;
	}
	.sheet :global(.item:disabled) {
		opacity: 0.4;
	}
	.sheet :global(.warn) {
		margin: 8px var(--pad) 12px;
		text-align: center;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-2);
	}
	.sheet :global(.warn.left) {
		text-align: left;
		margin: 0 0 12px;
	}
	.sheet :global(.warn strong) {
		color: var(--text);
		font-weight: 600;
	}
</style>

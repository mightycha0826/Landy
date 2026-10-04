<script lang="ts">
	/**
	 * 말 입력 알약 (Phase 42 에서 하나로) — 대화방 · AI 대화가 같이 쓴다.
	 * 줄이 늘면 칸이 자라고(최대 120px), Enter 는 보내기 · Shift+Enter 는 줄바꿈 (한글 조합 중 Enter 는 무시 — IME).
	 * 설정 › 대화 › "Enter 키로 보내기"를 끄면 Enter 도 줄바꿈이고 보내기 단추로만 보낸다 (Phase 43). 휴대폰 키보드의 Enter 자리도 그에 맞춰 "보내기" / "줄바꿈".
	 * 글자는 16px — 아이폰이 입력칸에 들어갈 때 화면을 확대하지 않게 (G6.8).
	 */
	import { PREFS } from '$lib/prefs.svelte';
	import { onDestroy } from 'svelte';
	import { motionDuration, MOTION } from '$lib/motion';

	let {
		value = $bindable(''),
		el = $bindable(),
		placeholder,
		disabled = false,
		canSend,
		dim = false,
		maxlength,
		oninput,
		onsubmit
	}: {
		value?: string;
		/** 입력칸 — 보낸 뒤 다시 초점을 줄 때 */
		el?: HTMLTextAreaElement;
		placeholder: string;
		/** 입력칸 자체를 끈다 */
		disabled?: boolean;
		/** 보내기 단추를 켤지 */
		canSend: boolean;
		/** 대화할 수 없는 상태 — 알약을 옅게 */
		dim?: boolean;
		maxlength?: number;
		oninput?: () => void;
		onsubmit: () => void;
	} = $props();

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && PREFS.enterSend) {
			e.preventDefault();
			if (canSend) onsubmit();
		}
	}
	// 자동 높이
	let resizing: Animation | undefined;
	onDestroy(() => resizing?.cancel());
	$effect(() => {
		void value;
		if (!el) return;
		const previous = el.getBoundingClientRect().height;
		resizing?.cancel();
		el.style.height = 'auto';
		const height = Math.min(el.scrollHeight, 120);
		el.style.height = height + 'px';
		const duration = motionDuration(MOTION.enter);
		if (previous > 0 && previous !== height && duration) {
			resizing = el.animate([{ height: `${previous}px` }, { height: `${height}px` }], { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
		}
	});
</script>

<div class="pill" class:dim>
	<textarea bind:this={el} bind:value rows="1" {placeholder} {disabled} {maxlength} {oninput} {onkeydown} enterkeyhint={PREFS.enterSend ? 'send' : 'enter'}></textarea>
	<button class="send" onclick={onsubmit} disabled={!canSend}>보내기</button>
</div>

<style>
	.pill {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		min-height: 48px;
		padding: 7px 8px 7px 18px;
		border: 1.5px solid transparent;
		border-radius: 26px;
		background: var(--field);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.pill:focus-within {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
		background: var(--surface);
	}
	.pill.dim {
		background: var(--surface);
	}
	textarea {
		flex: 1;
		min-width: 0;
		padding: 6px 0;
		border: 0;
		outline: none;
		resize: none;
		background: none;
		/* 16px 미만이면 아이폰이 입력칸에 들어갈 때 화면을 확대하고 그대로 둔다 (G6.8) */
		font-size: 16px;
		line-height: 1.38;
		max-height: 120px;
	}
	textarea::placeholder {
		color: var(--text-2);
	}
	/* 보내기 — 누름 높이 44, 알약 안쪽 여백으로 파고들어 알약 높이(48)는 그대로 */
	.send {
		flex: none;
		min-height: 44px;
		margin: -5px -4px -5px 0;
		padding: 0 10px;
		transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-3) var(--ease-settle), color var(--dur-2);
		color: var(--accent);
		font-weight: 600;
		font-size: 15px;
	}
	.send:active:not(:disabled) {
		opacity: 0.55;
		transform: scale(0.94);
		transition-duration: 0.08s;
	}
	.send:disabled {
		color: var(--text-2);
		opacity: 0.6;
		cursor: default;
	}
</style>

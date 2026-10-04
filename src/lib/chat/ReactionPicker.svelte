<script lang="ts">
	/**
	 * 공감 고르기 줄 — 말풍선 위(자리가 없으면 아래)에 뜬다. 바깥을 누르거나 Esc 로 닫힌다.
	 * react = false 면(끝난 대화 · 시스템 안내) "복사"만. 대화 중에는 "답장"도. ondelete 가 있으면(내 말) "삭제"도.
	 */
	import { REACTIONS, type ReactionKey } from './types';
	import { backClose } from '$lib/overlay.svelte';
	import { surface } from '$lib/transitions';

	let {
		at,
		react,
		current,
		onpick,
		onreply,
		oncopy,
		ondelete,
		onclose
	}: {
		at: { top: number; left: number | null; right: number | null };
		react: boolean;
		current?: ReactionKey;
		onpick: (k: ReactionKey) => void;
		onreply: () => void;
		oncopy: () => void;
		ondelete?: () => void;
		onclose: () => void;
	} = $props();
	backClose(() => onclose());

	// 길게 눌러 연 손가락을 떼면 브라우저가 그 자리에 click 을 보낼 수 있다. 누르는 동안 목록이 움직이면(입력 중 표시가
	// 사라짐 · 새 메시지) 고르기 줄이 말풍선을 따라 손가락 밑으로 와서, 그 click 이 공감을 눌러 버렸다.
	// 줄 안에서 새로 누른 것만 받는다 — 키보드(Enter · Space)의 click 은 detail 0
	let armed = false;
	const pressed = (fn: () => void) => (e: MouseEvent) => {
		if (armed || e.detail === 0) fn();
	};
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="rx-scrim" role="presentation" onpointerdown={onclose}></div>
<!-- data-keep-kb: 입력 중에 열었으면 공감 · 답장을 눌러도 키보드를 내리지 않는다 (답장은 입력칸에 초점을 준다, lib/keyboard.svelte.ts) -->
<div
	class="rx-pick"
	data-keep-kb
	in:surface={{ y: 4, scale: 0.94 }}
	out:surface={{ y: 4, scale: 0.97 }}
	role="menu"
	aria-label="공감"
	tabindex="-1"
	style:top="{at.top}px"
	style:left={at.left != null ? `${at.left}px` : null}
	style:right={at.right != null ? `${at.right}px` : null}
	onpointerdown={() => (armed = true)}
>
	{#if react}
		{#each REACTIONS as r (r.k)}
			<button class="rx" class:on={current === r.k} role="menuitem" aria-label={r.label} onclick={pressed(() => onpick(r.k))}>
				{r.e}
			</button>
		{/each}
		<span class="sep" aria-hidden="true"></span>
		<button class="copy" role="menuitem" onclick={pressed(onreply)}>답장</button>
	{/if}
	<button class="copy" role="menuitem" onclick={pressed(oncopy)}>복사</button>
	{#if ondelete}<button class="copy del" role="menuitem" onclick={pressed(ondelete)}>삭제</button>{/if}
</div>

<style>
	.rx-scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.rx-pick {
		position: fixed;
		z-index: 41;
		display: flex;
		align-items: center;
		gap: 2px;
		max-width: calc(100vw - 16px);
		height: 48px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--bg);
		box-shadow: 0 4px 20px rgb(0 0 0 / 0.18), 0 0 0 1px var(--line);
	}
	.rx {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		font-size: 23px;
		line-height: 1;
		transition: transform var(--dur-3) var(--ease-settle);
	}
	.rx:active {
		transform: scale(1.25);
		transition-duration: var(--dur-press);
	}
	.rx.on {
		background: var(--field);
	}
	.sep {
		width: 1px;
		height: 24px;
		margin: 0 4px;
		background: var(--line);
	}
	.copy {
		flex: none;
		padding: 0 8px;
		height: 36px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
	.del {
		color: var(--danger);
	}
</style>

<script lang="ts">
	/**
	 * 편지함의 봉투 한 장 (Phase 32).
	 *   받은 편지 — 덮개 쪽(뒷면): 안 연 편지는 밀랍 봉인이 그대로 · 은은히 빛난다 / 연 편지는 봉인이 없다. From. · 날짜
	 *              테두리 줄무늬 = 보낸 사람 성별 (여학생 붉은색 · 남학생 푸른색, Phase 35)
	 *   보낸 편지 — 주소 쪽(앞면): To. · 우표 · 소인(날짜) · 스티커(읽음 · 답장 옴)
	 * 누르면 그 편지를 연다. 길게 누르면(마우스는 오른쪽 클릭) 봉투 메뉴 (LetterMenu).
	 * 고르는 중(selecting, Phase 47)이면 누르기 · 길게 누르기 모두 고르기/풀기 — 오른쪽 위에 동그라미 체크. 안 연 받은 편지는 못 고른다(흐리게).
	 * showBox(폴더 안, Phase 47-3) — 받은 · 보낸 편지가 섞여 있으니 왼쪽 위에 "받은 편지"(테마 색 · 들어오는 화살표) /
	 *   "보낸 편지"(진한 색 · 종이비행기) 딱지. 답장이면 "받은 답장" · "보낸 답장" (따로 붙던 "답장" 딱지 대신)
	 */
	import Envelope from './Envelope.svelte';
	import { borderOf, fromLabel, stampDate, toLabel, type Box, type MailItem } from './api';
	import { longpress } from '../longpress';

	let {
		item,
		box,
		me,
		w,
		tilt = 0,
		selecting = false,
		picked = false,
		showBox = false,
		onopen,
		onmenu,
		ontoggle
	}: {
		item: MailItem;
		box: Box;
		me: string;
		w: number;
		tilt?: number;
		selecting?: boolean;
		picked?: boolean;
		showBox?: boolean;
		onopen: () => void;
		onmenu: () => void;
		ontoggle?: () => void;
	} = $props();

	const received = $derived(box === 'received');
	const who = $derived(received ? fromLabel(item) : toLabel(item));
	const sticker = $derived(received ? '' : item.replied ? '답장 옴' : item.opened ? '읽음' : '');
	/** 폴더에 넣을 수 있나 — 받은 편지는 봉투를 열어 본 것만 (Phase 47) */
	const pickable = $derived(!received || item.opened);
	const label = $derived(
		received
			? `${who}에게서 온 ${item.is_reply ? '답장' : '편지'}${item.opened ? '' : ', 안 읽음'}`
			: `${who}에게 보낸 ${item.is_reply ? '답장' : '편지'}${item.replied ? ', 답장 옴' : item.opened ? ', 읽음' : ''}`
	);
</script>

<button
	class="item"
	class:unread={received && !item.opened && !selecting}
	class:selecting
	class:picked
	class:off={selecting && !pickable}
	style:--tilt="{tilt}deg"
	onclick={() => (selecting ? ontoggle?.() : onopen())}
	use:longpress={() => (selecting ? ontoggle?.() : onmenu())}
	aria-label={label}
	aria-pressed={selecting ? picked : undefined}
>
	<Envelope
		to={received ? me : who}
		toSub={!received && item.to_grade ? `${item.to_grade}학년` : ''}
		from={received ? who : me}
		date={stampDate(item.created_at)}
		side={received ? 'back' : 'front'}
		sealed={received && !item.opened}
		border={borderOf(item, box)}
		glow={received && !item.opened}
		{sticker}
		{w}
	/>
	{#if showBox}
		<span class="dir" class:out={!received} aria-hidden="true">
			{#if received}
				<svg viewBox="0 0 24 24"><path d="M12 4v9m0 0l-4-4m4 4l4-4M5 14v3.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
			{:else}
				<svg viewBox="0 0 24 24"><path d="M20.5 3.5L10 14M20.5 3.5L14 20.5l-4-6.5-6.5-4 17-6.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
			{/if}
			{received ? '받은' : '보낸'} {item.is_reply ? '답장' : '편지'}
		</span>
	{:else if item.is_reply}<span class="tag">답장</span>{/if}
	{#if received && !item.opened}<span class="new">새 편지</span>{/if}
	{#if item.removed}<span class="tag removed">내려진 편지</span>{/if}
	{#if selecting && pickable}
		<span class="check" aria-hidden="true">
			{#if picked}<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
		</span>
	{/if}
</button>

<style>
	.item {
		position: relative;
		display: block;
		margin: 0 auto;
		perspective: 1200px;
		transform: rotate(var(--tilt));
		transition: transform var(--dur-3) var(--ease-settle);
	}
	.item:active {
		transform: rotate(0deg) scale(0.97);
		transition-duration: var(--dur-press);
	}
	.item.unread {
		animation: nudge 3.2s ease-in-out infinite;
	}
	@keyframes nudge {
		0%,
		86%,
		100% {
			transform: rotate(var(--tilt));
		}
		90% {
			transform: rotate(calc(var(--tilt) - 2deg));
		}
		95% {
			transform: rotate(calc(var(--tilt) + 2deg));
		}
	}
	.tag,
	.new {
		position: absolute;
		top: -8px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 800;
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.15);
	}
	.new {
		right: -4px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.tag {
		left: -4px;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--line);
	}
	/* 고르는 중 — 고른 봉투는 테마 색 테두리 · 체크, 못 고르는 봉투(안 연 받은 편지)는 흐리게 */
	.item.selecting {
		transform: rotate(0deg) scale(0.94);
	}
	.item.picked {
		transform: rotate(0deg) scale(0.97);
		filter: drop-shadow(0 0 0 transparent) drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 80%, transparent));
	}
	.item.picked::after {
		content: '';
		position: absolute;
		inset: -6px;
		border: 2.5px solid var(--accent);
		border-radius: 12px;
		pointer-events: none;
	}
	.item.off {
		opacity: 0.4;
	}
	.check {
		position: absolute;
		top: -12px;
		right: -12px;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 2px solid var(--bg);
		background: color-mix(in srgb, var(--surface) 85%, transparent);
		box-shadow: 0 0 0 1.5px var(--text-2), 0 2px 6px rgb(0 0 0 / 0.2);
	}
	.picked .check {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.2);
	}
	.check svg {
		width: 18px;
		height: 18px;
	}
	.tag.removed {
		top: auto;
		bottom: -8px;
		color: var(--danger);
	}
	/* 받은 · 보낸 딱지 (폴더 안) — 받은 편지는 흰 바탕 테마 색 글씨, 보낸 편지는 진한 바탕 흰 글씨 (다크 모드에선 반대로 밝은 바탕) */
	.dir {
		position: absolute;
		top: -10px;
		left: -4px;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px 4px 8px;
		border-radius: 999px;
		background: var(--surface);
		color: var(--accent);
		font-size: 12px;
		font-weight: 800;
		white-space: nowrap;
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent), 0 2px 6px rgb(0 0 0 / 0.15);
	}
	.dir.out {
		background: var(--text);
		color: var(--bg);
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.2);
	}
	.dir svg {
		width: 14px;
		height: 14px;
	}
</style>

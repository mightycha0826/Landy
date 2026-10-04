<script lang="ts">
	/**
	 * 봉투 더미 (Phase 42 에서 하나로) — 편지함의 새 편지(/letters) · 보관함(/letters/archive)이 같이 쓴다.
	 * 큰 봉투가 한 장씩 비스듬히 놓이고, 들어올 때 위에서 한 통씩 조금 늦게 내려앉는다 (8통까지, G7.2).
	 * 누르면 그 편지를 연다. 길게 누르면(마우스는 오른쪽 클릭) 봉투 메뉴(LetterMenu) — 버리기 · 차단 · 신고를 하면 그 사람과의 편지를 목록에서 뺀다.
	 * loading 이면 봉투 모양 빈 자리(ghosts 장)가 은은히 숨 쉰다 (G4).
	 * 고르는 중(selecting, Phase 47)이면 누르면 고르기 — picked(고른 편지 id) · ontoggle. 폴더 안에서는 편지마다 받은/보낸이 달라서 it.box 를 먼저 본다.
	 * showBox(폴더 안, Phase 47-3) — 봉투마다 "받은 편지" · "보낸 편지" 딱지.
	 */
	import { goto } from '$app/navigation';
	import { S } from '$lib/state.svelte';
	import MailboxItem from './MailboxItem.svelte';
	import LetterMenu from './LetterMenu.svelte';
	import { iAmRecipient, myLabel, otherLabel, type Box, type MailItem } from './api';
	import { dropThread } from './mailbox.svelte';
	import { envWidth, tilt } from './stage';

	let {
		items,
		box,
		loading = false,
		ghosts = 1,
		selecting = false,
		picked = [],
		showBox = false,
		ontoggle,
		ondrop
	}: {
		items: MailItem[];
		box: Box;
		loading?: boolean;
		ghosts?: number;
		selecting?: boolean;
		picked?: number[];
		showBox?: boolean;
		ontoggle?: (it: MailItem) => void;
		/** 봉투 메뉴로 그 사람과의 편지를 지웠다 — BOX 밖의 목록(폴더 화면)도 고치게 */
		ondrop?: (threadId: number) => void;
	} = $props();

	const w = $derived(envWidth(340, 56));
	const boxOf = (it: MailItem) => it.box ?? box;
	const me = (it: MailItem) => myLabel(it, boxOf(it), { name: S.me?.name, gender: S.profile?.gender });
	let menuFor = $state<MailItem | null>(null);
</script>

{#if loading}
	<p class="sr-only">불러오는 중…</p>
	{#each { length: ghosts } as _, i (i)}
		<div class="ghost" style:--w="{w}px" aria-hidden="true"></div>
	{/each}
{:else}
	<ul class="stack">
		{#each items as it, i (it.id)}
			<li class="arrive" style:--i={Math.min(i, 8)}>
				<MailboxItem
					item={it}
					box={boxOf(it)}
					me={me(it)}
					{w}
					tilt={tilt(i)}
					{selecting}
					{showBox}
					picked={picked.includes(it.id)}
					onopen={() => goto(`/letters/m/${it.id}`)}
					onmenu={() => (menuFor = it)}
					ontoggle={() => ontoggle?.(it)}
				/>
			</li>
		{/each}
	</ul>
{/if}

{#if menuFor}
	<LetterMenu
		thread={{ id: menuFor.thread_id, recipient: iAmRecipient(menuFor, boxOf(menuFor)) }}
		title={otherLabel(menuFor, boxOf(menuFor))}
		item={menuFor}
		box={boxOf(menuFor)}
		onclose={() => (menuFor = null)}
		ondone={() => {
			const t = menuFor?.thread_id;
			menuFor = null;
			if (t != null) {
				dropThread(t);
				ondrop?.(t);
			}
		}}
	/>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 26px;
		margin: 6px 0 4px;
		padding: 0;
		list-style: none;
	}
	/* 도착 — 위에서 살짝 떨어져 내려앉는다 (한 통씩 조금 늦게) */
	.arrive {
		animation: arrive var(--dur-3) calc(min(var(--i), 7) * 40ms) var(--ease-settle) both;
	}
	@keyframes arrive {
		from {
			opacity: 0;
			transform: translateY(-18px) rotate(-2deg);
		}
	}
	/* 불러오는 동안 — 봉투 모양 빈 자리가 은은히 숨 쉰다 */
	.ghost {
		align-self: center;
		width: var(--w);
		height: calc(var(--w) * 0.62);
		border-radius: 8px;
		background: linear-gradient(100deg, var(--field) 30%, var(--surface) 50%, var(--field) 70%) 0 0 / 300% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	.ghost + .ghost {
		margin-top: 10px;
	}
	@keyframes shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: 0 0;
		}
	}
</style>

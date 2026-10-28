<script lang="ts">
	/**
	 * 고정한 대화 (Phase 29 · 33) — 홈 위쪽의 인스타 "스토리" 줄. 동그란 얼굴 · 새 메시지면 그라데이션 테두리 + 수.
	 * 누르면 그 대화로, 길게 누르면(마우스는 오른쪽 클릭) 대화 메뉴 (onmenu → RoomMenu). 고정한 대화가 없으면 아무것도 그리지 않는다.
	 */
	import { goto } from '$app/navigation';
	import Avatar from '$lib/ui/Avatar.svelte';
	import { longpress } from '$lib/longpress';
	import type { InboxRoom } from '$lib/inbox.svelte';

	let { rooms, onmenu }: { rooms: InboxRoom[]; onmenu: (r: InboxRoom) => void } = $props();
</script>

{#if rooms.length}
<section class="stories" aria-label="고정한 대화">
	{#each rooms as r (r.room_id)}
		<button class="story" onclick={() => goto(`/chat/${r.room_id}`)} use:longpress={() => onmenu(r)} aria-label="{r.partner_alias} (고정한 대화){r.unread ? `, 새 메시지 ${r.unread}개` : ''}">
			<span class="story-ring" class:fresh={r.unread > 0}><Avatar name={r.partner_alias} size={58} online={r.partner_online} /></span>
			<span class="story-name">{r.partner_alias}</span>
			{#if r.unread > 0}<span class="story-badge num">{r.unread > 99 ? '99+' : r.unread}</span>{/if}
		</button>
	{/each}
</section>
{/if}

<style>
	/* 고정한 대화 — 스토리 줄 */
	.stories {
		display: flex;
		gap: 14px;
		margin: 0 calc(-1 * var(--pad));
		padding: 4px var(--pad) 6px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.stories::-webkit-scrollbar {
		display: none;
	}
	/* 누름 반응 (UX G2) */
	.story:active {
		transform: scale(0.96);
	}
	.story {
		transition: transform 0.15s;
	}
	.story {
		position: relative;
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 72px;
	}
	.story-ring {
		padding: 3px;
		border-radius: 50%;
		background: var(--track);
	}
	.story-ring.fresh {
		background: var(--primary);
	}
	.story-ring :global(.av) {
		border: 3px solid var(--bg);
	}
	.story-name {
		max-width: 100%;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 12px;
		font-weight: 600;
	}
	.story-badge {
		position: absolute;
		top: 0;
		right: 2px;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		background: var(--accent-fill-deep);
		color: #fff;
		font-size: 11px;
		font-weight: 650;
		line-height: 20px;
		border: 2px solid var(--bg);
		box-sizing: content-box;
	}
</style>

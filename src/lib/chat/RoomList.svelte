<script lang="ts">
	/**
	 * 홈의 대화 목록 (인스타 DM 받은편지함) — 카드 없이 바탕 위에 72px 줄: 얼굴 · 이름 · 마지막 말 · 남은 시간 · 안 읽은 수.
	 * 아직 안 열어 본 새 대화(상대가 나를 잡아감)는 연결 화면부터. 길게 누르면(마우스는 오른쪽 클릭) 대화 메뉴 (onmenu → RoomMenu).
	 */
	import { goto } from '$app/navigation';
	import Avatar from '$lib/ui/Avatar.svelte';
	import { longpress } from '$lib/longpress';
	import { INBOX as inbox, type InboxRoom } from '$lib/inbox.svelte';
	import { S } from '$lib/state.svelte';
	import { mmss } from '$lib/time';
	import { flip } from 'svelte/animate';
	import { MOTION, motionDuration, settle } from '$lib/motion';
	import { surface } from '$lib/transitions';

	let {
		rooms,
		count,
		max,
		onmenu
	}: { rooms: InboxRoom[]; /** 동시 대화 수 (고정한 대화 빼고) */ count: number; max: number; onmenu: (r: InboxRoom) => void } = $props();

	function remain(r: InboxRoom) {
		// 멈춘 방은 불러온 때의 남은 시간 그대로 (둘 다 대화 화면을 볼 때만 흐른다)
		const ms = Math.max(0, Date.parse(r.expires_at) - (r.paused ? inbox.serverAt : S.now + inbox.skew));
		return { text: mmss(Math.ceil(ms / 1000)), urgent: !r.paused && ms <= 60_000 };
	}

	function preview(r: InboxRoom) {
		if (r.status === 'pending') return r.joined ? '상대가 들어오기를 기다리는 중' : '새 대화 · 눌러서 시작하기';
		if (!r.last_body || r.last_seat === 0) return '대화를 시작해 보세요';
		return r.last_seat === r.my_seat ? `나: ${r.last_body}` : r.last_body;
	}
</script>

<div class="section">
	<h2>대화</h2>
	<span>{count}/{max}</span>
</div>
<ul class="rooms">
	{#each rooms as r, i (r.room_id)}
		{@const t = remain(r)}
		<li animate:flip={{ duration: () => motionDuration(MOTION.settle), easing: settle }} in:surface={{ y: 10, scale: 1, delay: Math.min(i, 7) * 40 }} out:surface={{ y: -4, scale: 1 }}>
			<!-- 아직 안 열어 본 새 대화(상대가 나를 잡아감)면 연결 화면부터 -->
			<button
				class="list-row tall"
				onclick={() => goto(`/chat/${r.room_id}`, { state: { matched: !r.joined } })}
				use:longpress={() => onmenu(r)}
			>
				<Avatar name={r.partner_alias} size={52} online={r.partner_online} />
				<span class="lr-mid">
					<span class="lr-name">{r.partner_alias}</span>
					<span class="lr-sub" class:bold={r.unread > 0 || !r.joined}>{preview(r)}</span>
				</span>
				<span class="lr-end">
					{#if r.pinned}
						<!-- 둘 다 고정한 대화 — 시간 제한이 없고 목록 맨 위 (서버가 먼저 정렬해 준다) -->
						<span class="pin" aria-label="고정한 대화">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6l-1 5.5 3.5 3.5v1.5h-11V12.5L10 9 9 3.5zM12 14v6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg>
						</span>
					{:else if r.status === 'active'}
						<span class="time" class:urgent={t.urgent} class:paused={r.paused}>{t.text}</span>
					{/if}
					{#if r.unread > 0}
						<span class="pt-count">{r.unread > 99 ? '99+' : r.unread}</span>
					{:else if !r.joined}
						<span class="pt-dot" aria-label="새 대화"></span>
					{/if}
				</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	/* 대화 목록 — 카드 없이 바탕 위에 72px 줄 */
	.rooms {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.bold {
		color: var(--text);
		font-weight: 550;
	}
	.pin {
		display: grid;
		place-items: center;
		color: var(--primary-icon);
	}
	.pin svg {
		width: 16px;
		height: 16px;
	}
	.time.paused {
		opacity: 0.5;
	}
	/* 1분 안에 끝남 — point (곧 끝남) */
	.time.urgent {
		color: var(--point-text);
		font-weight: 600;
	}
</style>

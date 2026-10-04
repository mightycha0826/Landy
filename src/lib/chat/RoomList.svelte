<script lang="ts">
	/**
	 * 홈의 대화 목록 (인스타 DM 받은편지함) — 흰 카드 한 장 안에 줄들: 얼굴 · 이름 · 마지막 말 · 남은 시간 · 안 읽은 수.
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

<div class="head">
	<h2>대화</h2>
	<span class="muted num">{count}/{max}</span>
</div>
<ul class="rooms">
	{#each rooms as r, i (r.room_id)}
		{@const t = remain(r)}
		<li animate:flip={{ duration: () => motionDuration(MOTION.settle), easing: settle }} in:surface={{ y: 10, scale: 1, delay: Math.min(i, 7) * 40 }} out:surface={{ y: -4, scale: 1 }}>
			<!-- 아직 안 열어 본 새 대화(상대가 나를 잡아감)면 연결 화면부터 -->
			<button
				class="room"
				onclick={() => goto(`/chat/${r.room_id}`, { state: { matched: !r.joined } })}
				use:longpress={() => onmenu(r)}
			>
				<Avatar name={r.partner_alias} size={52} online={r.partner_online} />
				<span class="mid">
					<span class="name" class:bold={r.unread > 0 || !r.joined}>{r.partner_alias}</span>
					<span class="last" class:bold={r.unread > 0 || !r.joined}>{preview(r)}</span>
				</span>
				<span class="right">
					{#if r.pinned}
						<!-- 둘 다 고정한 대화 — 시간 제한이 없고 목록 맨 위 (서버가 먼저 정렬해 준다) -->
						<span class="pin" aria-label="고정한 대화">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6l-1 5.5 3.5 3.5v1.5h-11V12.5L10 9 9 3.5zM12 14v6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg>
						</span>
					{:else if r.status === 'active'}
						<span class="time num" class:urgent={t.urgent} class:paused={r.paused}>{t.text}</span>
					{/if}
					{#if r.unread > 0}
						<span class="badge num">{r.unread > 99 ? '99+' : r.unread}</span>
					{:else if !r.joined}
						<span class="new"></span>
					{/if}
				</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	/* 목록 */
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-top: 6px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.head span {
		font-size: 13px;
	}
	/* 대화 목록 — 흰 카드 한 장 안에 줄들 */
	.rooms {
		list-style: none;
		margin: 0;
		padding: 6px 0;
		border-radius: var(--r-card);
		background: var(--surface);
		box-shadow: var(--shadow-1);
	}
	.room {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 9px 14px;
		text-align: left;
		transition: background var(--dur-2) var(--ease-out), transform var(--dur-3) var(--ease-settle);
	}
	.room:active {
		background: var(--field);
		transform: scale(0.985);
		transition-duration: var(--dur-press);
	}
	.mid {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	.last {
		font-size: 13px;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bold {
		font-weight: 700;
		color: var(--text);
	}
	.right {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}
	.time {
		font-size: 12px;
		color: var(--text-2);
	}
	.pin {
		display: grid;
		place-items: center;
		color: var(--accent);
	}
	.pin svg {
		width: 16px;
		height: 16px;
	}
	.time.paused {
		opacity: 0.5;
	}
	.time.urgent {
		color: var(--danger);
	}
	.badge {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		font-size: 11px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}
	/* 아직 열어 보지 않은 새 대화 — 인스타의 파란 점 자리 */
	.new {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent-fill-deep);
	}
</style>

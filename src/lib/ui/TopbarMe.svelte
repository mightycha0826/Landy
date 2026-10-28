<script lang="ts">
	/**
	 * 상단 바 오른쪽 — 하트(알림) + 설정(톱니). 탭 첫 화면(익명편지 · 채팅 · 프로필)이 같이 쓴다.
	 * 하트 = 모든 알림 (Phase 35 — 인스타처럼): 새 메시지 · 새 편지 · 공지 · 나에게 온 개인 공지. 하나라도 있으면 빨간 점.
	 * 두 아이콘은 같은 크기 · 같은 선 굵기 · 같은 누르는 칸(40px).
	 * 공지는 화면이 보이는 동안 5분마다, 앱으로 돌아올 때 새로 확인한다 (탭을 오가도 1분 안이면 다시 부르지 않는다).
	 */
	import { goto } from '$app/navigation';
	import { NOTICES, hasNewNotice, loadNotices, unreadPersonal } from '$lib/notices.svelte';
	import { INBOX } from '$lib/inbox.svelte';
	import { DM } from '$lib/letters/unread.svelte';
	import { whileVisible } from '$lib/visible';

	$effect(() => {
		void loadNotices(); // 탭을 오가며 다시 그려질 때 — 1분 안이면 건너뛴다
		// 5분마다 · 앱으로 돌아올 때는 꼭 새로 (그사이 올라온 공지에 바로 점이 뜨게)
		return whileVisible(() => void loadNotices(true), 300_000);
	});

	const count = $derived(
		INBOX.rooms.filter((r) => r.unread > 0 || !r.joined).length +
			DM.unread +
			(NOTICES.loaded && hasNewNotice() ? 1 : 0) +
			unreadPersonal()
	);
</script>

<div class="actions">
	<button class="ic heart" onclick={() => goto('/activity')} aria-label={count ? `알림 (새 알림 있음)` : '알림'}>
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M12 20.6C8.2 18.3 2.6 14.2 2.6 9.2A5.1 5.1 0 0 1 12 6.3a5.1 5.1 0 0 1 9.4 2.9c0 5-5.6 9.1-9.4 11.4z"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linejoin="round"
			/>
		</svg>
		{#if count}<span class="dot"></span>{/if}
	</button>
	<button class="ic settings" onclick={() => goto('/settings')} aria-label="설정">
		<!-- 톱니는 톱니 끝까지 22칸이라 하트(19칸)보다 커 보인다 — 한 치수 작게(viewBox 26) 그리고, 선 굵기는 1.8 로 보이게 -->
		<svg viewBox="-1 -1 26 26" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.95" />
			<path
				d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
				stroke="currentColor"
				stroke-width="1.95"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
</div>

<style>
	.actions {
		margin-left: auto;
		margin-right: -10px;
		display: flex;
		align-items: center;
	}
	/* 두 아이콘 — 같은 칸 · 같은 크기 (24px). 누름 칸은 44 씩 맞닿게 — 아이콘 사이 거리는 예전(40 + 4)과 같다 (G1) */
	.ic {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		transition: transform 0.2s cubic-bezier(0.3, 0.7, 0.3, 1.4);
	}
	.ic:active {
		transform: scale(0.88);
	}
	.ic svg {
		width: 24px;
		height: 24px;
	}
	.dot {
		position: absolute;
		top: 9px;
		right: 9px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--point-mark);
		border: 2px solid var(--bg);
		box-sizing: content-box;
		animation: dot-in 0.35s cubic-bezier(0.3, 0.7, 0.3, 1.6);
	}
	@keyframes dot-in {
		from {
			transform: scale(0);
		}
	}
</style>

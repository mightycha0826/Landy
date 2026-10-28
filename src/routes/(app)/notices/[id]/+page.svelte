<script lang="ts">
	/**
	 * 공지 한 개 — 알림(하트)에서 공지를 누르면 오는 화면. 제목 · 올린 시각 · 내용.
	 * 목록을 거치지 않고 바로 들어와도(새로고침 · 알림) 불러와서 보여 준다.
	 */
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { NOTICES, loadNotices, markNoticesSeen } from '$lib/notices.svelte';
	import { S } from '$lib/state.svelte';
	import { agoText } from '$lib/time';
	import BackButton from '$lib/ui/BackButton.svelte';

	const id = $derived(Number(page.params.id));
	const notice = $derived(NOTICES.list.find((n) => n.id === id));

	$effect(() => {
		if (!NOTICES.loaded) void loadNotices(true);
	});
	// 이 공지까지 본 것으로 — 알림(하트)에서 곧장 들어와도 빨간 점이 꺼진다 (Phase 39)
	$effect(() => {
		const n = notice?.id;
		if (n) untrack(() => void markNoticesSeen(n));
	});
</script>

<div class="topbar">
	<BackButton href="/activity" history />
	<span class="title">공지</span>
</div>

<div class="page notice">
	{#if notice}
		<article>
			<h1 class="selectable">{notice.title}</h1>
			<span class="muted when">{agoText(notice.created_at, S.now)}</span>
			{#if notice.body}<p class="body selectable">{notice.body}</p>{/if}
		</article>
	{:else if !NOTICES.loaded}
		<!-- 제목 · 시각 · 본문 자리 (알림을 눌러 곧바로 들어온 경우) -->
		<p class="sr-only">불러오는 중…</p>
		<div class="sk" aria-hidden="true">
			<i class="skeleton title"></i>
			<i class="skeleton when"></i>
			<div class="body">
				{#each [100, 94, 97, 60] as w (w)}<i class="skeleton" style:width="{w}%"></i>{/each}
			</div>
		</div>
	{:else}
		<p class="muted empty">공지를 찾을 수 없어요.</p>
	{/if}
</div>

<style>
	.notice {
		padding-top: 20px;
		padding-bottom: calc(24px + env(safe-area-inset-bottom));
	}
	article {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.when {
		font-size: 13px;
	}
	.body {
		margin: 14px 0 0;
		padding-top: 16px;
		border-top: 1px solid var(--line);
		font-size: 15px;
		line-height: 1.7;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.empty {
		margin: 48px 0;
		text-align: center;
	}
	.sk {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sk .title {
		width: 70%;
		height: 20px;
		margin: 4px 0;
	}
	.sk .when {
		width: 18%;
		height: 11px;
		margin: 4px 0;
	}
	.sk .body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 14px;
		padding-top: 20px;
		border-top: 1px solid var(--line);
	}
	.sk .body i {
		height: 13px;
	}
</style>

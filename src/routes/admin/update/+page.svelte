<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtTime } from '$lib/adminTypes';
	import { confirmed } from '$lib/admin/confirm';
	import FormMsg from '$lib/admin/FormMsg.svelte';

	let { data, form } = $props();
	// 실패하면 쓰던 글을 되살린다
	const draft = $derived((form ?? {}) as { title?: string; body?: string });
	const state = $derived(data.state);
	const pending = $derived('configured' in state && state.configured ? state.pending : []);

	const askRelease = confirmed(() => '대기 중인 새 버전을 지금 모든 학생 화면에 반영할까요?');
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">업데이트</h1>
		<p class="a-sub">
			푸시한 새 버전은 여기서 "업데이트"를 눌러야 학생 화면에 나옵니다. 함께 쓴 공지는 학생이 다음에 앱에 들어올 때 한 번 뜨고,
			그 사이 업데이트가 여러 번이면 밀린 공지를 한 창에 모아 보여 줍니다.
		</p>
	</div>
</header>

<FormMsg {form} />

{#if 'error' in state}
	<p class="a-err">Cloudflare 에서 버전 목록을 받지 못했어요 — {state.error}</p>
{:else if !state.configured}
	<p class="a-warn">Cloudflare 비밀값 CF_API_TOKEN · CF_ACCOUNT_ID 가 없어 버전을 볼 수 없어요. Workers 설정의 Variables and Secrets 에 넣어 주세요.</p>
{:else}
	<p class="now">지금 학생 화면: {#if state.current}<b class="num">#{state.current.number}</b> <span class="muted num">{fmtTime(state.current.created_on)}</span>{:else}<span class="muted">알 수 없음</span>{/if}</p>
	{#if pending.length === 0}
		<p class="a-empty">대기 중인 새 버전이 없어요. 푸시하면 빌드가 끝난 뒤 여기에 나타납니다.</p>
	{:else}
		<h2 class="a-h2">대기 중인 버전 <span class="muted">{pending.length}개 · 맨 위 버전이 반영됩니다</span></h2>
		<ul class="list">
			{#each pending as v, i (v.id)}
				<li class="a-card" class:top={i === 0}>
					<b class="num">#{v.number}</b>
					<span class="muted num">{fmtTime(v.created_on)}</span>
					{#if v.message}<span class="msg">{v.message}</span>{/if}
				</li>
			{/each}
		</ul>
		<form class="a-card post" method="POST" action="?/release" use:enhance={askRelease}>
			<input type="hidden" name="version" value={pending[0].id} />
			<input class="field" name="title" maxlength="80" placeholder="공지 제목 (비우면 '업데이트 소식')" value={draft.title ?? ''} />
			<textarea class="field" name="body" rows="5" maxlength="2000" placeholder="업데이트 공지 (선택 · 비우면 공지 없이 반영)">{draft.body ?? ''}</textarea>
			<button class="btn">업데이트</button>
		</form>
	{/if}
{/if}

<h2 class="a-h2">최근 업데이트 공지</h2>
{#if data.releases.length === 0}
	<p class="a-empty">아직 없어요.</p>
{:else}
	<ul class="list">
		{#each data.releases as n (n.id)}
			<li class="a-card">
				<b>{n.title}</b> <span class="muted num">{fmtTime(n.created_at)}</span>
				<p class="body">{n.body}</p>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.now {
		margin: 0 0 16px;
	}
	.post {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 720px;
		margin: 12px 0 24px;
	}
	.post textarea {
		height: auto;
		padding: 10px 12px;
		resize: vertical;
		line-height: 1.6;
	}
	.post .btn {
		align-self: flex-end;
		width: auto;
		padding: 0 20px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 720px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list .muted {
		margin-left: 6px;
		font-size: 12px;
	}
	.top {
		border-color: var(--accent);
	}
	.msg {
		display: block;
		margin-top: 4px;
		font-size: 14px;
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.body {
		margin: 8px 0 0;
		font-size: 14px;
		line-height: 1.6;
		color: var(--text-2);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>

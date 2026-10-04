<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtTime } from '$lib/adminTypes';
	import { confirmed } from '$lib/admin/confirm';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import { inquiryLabel } from '$lib/inquiry';

	let { data, form } = $props();
	// 실패하면 쓰던 답변을 되살린다
	const draft = $derived((form ?? {}) as { id?: number; answer?: string });
	const waiting = $derived(data.items.filter((x) => !x.answered_at));
	const answered = $derived(data.items.filter((x) => !!x.answered_at));

	const askAnswer = confirmed(() => '이 답변을 보낼까요? 학생에게 개인 공지로 가고, 보낸 뒤에는 고칠 수 없어요.');
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">문의 <span class="muted">답변 대기 {data.open}개</span></h1>
		<p class="a-sub">학생 앱 설정 › 운영진에게 문의하기 로 온 글입니다. 답변하면 그 학생에게 개인 공지로 가고(알림 · 공지), 활동 기록에 남습니다.</p>
	</div>
</header>

<FormMsg {form} />

<h2 class="a-h2">답변 대기 <span class="muted">{waiting.length}개</span></h2>
{#if waiting.length === 0}
	<p class="a-empty">기다리는 문의가 없어요.</p>
{:else}
	<ul class="list">
		{#each waiting as q (q.id)}
			<li class="a-card">
				<div class="row">
					<span class="kind">{inquiryLabel(q)}</span>
					<a class="who" href="/admin/users/{q.user_id}">{data.students[q.user_id] ?? '보낸 학생 보기'}</a>
					<span class="muted num">{fmtTime(q.created_at)}</span>
				</div>
				<p class="body">{q.body}</p>
				<form class="reply" method="POST" action="?/answer" use:enhance={askAnswer}>
					<input type="hidden" name="id" value={q.id} />
					<textarea class="field" name="answer" rows="3" maxlength="2000" placeholder="답변 (2000자까지)" required
						>{draft.id === q.id ? (draft.answer ?? '') : ''}</textarea
					>
					<button class="btn">답변 보내기</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<h2 class="a-h2">답변한 문의 <span class="muted">{answered.length}개</span></h2>
{#if answered.length === 0}
	<p class="a-empty">아직 없어요.</p>
{:else}
	<ul class="list">
		{#each answered as q (q.id)}
			<li class="a-card done">
				<div class="row">
					<span class="kind">{inquiryLabel(q)}</span>
					<a class="who" href="/admin/users/{q.user_id}">보낸 학생 보기</a>
					<span class="muted num">{fmtTime(q.created_at)}</span>
				</div>
				<p class="body">{q.body}</p>
				<p class="ans"><b>답변</b> <span class="muted num">{fmtTime(q.answered_at ?? '')}</span><br />{q.answer}</p>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 720px;
		margin: 0 0 24px;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.kind {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--field);
		font-weight: 700;
	}
	.who {
		font-weight: 600;
	}
	.row .num {
		margin-left: auto;
	}
	.body {
		margin: 10px 0 0;
		font-size: 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.reply {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
	}
	.reply textarea {
		height: auto;
		padding: 10px 12px;
		resize: vertical;
		line-height: 1.6;
	}
	.reply .btn {
		align-self: flex-end;
		width: auto;
		padding: 0 20px;
	}
	.done {
		opacity: 0.85;
	}
	.ans {
		margin: 10px 0 0;
		padding: 10px 12px;
		border-left: 3px solid var(--accent);
		background: var(--field);
		border-radius: 8px;
		font-size: 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>

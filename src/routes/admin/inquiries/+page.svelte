<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtTime } from '$lib/adminTypes';
	import { confirmed } from '$lib/admin/confirm';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import { inquiryLabel } from '$lib/inquiry';
	import { isDeletionInquiry } from '$lib/accountDeletion';
	import AccountDeleteForm from '$lib/admin/AccountDeleteForm.svelte';

	let { data, form } = $props();
	// 실패하면 쓰던 답변을 되살린다
	const draft = $derived((form ?? {}) as { id?: number; answer?: string });
	const waiting = $derived(data.items.filter((x) => !x.answered_at));
	const answered = $derived(data.items.filter((x) => !!x.answered_at));
	const deletionUsers = $derived(new Set(data.deletions.map((job) => job.user_id)));
	const failureLabels: Record<string, string> = { auth_lock: '로그인 제한', storage: '첨부 파일 삭제', auth: '인증 계정 삭제', record: '완료 기록' };

	const askAnswer = confirmed(() => '이 답변을 보낼까요? 학생에게 개인 공지로 가고, 보낸 뒤에는 고칠 수 없어요.');
</script>

<!-- 계정 삭제 요청 — 답변 전후 모두 처리한다 (삭제 뒤에는 학생이 답변을 볼 수 없어 안내를 먼저 보낼 수 있다) -->
{#snippet deletion(q: (typeof data.items)[number])}
	{#if isDeletionInquiry(q)}
		{#if data.canDelete && data.deletionReady && !deletionUsers.has(q.user_id)}
			<AccountDeleteForm id={q.id} user={q.user_id} label={data.students[q.user_id] ?? '요청한 학생'} />
		{:else if !data.canDelete}<p class="muted">계정 삭제 요청입니다. 실제 삭제는 관리자에게 전달해 주세요.</p>{/if}
	{/if}
{/snippet}

<header class="a-head">
	<div>
		<h1 class="a-h1">문의 <span class="muted">답변 대기 {data.open}개</span></h1>
		<p class="a-sub">학생 앱 설정에서 온 문의와 계정 삭제 요청입니다. 답변은 개인 공지로 가고, 관리자는 계정 삭제 요청에서 실제 삭제를 처리할 수 있습니다. <a href="/admin/inquiries">새로고침</a></p>
	</div>
</header>

<FormMsg {form} />

{#if data.canDelete && !data.deletionReady}
	<p class="a-card" role="alert">삭제 처리 내역을 불러오지 못해 삭제 실행을 잠시 막았어요. DB 업데이트와 연결을 확인한 뒤 새로고침해 주세요.</p>
{/if}

{#if data.canDelete && data.deletions.length > 0}
	<h2 class="a-h2">삭제 처리 내역 <span class="muted">최근 {data.deletions.length}개</span></h2>
	<ul class="list">
		{#each data.deletions as job (job.user_id)}
			<li class="a-card">
				<div class="row"><b>요청 #{job.inquiry_id}</b><span>{job.status === 'deleted' ? '계정 삭제 완료' : job.status === 'failed' ? '처리 실패 · 재시도 필요' : job.retryable ? '처리 확인 필요 · 재시도 가능' : '삭제 처리 중'}</span><span class="muted num">{fmtTime(job.updated_at)}</span></div>
				<p class="body">계정 ID: {job.user_id}<br />처리 사유: {job.note}</p>
				{#if job.status !== 'deleted'}<p class="muted">{job.failure_stage === 'record' ? '인증 계정 삭제 후 결과 확인이 필요해요.' : '남아 있는 계정의 이용을 제한했어요. 일부 정보가 삭제됐을 수 있습니다.'}{job.failure_stage ? ` 중단 단계: ${failureLabels[job.failure_stage] ?? '처리 확인 필요'}` : ''}</p>{/if}
				{#if job.retryable && data.deletionReady}<AccountDeleteForm id={job.inquiry_id} user={job.user_id} label={data.students[job.user_id] ?? job.user_id} retry />{/if}
			</li>
		{/each}
	</ul>
{/if}

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
				{@render deletion(q)}
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
				{@render deletion(q)}
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

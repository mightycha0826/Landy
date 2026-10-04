<script lang="ts">
	/**
	 * 운영진에게 문의하기 (Phase 37) — 종류를 고르고 글을 보낸다. 아래에는 내가 보낸 문의와 답변.
	 * 답변은 개인 공지로도 온다(하트 · 공지 · 푸시) — 이 화면은 열 때 한 번만 읽는다.
	 */
	import BackButton from '$lib/ui/BackButton.svelte';
	import { toast } from '$lib/toast.svelte';
	import { S } from '$lib/state.svelte';
	import { page } from '$app/state';
	import { agoText } from '$lib/time';
	import {
		INQUIRY_KINDS,
		INQUIRY_MAX,
		INQUIRY_MIN,
		SEND_ERROR,
		fetchMyInquiries,
		inquiryLabel,
		sendInquiry,
		type Inquiry,
		type InquiryKind
	} from '$lib/inquiry';

	// svelte-ignore state_referenced_locally
	let kind = $state<InquiryKind>(page.url.searchParams.get('kind') === 'account' ? 'account' : 'use');
	let body = $state('');
	let busy = $state(false);
	let error = $state('');
	let list = $state<Inquiry[]>([]);
	let loaded = $state(false);

	const len = $derived(body.trim().length);
	const canSend = $derived(len >= INQUIRY_MIN && len <= INQUIRY_MAX && !busy);

	$effect(() => {
		void fetchMyInquiries()
			.then((r) => (list = r))
			.catch(() => {})
			.finally(() => (loaded = true));
	});

	async function send() {
		if (!canSend) return;
		busy = true;
		error = '';
		try {
			const st = await sendInquiry(kind, body.trim());
			if (st !== 'ok') {
				error = SEND_ERROR[st];
				return;
			}
			body = '';
			toast('문의를 보냈어요. 답변은 알림으로 알려 드릴게요');
			list = await fetchMyInquiries().catch(() => list);
		} catch {
			error = '연결을 확인하고 다시 보내 주세요';
		} finally {
			busy = false;
		}
	}
</script>

<div class="topbar ios">
	<BackButton href="/settings" history />
	<span class="title">운영진에게 문의하기</span>
</div>

<div class="page grouped contact">
	<h2 class="g-head" id="kind-h">무엇에 관한 문의인가요?</h2>
	<div class="kinds" role="radiogroup" aria-labelledby="kind-h">
		{#each INQUIRY_KINDS as k (k.id)}
			<button class="chip" class:on={kind === k.id} role="radio" aria-checked={kind === k.id} onclick={() => (kind = k.id)}>{k.label}</button>
		{/each}
	</div>

	<div class="g-card write">
		<textarea
			bind:value={body}
			maxlength={INQUIRY_MAX}
			rows="6"
			placeholder="궁금한 점이나 불편한 점을 적어 주세요."
			aria-label="문의 내용"
			oninput={() => (error = '')}
		></textarea>
		<div class="foot">
			<span class="count" class:over={len > INQUIRY_MAX}>{len}/{INQUIRY_MAX}</span>
			<button aria-busy={busy} class="btn send" onclick={send} disabled={!canSend}>{busy ? '보내는 중…' : '보내기'}</button>
		</div>
	</div>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	<p class="g-foot">
		운영진이 읽고 답변을 드려요. 답변이 오면 알림(하트)과 공지에서 볼 수 있어요.
		지금 대화나 편지에서 불편한 일이 있다면, 그 화면의 메뉴에서 <b>신고하기</b>가 더 빨라요.
	</p>

	<h2 class="g-head">내 문의</h2>
	{#if !loaded}
		<p class="g-foot">불러오는 중…</p>
	{:else if list.length === 0}
		<p class="g-foot">아직 보낸 문의가 없어요.</p>
	{:else}
		<ul class="mine">
			{#each list as q (q.id)}
				<li class="g-card q">
					<div class="q-head">
						<span class="tag">{inquiryLabel(q)}</span>
						<span class="when">{agoText(q.created_at, S.now)}</span>
						<span class="st" class:done={!!q.answer}>{q.answer ? '답변 완료' : '답변 대기'}</span>
					</div>
					<p class="q-body selectable">{q.body}</p>
					{#if q.answer}
						<div class="answer">
							<span class="who">운영진 답변 · {agoText(q.answered_at ?? q.created_at, S.now)}</span>
							<p class="selectable">{q.answer}</p>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.contact {
		padding-bottom: calc(32px + env(safe-area-inset-bottom));
	}
	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 0 4px;
	}
	.chip::after {
		content: '';
		position: absolute;
		inset: -4px min(-4px, calc(50% - 22px));
	}
	.chip {
		position: relative;
		height: 36px;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--cell);
		box-shadow: var(--shadow-1);
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background 0.18s,
			color 0.18s,
			transform 0.18s;
	}
	.chip:active {
		transform: scale(0.96);
	}
	.chip.on {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.write {
		margin-top: 14px;
		padding: 14px 16px 12px;
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 140px;
		padding: 0;
		border: 0;
		outline: none;
		resize: vertical;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 16px;
		line-height: 1.6;
	}
	textarea::placeholder {
		color: var(--text-2);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
	}
	.count {
		font-size: 13px;
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.count.over {
		color: var(--danger);
	}
	.send {
		width: auto;
		height: 44px;
		padding: 0 20px;
		font-size: 15px;
	}
	.err {
		margin: 10px 16px 0;
		font-size: 14px;
		color: var(--danger);
	}
	.mine {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.mine .g-card + .g-card {
		margin-top: 0;
	}
	.q {
		padding: 14px 16px;
	}
	.q-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.tag {
		font-weight: 700;
	}
	.when {
		color: var(--text-2);
	}
	.st {
		margin-left: auto;
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--field);
		color: var(--text-2);
		font-size: 12px;
		font-weight: 700;
	}
	.st.done {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.q-body {
		margin: 8px 0 0;
		font-size: 15px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.answer {
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--field);
		border-left: 3px solid var(--accent);
	}
	.answer .who {
		font-size: 12px;
		font-weight: 700;
		color: var(--accent);
	}
	.answer p {
		margin: 4px 0 0;
		font-size: 15px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>

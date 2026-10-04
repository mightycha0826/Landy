<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import BackButton from '$lib/ui/BackButton.svelte';
	import { S, toast } from '$lib/state.svelte';
	import { agoText } from '$lib/time';
	import { fetchMyInquiries, sendInquiry, SEND_ERROR, type Inquiry } from '$lib/inquiry';
	import { DELETION_NOTE_MAX, deletionRequestBody, isDeletionInquiry } from '$lib/accountDeletion';
	let list = $state<Inquiry[]>([]);
	let loading = $state(true);
	let loaded = $state(false);
	let loadError = $state('');
	let sendError = $state('');
	let note = $state('');
	let acknowledged = $state(false);
	let busy = $state(false);
	let submitted = $state(false);
	let alive = true;
	let revision = 0;
	onDestroy(() => { alive = false; revision++; });
	const pending = $derived(list.some((q) => !q.answered_at));
	const canSend = $derived(loaded && !loadError && !loading && !busy && !submitted && !pending && acknowledged);
	async function load() {
		const current = ++revision;
		loading = true; loadError = '';
		try {
			const rows = await fetchMyInquiries();
			if (!alive || current !== revision) return;
			list = rows.filter(isDeletionInquiry); loaded = true;
		} catch { if (alive && current === revision) loadError = '요청 내역을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요'; }
		finally { if (alive && current === revision) loading = false; }
	}
	onMount(() => { void load(); });
	async function send() {
		if (!canSend) return;
		busy = true; sendError = '';
		try {
			const status = await sendInquiry('account', deletionRequestBody(note));
			if (!alive) return;
			if (status !== 'ok') { sendError = SEND_ERROR[status]; return; }
			submitted = true; note = ''; acknowledged = false;
			toast('계정 삭제 요청을 접수했어요. 운영진이 확인 후 답변해 드려요');
			await load();
		} catch { if (alive) sendError = '요청을 보내지 못했어요. 연결을 확인하고 다시 시도해 주세요'; }
		finally { if (alive) busy = false; }
	}
</script>

<div class="topbar ios"><BackButton href="/settings" history /><span class="title">계정 삭제 요청</span></div>
<div class="page grouped deletion">
	<h2 class="g-head">운영진에게 삭제를 요청해요</h2>
	<section class="g-card explanation">
		<p>요청을 보내면 운영진이 확인한 뒤 삭제 범위와 처리 결과를 답변해요. <b>접수만으로 계정이 삭제되지는 않아요.</b></p>
		<p>관리자가 처리하면 인증 계정·프로필·업적·문의·보낸 편지와 받은 편지·증빙 사진이 삭제되고 진행 중인 대화가 종료돼요. 대화 기록·신고 증거·학교 명렬표·운영 활동 및 삭제 처리 기록은 별도 보관되고, 백업·내보낸 파일은 별도 처리가 필요해요.</p>
		<p>삭제 후에는 앱에서 답변을 볼 수 없어요. 필요한 안내 방법과 처리 범위를 운영진에게 먼저 확인해 주세요.</p>
		<p>삭제 요청과 운영진 답변은 아래 내역에서 볼 수 있어요. 답변은 알림과 공지에서도 확인할 수 있어요.</p>
		<a class="u-tap" href="/legal/privacy">현재 보관 정책 보기</a>
	</section>
	{#if pending || submitted}
		<p class="g-foot" role="status">삭제 요청을 접수했어요. 아래에서 내역과 운영진 답변을 확인해 주세요. 답변 도착이 삭제 완료를 의미하지는 않아요.</p>
	{:else}
		<div class="g-card write">
			<label for="delete-note">추가로 전달할 내용 <span class="muted">(선택)</span></label>
			<textarea id="delete-note" bind:value={note} maxlength={DELETION_NOTE_MAX} rows="3" placeholder="이름·학번·비밀번호를 다시 적을 필요는 없어요." disabled={busy}></textarea>
			<label class="ack"><input type="checkbox" bind:checked={acknowledged} disabled={busy} /><span>운영진이 확인 후 처리하는 삭제 요청임을 이해했어요.</span></label>
			<button class="btn" disabled={!canSend} aria-busy={busy} onclick={send}>{busy ? '접수하는 중…' : '계정 삭제 요청 보내기'}</button>
		</div>
	{/if}
	{#if sendError}<p class="g-foot error" role="alert">{sendError}</p>{/if}
	<p class="g-foot">요청을 철회하거나 추가로 문의하려면 <a href="/settings/contact?kind=account">계정 문의 보내기</a>를 이용해 주세요.</p>
	<div class="history-head"><h2 class="g-head">내 삭제 요청</h2><button class="u-tap" onclick={() => void load()} disabled={loading || busy}>새로고침</button></div>
	{#if loading}<p class="g-foot" role="status">요청 내역을 불러오는 중…</p>
	{:else if loadError}<div class="g-card explanation" role="alert"><p>{loadError}</p><button class="btn-ghost" onclick={() => void load()}>다시 불러오기</button></div>
	{:else if list.length === 0}<p class="g-foot">{submitted ? '요청은 접수됐어요. 새로고침하면 내역을 다시 확인할 수 있어요.' : '아직 삭제 요청이 없어요.'}</p>
	{:else}
		<ul class="requests">{#each list as q (q.id)}<li class="g-card explanation"><div class="request-head"><b>계정 삭제 요청 #{q.id}</b><span>{q.answered_at ? '운영진 답변 도착' : '접수 · 답변 대기'}</span></div><small class="muted">{agoText(q.created_at, S.now)}</small><p class="selectable body">{q.body}</p>{#if q.answer}<div class="answer"><b>운영진 답변</b><p class="selectable body">{q.answer}</p></div>{/if}</li>{/each}</ul>
	{/if}
</div>

<style>
	.deletion { padding-bottom: calc(32px + env(safe-area-inset-bottom)); }
	.explanation, .write { padding: 16px; font-size: 14px; line-height: 1.7; }
	.explanation p { margin: 0 0 12px; }
	a { color: var(--accent); text-decoration: underline; }
	.explanation a { display: inline-flex; align-items: center; min-height: 44px; }
	.write label { font-weight: 600; }
	textarea { display: block; width: 100%; padding: 12px; margin: 10px 0; border: 0; border-radius: 12px; background: var(--field); color: var(--text); font: inherit; font-size: 16px; resize: vertical; }
	.ack { display: flex; align-items: center; gap: 12px; min-height: 44px; margin: 12px 0; font-size: 13px; }
	.ack input { width: 20px; height: 20px; flex: none; accent-color: var(--accent); }
	.history-head { display: flex; align-items: center; justify-content: space-between; }
	.history-head button { color: var(--accent); min-height: 44px; font-size: 13px; }
	.error { color: var(--danger); }
	.requests { display: grid; gap: 12px; padding: 0; margin: 0; list-style: none; }
	.requests .g-card { margin: 0; }
	.request-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-size: 13px; }
	.request-head span { color: var(--text-2); }
	.body { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 10px !important; }
	.answer { border-left: 3px solid var(--accent); padding: 12px; border-radius: 12px; background: var(--field); }
</style>

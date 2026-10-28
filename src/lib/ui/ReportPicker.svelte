<script lang="ts">
	/** 신고 시트 윗부분 — 사유 고르기 + 운영진에게 남길 말. 제출 버튼은 시트 쪽에 둔다. 사유 목록은 lib/reportReasons.ts 하나 */
	import type { ReportReason } from '$lib/chat/types';
	import { REPORT_REASONS } from '$lib/reportReasons';
	let {
		reason = $bindable(null),
		note = $bindable(''),
		title,
		intro
	}: { reason?: ReportReason | null; note?: string; title: string; intro: string } = $props();
</script>

<div class="report">
	<h3>{title}</h3>
	<p class="warn left">{intro}</p>
	<div class="reasons" role="group" aria-label="신고 사유">
		{#each REPORT_REASONS as r (r.v)}
			<button class="reason" class:on={reason === r.v} aria-pressed={reason === r.v} onclick={() => (reason = r.v)}>{r.label}</button>
		{/each}
	</div>
	<textarea class="note" bind:value={note} rows="2" maxlength="1000" aria-label="운영진에게 더 알려줄 내용 (선택)" placeholder="운영진에게 더 알려줄 내용 (선택)"></textarea>
</div>

<style>
	.report {
		padding: 8px var(--pad) 12px;
	}
	h3 {
		margin: 4px 0 8px;
		font-size: 16px;
		font-weight: 600;
	}
	.reasons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 10px;
	}
	.reason {
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 14px;
	}
	.reason.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
	}
	.note {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface);
		outline: none;
		resize: none;
		font-size: 16px; /* 16px 미만이면 아이폰이 확대한다 (Phase 41) */
	}
</style>

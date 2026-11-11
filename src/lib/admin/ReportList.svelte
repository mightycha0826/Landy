<script lang="ts">
	import { REASON_LABEL, REPORT_TABS, STATUS_LABEL, TARGET_LABEL, fmtTime, shortId, type ReportRow, type LetterReportRow } from '$lib/adminTypes';

	let { kind, reports, status }: ({ kind: 'chat'; reports: ReportRow[] } | { kind: 'letter'; reports: LetterReportRow[] }) & { status: string } = $props();
	const letter = $derived(kind === 'letter');
	/** 채팅 · 편지 신고는 테이블만 다르고 처리 절차가 같다 — 한 화면에서 종류를 바꿔 본다 (Phase 96) */
	const KINDS = [
		{ v: 'chat', label: '채팅' },
		{ v: 'letter', label: '편지' }
	] as const;
</script>

<div class="kinds" role="group" aria-label="신고 종류">
	{#each KINDS as k (k.v)}
		<a href="/admin/reports?kind={k.v}&status={status}" class:on={kind === k.v} aria-current={kind === k.v ? 'true' : undefined}>{k.label}</a>
	{/each}
</div>

<nav class="a-tabs" aria-label="신고 상태">
	{#each REPORT_TABS as tab (tab.v)}
		<a href="/admin/reports?kind={kind}&status={tab.v}" class:on={status === tab.v}>{tab.label}</a>
	{/each}
</nav>

{#if reports.length === 0}
	<p class="a-empty">{status === 'open' ? letter ? '처리할 편지 신고가 없어요.' : '처리할 신고가 없어요.' : '해당하는 신고가 없어요.'}</p>
{:else}
	<div class="a-scroll">
		<table class="a-table" class:letter>
			<thead>
				<tr>
					<th>접수</th>
					{#if letter}<th>대상</th>{/if}
					<th>사유</th>
					<th>{letter ? '신고한 글' : '신고 내용'}</th>
					{#if !letter}<th class="r">대화</th>{/if}
					<th>{letter ? '작성자' : '대상'}</th>
					<th class="r" title="최근 30일, 서로 다른 신고자 수">누적</th>
					<th>상태</th>
				</tr>
			</thead>
			<tbody>
				{#each reports as report (report.id)}
					<tr>
						<td class="num muted">{fmtTime(report.created_at)}</td>
						{#if letter}<td>{'target_type' in report ? TARGET_LABEL[report.target_type] ?? report.target_type : ''}</td>{/if}
						<td>
							<span class="a-reason">{REASON_LABEL[report.reason] ?? report.reason}</span>
							{#if report.source === 'auto'}<span class="pill auto" title="AI 자동 감지">자동</span>{/if}
						</td>
						<td class="clip"><a href="/admin/{letter ? 'letters' : 'reports'}/{report.id}">{letter ? ('preview' in report && report.preview) || '(내용 없음)' : report.note || '(메모 없음)'}</a></td>
						{#if !letter}<td class="r num muted">{'evidence_count' in report ? report.evidence_count : 0}</td>{/if}
						<td class="mono">
							{shortId(report.reported_id)}
							{#if report.reported_status && report.reported_status !== 'active'}<span class="pill red">{report.reported_status === 'banned' ? '영구정지' : '정지'}</span>{/if}
						</td>
						<td class="r num" class:danger={report.reported_30d >= 2}>{report.reported_30d}</td>
						<td><span class="st st-{report.status}">{STATUS_LABEL[report.status]}</span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	/* 종류 고르기 — 눌린 쪽이 채워진 두 칸 단추 */
	.kinds {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		margin-bottom: 6px;
		border-radius: 10px;
		background: var(--field);
	}
	.kinds a {
		padding: 6px 16px;
		border-radius: 8px;
		color: var(--text-2);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
	}
	.kinds a.on {
		background: var(--bg);
		color: var(--text);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
	}
	@media (max-width: 720px) {
		th:nth-child(6), td:nth-child(6),
		table:not(.letter) th:nth-child(4), table:not(.letter) td:nth-child(4),
		table.letter th:nth-child(5), table.letter td:nth-child(5) { display: none; }
	}
</style>

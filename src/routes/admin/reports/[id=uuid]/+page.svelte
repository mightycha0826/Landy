<script lang="ts">
	import { can } from '$lib/adminRoles';
	import { REASON_LABEL, fmtClock } from '$lib/adminTypes';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import IdentityCard from '$lib/admin/IdentityCard.svelte';
	import ReportHeader from '$lib/admin/ReportHeader.svelte';
	import ReportedCard from '$lib/admin/ReportedCard.svelte';
	import ReporterCard from '$lib/admin/ReporterCard.svelte';
	import AutoReportCard from '$lib/admin/AutoReportCard.svelte';
	import SanctionForm from '$lib/admin/SanctionForm.svelte';

	let { data, form } = $props();
	const d = $derived(data.d);
	const r = $derived(d.report);
	const admin = $derived(can(data.staff, 'identity')); // 학생 신원 권한 (Phase 51 표)
	/** AI 자동 감지 — 신고자가 없고, 사본의 1 은 '상대' */
	const auto = $derived(r.source === 'auto');
</script>

<ReportHeader back={{ href: '/admin/reports', label: '신고 목록' }} title={REASON_LABEL[r.reason] ?? r.reason} report={r} />
<FormMsg {form} />

<div class="a-grid">
	<section class="a-col">
		<div>
			<h2 class="a-h2">대화 사본 <span class="muted">{d.evidence.length}개</span></h2>
			{#if r.note}<p class="rnote selectable"><b>{auto ? 'AI 판정' : '신고자 메모'}</b> {r.note}</p>{/if}
			<div class="msgs">
				{#each d.evidence as m (m.ord)}
					{#if m.sender === 0}
						<div class="sys">{m.body}</div>
					{:else}
						<div class="m" class:by-reported={m.sender === 2}>
							<span class="who">{m.sender === 2 ? '피신고자' : auto ? '상대' : '신고자'}</span>
							<span class="body">{m.body}</span>
							<span class="t num">{fmtClock(m.sent_at)}</span>
						</div>
					{/if}
				{:else}
					<p class="muted empty">저장된 대화가 없어요 (방이 매칭 직후 신고됨).</p>
				{/each}
			</div>
		</div>
	</section>

	<aside class="a-aside">
		<ReportedCard
			title="피신고자"
			reported={d.reported}
			history={d.history}
			historyLabel="다른 신고"
			historyHref="/admin/reports"
		/>
		{#if auto}
			<AutoReportCard />
		{:else}
			<ReporterCard filed={d.reporter_filed} dismissed={d.reporter_dismissed} />
		{/if}

		<section class="a-card">
			<h2 class="a-h2">조치</h2>
			<SanctionForm
				isAdmin={data.staff?.role === 'admin'}
				banned={d.reported?.status === 'banned'}
				targets={auto
					? [{ v: 'reported', label: '피신고자' }]
					: [
							{ v: 'reported', label: '피신고자' },
							{ v: 'reporter', label: '신고자' }
						]}
			/>
		</section>

		<section class="a-card">
			{#if admin}<h2 class="a-h2">관리자 열람</h2>{/if}
			<div class="a-links">
				{#if admin}<a href="/admin/rooms/{r.room_id}">이 대화 전체 보기 →</a>{/if}
				<a href="/admin/users/{r.reported_id}">피신고자 계정 →</a>
				{#if r.reporter_id}<a href="/admin/users/{r.reporter_id}">신고자 계정 →</a>{/if}
			</div>
			{#if admin}<p class="a-hint">대화 열람은 활동 기록에 남습니다. 대화는 끝나고 24시간 뒤 지워집니다.</p>{/if}
		</section>

		{#if admin}<IdentityCard {form} reportedLabel="피신고자" />{/if}
	</aside>
</div>

<style>
	.rnote {
		margin: 0 0 10px;
		padding: 10px 12px;
		background: var(--surface);
		border-radius: var(--r-sm);
		font-size: 13px;
		line-height: 1.6;
	}
	.msgs {
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
	}
	.m {
		display: grid;
		grid-template-columns: 64px 1fr auto;
		gap: 10px;
		padding: 9px 12px;
		border-top: 1px solid var(--line);
		font-size: 14px;
		line-height: 1.5;
	}
	.m:first-child,
	.sys:first-child {
		border-top: 0;
	}
	.m .who {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		padding-top: 1px;
	}
	.m.by-reported {
		background: color-mix(in srgb, var(--danger) 6%, transparent);
	}
	.m.by-reported .who {
		color: var(--danger);
	}
	.m .body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.m .t {
		font-size: 12px;
		color: var(--text-2);
	}
	.sys {
		padding: 8px 12px;
		font-size: 12px;
		color: var(--text-2);
		text-align: center;
		border-top: 1px solid var(--line);
	}
	.empty {
		margin: 0;
		padding: 16px;
		font-size: 13px;
	}
</style>

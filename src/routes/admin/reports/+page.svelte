<script lang="ts">
	import ReportList from '$lib/admin/ReportList.svelte';

	let { data } = $props();
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">신고</h1>
		<p class="a-sub">학생이 낸 신고와 AI 자동 감지. 목록에는 신원 정보가 없고, 처리한 내용은 활동 기록에 남습니다.</p>
	</div>
</header>

{#if data.kind === 'letter'}
	<ReportList kind="letter" reports={data.reports} status={data.status} />
{:else}
	<ReportList kind="chat" reports={data.reports} status={data.status} />
{/if}

<script lang="ts">
	let { mode = 'overview', expanded = false }: { mode?: 'overview' | 'chat' | 'letter'; expanded?: boolean } = $props();
</script>

<details class="privacy-summary" open={expanded}>
	<summary>{mode === 'chat' ? '이 대화에서 상대에게 보이는 정보' : mode === 'letter' ? '편지에서 상대에게 보이는 정보' : '내 정보는 누구에게 보이나요?'}</summary>
	<div class="privacy-body">
		{#if mode !== 'letter'}
			<p><b>채팅 상대</b>에게는 익명 이름·소개·관심사·MBTI와 공개하도록 설정한 뱃지가 보여요. 실명·학번은 채팅에 표시하지 않아요.</p>
			<p>둘 다 연장에 동의하면 학년·질문 답·디플로마·동아리가 단계별로 공개돼요. 공개할 항목은 동의 전에 확인할 수 있어요.</p>
		{/if}
		{#if mode !== 'chat'}
			<p><b>편지 수신자</b>에게는 익명 발신자의 성별·선택한 서명·본문이 보여요. 받은 익명편지에 답장하면 답장자의 이름이 상대에게 보여요.</p>
			<p>편지 받기를 켜면 이름·학년·학번이 받는 사람 검색에 나와요. 설정에서 받기와 추천 노출을 조절할 수 있어요.</p>
		{/if}
		<p><b>신원 열람 권한이 있는 운영자</b>는 안전을 위해 신원과 내용을 볼 수 있고, 열람은 기록돼요.</p>
		<p>글투·뱃지·공개한 정보로 상대가 나를 짐작할 수도 있어요. 실명·연락처는 글에 적지 마세요.</p>
		<a href="/legal/privacy">개인정보 처리방침 보기</a>
	</div>
</details>

<style>
	.privacy-summary { width: 100%; text-align: left; border-radius: 14px; background: var(--field); color: var(--text); }
	summary { min-height: 44px; padding: 12px 14px; cursor: pointer; font-size: 13px; font-weight: 700; }
	.privacy-body { padding: 0 14px 14px; font-size: 13px; line-height: 1.65; }
	p { margin: 0 0 8px; overflow-wrap: anywhere; }
	a { display: inline-flex; align-items: center; min-height: 44px; color: var(--accent); text-decoration: underline; }
</style>

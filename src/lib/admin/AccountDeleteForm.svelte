<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { confirmed } from './confirm';
	let { id, user, label, retry = false }: { id: number; user: string; label: string; retry?: boolean } = $props();
	const confirmDelete = confirmed(() => `요청 #${id} · ${label}\n이 계정을 영구 삭제할까요? 보낸 편지와 받은 편지도 삭제됩니다. 되돌릴 수 없어요.`);
	const submit: SubmitFunction = async (input) => {
		const complete = await confirmDelete(input);
		if (typeof complete !== 'function') return;
		return async (result) => {
			await complete(result);
			// 실패 응답에도 DB의 제한·중단 기록은 남는다. 재조회해 현재 상태와 재시도를 보여준다.
			if (result.result.type === 'failure') await invalidateAll();
		};
	};
</script>

<details class="delete-account">
	<summary>{retry ? '계정 삭제 처리 다시 시도' : '요청한 계정 삭제'}</summary>
	<p>대상: <b>{label}</b> · 요청 #{id}<br /><span class="muted">계정 ID: {user}</span></p>
	<p>인증 계정·프로필·업적·문의·보낸 편지와 받은 편지·증빙 사진을 삭제하고 진행 중인 대화를 종료합니다. 대화 기록·신고 증거·활동 기록·학교 명렬표는 기존 보관 정책에 따라 남으며, 백업과 이미 내보낸 파일은 별도 처리해야 합니다.</p>
	<p>삭제 후 이 학생은 앱에서 결과를 확인할 수 없어요. 먼저 요청자와 처리 범위를 확인하고, 안내가 필요하면 이 문의에 답변을 보낸 뒤 삭제해 주세요(답변한 요청도 삭제할 수 있어요). 실패해도 일부 정보는 삭제됐을 수 있으며, 계정은 이용 제한 상태로 유지됩니다.</p>
	<form method="POST" action="?/deleteAccount" use:enhance={submit}>
		<input type="hidden" name="id" value={id} /><input type="hidden" name="user" value={user} />
		<label for="delete-note-{id}">처리 사유 · 요청 확인 내용 (5~1000자)</label>
		<textarea class="field" id="delete-note-{id}" name="note" minlength="5" maxlength="1000" rows="2" required></textarea>
		<label for="delete-confirm-{id}">확인 문구: <b>삭제 {id}</b></label>
		<input class="field" id="delete-confirm-{id}" name="confirmation" placeholder="삭제 {id}" autocomplete="off" required />
		<label class="ack"><input type="checkbox" name="acknowledged" value="yes" required /> 요청자와 삭제 범위를 확인했으며 되돌릴 수 없음을 이해합니다.</label>
		<button class="btn delete-button">{retry ? '삭제 처리 다시 시도' : '계정 영구 삭제'}</button>
	</form>
</details>

<style>
	.delete-account { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 12px; font-size: 13px; line-height: 1.65; }
	summary { color: var(--danger); cursor: pointer; font-weight: 700; min-height: 44px; padding: 10px 0; }
	p { overflow-wrap: anywhere; }
	form { display: grid; gap: 8px; }
	textarea { height: auto; padding: 10px; }
	.ack { display: flex; gap: 10px; align-items: center; min-height: 44px; }
	.ack input { width: 18px; height: 18px; flex: none; }
	button { justify-self: start; }
	.delete-button { background: var(--danger); color: #fff; box-shadow: none; }
</style>

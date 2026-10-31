<script lang="ts">
	/**
	 * 못 불러왔을 때 (UX G4) — 이유 한 줄 + 다시 시도. 네트워크 오류를 "없음"이나 끝없는 "불러오는 중"으로 두지 않는다.
	 * 편지함 · 폴더 · 알림 · 공지 · 문의 · 편지 · 받는 사람 찾기 · 뱃지 제출이 같은 모양으로 쓴다.
	 */
	let { msg, onretry, label = '다시 시도', busy = false }: { msg: string; onretry: () => void; label?: string; busy?: boolean } = $props();
</script>

<div class="load-err" role="alert">
	<p class="muted">{msg}</p>
	<button class="btn-text" onclick={onretry} disabled={busy} aria-busy={busy}>{label}</button>
</div>

<style>
	.load-err {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		margin: 16px auto;
		text-align: center;
	}
	p {
		margin: 0;
		font-size: 14px;
		line-height: 1.55;
	}
</style>

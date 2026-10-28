<script lang="ts">
	import Sheet from '$lib/ui/Sheet.svelte';

	let { count, busy, ondelete, onclose }: { count: number; busy: boolean; ondelete: () => void; onclose: () => void } = $props();
</script>

<Sheet {onclose} label="편지 삭제">
	<p class="ask">편지 {count}통을 삭제할까요?</p>
	<p class="warn">내 편지함에서만 지워지고 상대에게는 그대로 남아요. 삭제한 편지는 되돌릴 수 없어요.</p>
	<button class="item danger" onclick={ondelete} disabled={busy} aria-busy={busy}>삭제</button>
	<button class="item" onclick={onclose}>취소</button>
</Sheet>

<style>
	.ask {
		margin: 4px 0 10px;
		font-size: 17px;
		font-weight: 650;
		text-align: center;
	}
</style>

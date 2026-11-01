<script lang="ts">
	/** MSMP 우수 은뱃지 (Phase 91) — 금뱃지(MsmpGold)와 같은 모양, 색만 은 */
	import MsmpGold from './MsmpGold.svelte';
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
</script>

<MsmpGold silver {shine} {delay} />

<script lang="ts">
	/**
	 * 창의위원 뱃지 (Phase 91) — 품격위원(Pumgyeok)과 같은 판, 글자만 "創意".
	 * 획마다 [길, 굵기] — 創 은 倉(人 · 一 · 戶 · 口) + 刂, 意 는 立 + 日 + 心
	 */
	import Pumgyeok from './Pumgyeok.svelte';
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const STROKES: [string, number][] = [
		['M16.5 27V57.5M32 27V37.5M21 41.5V55.5M32 41.5V55.5M38 17V44M43.5 13V57.5M63.5 31V45M80.5 31V45', 3.1],
		['M19.5 21.5H30.5M16.5 27.8H32M16.5 36.8H32M21 42.3H32M21 54.7H32M61.5 18.6H81.5M58.5 27.4H85M63.5 31.8H80.5M63.5 38H80.5M63.5 44.2H80.5', 2.1],
		['M25 12.5L11.5 25.5M25 12.5L34 21M64.5 47.5V54Q64.5 57 68 57H79Q81.5 57 82 54', 2.7],
		['M71 12.8L72.6 16.8M65.5 21L67.8 25.5M77.5 20.8L75.4 25.5M57.5 49L60 54.5M71.5 47.5L73.8 51.5M84.5 48L87.5 53.5', 2.5]
	];
</script>

<Pumgyeok strokes={STROKES} {shine} {delay} />

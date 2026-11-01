<script lang="ts">
	/**
	 * 자율위원 뱃지 (Phase 91) — 품격위원(Pumgyeok)과 같은 판, 글자만 "自律".
	 * 획마다 [길, 굵기] — 自 는 丿 + 目(세로 둘 · 가로 넷), 律 은 彳(삐침 둘 · 세로) + 聿(가로 다섯 · 가운데 세로 · 오른쪽 짧은 세로)
	 */
	import Pumgyeok from './Pumgyeok.svelte';
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const STROKES: [string, number][] = [
		['M17.5 19V57.5M40 19V57.5M57.5 31V57.5M76.5 13V58M85 17.8V31.4', 3.3],
		['M17.5 20.2H40M17.5 32.6H40M17.5 44.8H40M17.5 56.4H40M67 17.8H85M63.5 24.6H90M67 31.4H85M66 40.2H87.5M63 48.6H90.5', 2.1],
		['M30 12.5L26.5 18.5M61 14L53.5 23.5M61.5 25.5L52.5 37', 2.7]
	];
</script>

<Pumgyeok strokes={STROKES} {shine} {delay} />

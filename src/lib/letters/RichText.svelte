<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toLines, type LetterFmt } from './rich';

	/** 서식 있는 편지 본문. HTML 을 넣지 않는다 — 글자는 텍스트로, 모양은 rich.ts 표에서만. */
	let { body, fmt, after }: { body: string; fmt?: LetterFmt | null; after?: Snippet } = $props();
	const lines = $derived(toLines(body, fmt));
</script>

<div class="rt">
	{#each lines as line, i (i)}
		<div class="rt-line" style:text-align={line.align === 'left' ? null : line.align}>
			{#each line.runs as r, j (j)}{#if r.cls || r.style}<span class={r.cls} style={r.style}>{r.text}</span
					>{:else}{r.text}{/if}{/each}{#if i === lines.length - 1 && after}{@render after()}{/if}{#if line.runs.length === 0 && !(i === lines.length - 1 && after)}<br
				/>{/if}
		</div>
	{/each}
</div>

<style>
	.rt {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.rt :global(.rt-b) {
		font-weight: 600;
	}
	.rt :global(.rt-i) {
		font-style: italic;
	}
</style>

<script lang="ts">
import type { LegalDoc } from '$lib/legal';
let { doc }: { doc: LegalDoc | null | undefined } = $props();
</script>
<div class="page legal">
	{#if doc}
		<article class="selectable">
			<h1>{doc.title}</h1>
			<p class="muted updated">시행일 {doc.updated}</p>
			{#if doc.intro}<p class="intro">{doc.intro}</p>{/if}
			{#each doc.sections as sec (sec.h)}
				<section>
					<h2>{sec.h}</h2>
					{#each sec.body as b, i (i)}
						{#if typeof b === 'string'}
							<p>{b}</p>
						{:else}
							<ul>
								{#each b.li as item, j (j)}<li>{item}</li>{/each}
							</ul>
						{/if}
					{/each}
				</section>
			{/each}
		</article>
	{:else}
		<p class="muted empty">없는 문서예요.</p>
	{/if}
</div>
<style>
	.legal {
		padding-top: 20px;
		padding-bottom: calc(32px + env(safe-area-inset-bottom));
	}
	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
	}
	.updated {
		margin: 4px 0 0;
		font-size: 13px;
	}
	.intro {
		margin: 16px 0 0;
		padding: 14px 16px;
		border-radius: 12px;
		background: var(--field);
		font-size: 14px;
		line-height: 1.7;
	}
	section {
		margin-top: 24px;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 16px;
		font-weight: 600;
	}
	p,
	li {
		font-size: 14px;
		line-height: 1.75;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	section p {
		margin: 0 0 8px;
	}
	ul {
		margin: 0 0 8px;
		padding-left: 18px;
	}
	li + li {
		margin-top: 4px;
	}
	.empty {
		margin: 48px 0;
		text-align: center;
	}
</style>

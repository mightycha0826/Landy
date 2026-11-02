<script lang="ts">
	/**
	 * 업데이트 소식 (Phase 94) — 관리자가 업데이트하며 남긴 공지를, 학생이 앱에 들어왔을 때 한 번 보여 준다.
	 * 마지막으로 본 뒤 업데이트가 여러 번 있었으면 밀린 공지를 이 한 창에 모아(오래된 것부터) 보여 준다.
	 * 공지 목록은 위쪽 하트(TopbarMe)가 이미 불러 둔 것을 쓴다 — 따로 묻지 않는다. 사용법 안내 · 업적 축하가 있으면 그 뒤에.
	 */
	import { page } from '$app/state';
	import Sheet from './Sheet.svelte';
	import { UI } from '$lib/state.svelte';
	import { touring } from '$lib/tour.svelte';
	import { markUpdatesSeen, unseenUpdates } from '$lib/notices.svelte';

	const items = $derived(unseenUpdates());
	const onRoot = $derived(['/', '/letters', '/me'].includes(page.url.pathname));
	const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

	const close = () => void markUpdatesSeen(items.at(-1)!.id).catch(() => {});
</script>

{#if items.length && onRoot && !UI.celebrating && !touring()}
	<Sheet label="업데이트 소식" onclose={close} auto>
		<div class="notes">
			<h2>{items.length > 1 ? `그동안 ${items.length}번 업데이트됐어요` : items[0].title}</h2>
			{#each items as n (n.id)}
				<section>
					{#if items.length > 1}<h3>{n.title} <span class="muted num">{day(n.created_at)}</span></h3>{/if}
					<p>{n.body}</p>
				</section>
			{/each}
			<button class="btn" onclick={close}>확인</button>
		</div>
	</Sheet>
{/if}

<style>
	.notes {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 4px var(--pad) 8px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
	}
	h3 {
		margin: 0 0 4px;
		font-size: 15px;
	}
	h3 .muted {
		margin-left: 4px;
		font-size: 12px;
		font-weight: 400;
	}
	p {
		margin: 0;
		color: var(--text-2);
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	section + section {
		padding-top: 14px;
		border-top: 1px solid var(--line);
	}
</style>

<script lang="ts">
	/**
	 * 폴더에 넣기 (Phase 47) — 보관함 · 폴더 화면에서 편지를 여러 통 고른 뒤.
	 * 있는 폴더를 누르거나, 새 폴더 이름을 적어 만들고 넣는다 (같은 이름이 있으면 그 폴더로).
	 * 넣은 뒤의 처리(목록 고치기 · 알림)는 부르는 쪽이 — ondone(폴더 이름, 물어볼 사람들)
	 *   물어볼 사람들 = 이번에 넣어서 받은 편지가 모두 이 폴더에 들어간 사람 (FolderRule 이 "앞으로도 넣을까요?"를 묻는다)
	 */
	import Sheet from '$lib/ui/Sheet.svelte';
	import { onDestroy } from 'svelte';
	import { FOLDER_MAX, folderError, fromLabel, putInFolder, type Folder, type FolderAsk } from './api';
	import { errMsg, toast } from '$lib/state.svelte';
	// 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 ({#key S.accountVersion}) — 떠 있는지만 보면 된다
	let alive = true;
	onDestroy(() => (alive = false));
	const current = () => alive;

	let {
		ids,
		folders,
		exclude = null,
		onclose,
		ondone
	}: {
		ids: number[];
		folders: Folder[];
		/** 지금 보고 있는 폴더 — 옮길 곳 목록에서 뺀다 */
		exclude?: number | null;
		onclose: () => void;
		ondone: (name: string, asks: FolderAsk[]) => void;
	} = $props();

	let name = $state('');
	let busy = $state(false);
	const list = $derived(folders.filter((f) => f.id !== exclude));
	const clean = $derived(name.trim().replace(/\s+/g, ' '));

	async function put(to: { folder: number } | { name: string }) {
		if (busy || !current()) return;
		busy = true;
		try {
			const r = await putInFolder(ids, to);
			if (!current()) return;
			const err = folderError(r);
			if (err) return toast(err);
			const f = r.status === 'ok' ? r.folder : undefined;
			ondone(f?.name ?? '', f && r.status === 'ok' ? (r.offer ?? []).map((o) => ({ thread: o.thread_id, folder: f.id, who: fromLabel(o) })) : []);
		} catch (e) {
			if (current()) toast(errMsg(e));
		} finally {
			busy = false;
		}
	}
</script>

<Sheet {onclose} label="폴더에 넣기">
	<p class="ask">폴더에 넣기 <span class="muted num">편지 {ids.length}통</span></p>
	{#if list.length}
		<ul class="folders" aria-label="내 폴더">
			{#each list as f (f.id)}
				<li>
					<button class="item row" onclick={() => put({ folder: f.id })} disabled={busy}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
						<span class="name">{f.name}</span>
						<span class="muted num">{f.count}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<form
		class="new"
		onsubmit={(e) => {
			e.preventDefault();
			if (clean) void put({ name: clean });
		}}
	>
		<input
			class="field"
			bind:value={name}
			maxlength={FOLDER_MAX}
			placeholder="새 폴더 이름"
			aria-label="새 폴더 이름"
			autocomplete="off"
			enterkeyhint="done"
		/>
		<button class="make" type="submit" disabled={!clean || busy} aria-busy={busy}>만들고 넣기</button>
	</form>
	<button class="item cancel" onclick={onclose}>취소</button>
</Sheet>

<style>
	.ask {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 8px;
		margin: 4px 0 10px;
		font-size: 17px;
		font-weight: 800;
	}
	.ask .muted {
		font-size: 13px;
		font-weight: 600;
	}
	.folders {
		max-height: min(40dvh, 320px);
		margin: 0 0 8px;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		text-align: left;
	}
	.row svg {
		flex: none;
		width: 22px;
		height: 22px;
		color: var(--accent);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* 시트는 좌우 여백이 없다(.item 이 끝에서 끝까지) — 입력 줄만 안쪽으로 */
	.new {
		display: flex;
		gap: 8px;
		margin: 4px var(--pad) 10px;
	}
	.new .field {
		flex: 1;
		min-width: 0;
		font-size: 16px; /* 아이폰이 입력칸에 들어갈 때 화면을 키우지 않게 (G6.8) */
	}
	.make {
		flex: none;
		height: 48px;
		padding: 0 16px;
		border-radius: 14px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		font-size: 15px;
		font-weight: 800;
	}
	.make:disabled {
		background: var(--field);
		color: var(--text-2);
	}
</style>

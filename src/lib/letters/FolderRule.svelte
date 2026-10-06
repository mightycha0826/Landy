<script lang="ts">
	/**
	 * 폴더 자동 넣기 묻기 (2026-10-06) — 한 사람에게서 받은 편지를 모두 한 폴더에 넣은 뒤 아래에서 올라온다.
	 * 그러겠다고 하면 그 사람에게서 온 편지는 봉투를 열어 볼 때 그 폴더로 들어간다 (dm_folder_rule · dm_open).
	 * 그 사람의 편지를 폴더에서 빼거나 다른 폴더로 옮기면 꺼진다.
	 */
	import Sheet from '$lib/ui/Sheet.svelte';
	import { onDestroy } from 'svelte';
	import { folderError, setFolderRule, type FolderAsk } from './api';
	import { errMsg, toast } from '$lib/state.svelte';
	// 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 — 떠 있는지만 보면 된다
	let alive = true;
	onDestroy(() => (alive = false));

	let { ask, onclose }: { ask: FolderAsk; onclose: () => void } = $props();
	let busy = $state(false);

	async function yes() {
		if (busy) return;
		busy = true;
		try {
			const err = folderError(await setFolderRule(ask.thread, ask.folder));
			if (!alive) return;
			toast(err ?? `앞으로 '${ask.who}'님의 편지는 열어 보면 이 폴더로 들어가요`);
			onclose();
		} catch (e) {
			if (alive) toast(errMsg(e));
		} finally {
			busy = false;
		}
	}
</script>

<Sheet {onclose} label="폴더 자동 넣기">
	<p class="ask">앞으로 '{ask.who}'님의 모든 편지를 이 폴더 안에 넣을까요?</p>
	<button class="item" onclick={yes} disabled={busy} aria-busy={busy}>네, 넣을게요</button>
	<button class="item cancel" onclick={onclose}>아니요</button>
</Sheet>

<style>
	.ask {
		margin: 4px var(--pad) 10px;
		font-size: 17px;
		font-weight: 800;
		line-height: 1.45;
		text-align: center;
		word-break: keep-all;
	}
</style>

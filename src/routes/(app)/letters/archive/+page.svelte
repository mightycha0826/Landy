<script lang="ts">
	/**
	 * 편지 보관함 (Phase 35 · 37) — 편지함 아래 서류 더미를 누르면. 지금까지 받은 편지 · 보낸 편지.
	 * 편지함처럼 큰 봉투가 한 장씩 비스듬히 놓여 있다 (Phase 37 — 예전엔 작은 봉투 한 줄씩).
	 *   받은 편지 = 덮개 쪽(보낸 사람 성별 색 테두리 · 안 연 편지는 봉인) / 보낸 편지 = 주소 쪽(To. · 우표 · 소인 · 읽음/답장 옴 스티커).
	 * 누르면 그 편지를 연다. 길게 누르면(마우스는 오른쪽 클릭) 봉투 메뉴 — 열기 · 답장 · 버리기 · 차단 · 신고 (LetterMenu).
	 * 폴더 (Phase 47): 위 "선택"으로 여러 통을 골라 폴더에 넣는다 (FolderPicker). 폴더는 탭 아래 서랍 줄 — 누르면 그 폴더(/letters/f/[id]).
	 *   폴더에 넣은 편지는 받은/보낸 편지 목록에서 빠진다. 받은 편지는 봉투를 열어 본 것만 선택할 수 있다.
	 *   서랍의 폴더 카드는 받은 · 보낸 편지가 섞였으면 "받은 2 · 보낸 3" (Phase 47-3).
	 *   선택 중에는 안드로이드 뒤로가기가 선택을 끝낸다 (backClose).
	 * 삭제 (Phase 69): 선택한 편지를 확인 시트를 거쳐 지운다 — 내 편지함에서만 (상대의 편지 · 편지 줄기는 그대로, 되돌릴 수 없다).
	 */
	import BackButton from '$lib/ui/BackButton.svelte';
	import { untrack } from 'svelte';
	import MailStack from '$lib/letters/MailStack.svelte';
	import FolderPicker from '$lib/letters/FolderPicker.svelte';
	import FolderRule from '$lib/letters/FolderRule.svelte';
	import type { FolderAsk } from '$lib/letters/api';
	import SelectBar from '$lib/letters/SelectBar.svelte';
	import DeleteLettersSheet from '$lib/letters/DeleteLettersSheet.svelte';
	import { MailSelection } from '$lib/letters/selection.svelte';
	import { BOX, filed, loadMore, refreshMailbox, retryBox } from '$lib/letters/mailbox.svelte';
	import { LIST } from '$lib/letters/unread.svelte';
	import { toast } from '$lib/state.svelte';

	$effect(() => untrack(refreshMailbox));

	const selection = new MailSelection(filed);
	// 한 사람의 받은 편지를 모두 한 폴더에 넣었으면 — 앞으로도 그 폴더에 넣을지 묻는다 (한 사람씩)
	let asks = $state<FolderAsk[]>([]);
	const done = (name: string, ask: FolderAsk[]) => selection.complete((ids) => {
		filed(ids);
		// 묻는 시트가 뜨면 알림은 생략 — 알림이 시트의 단추를 가린다
		if (!ask.length) toast(name ? `'${name}' 폴더에 ${ids.length}통을 넣었어요` : '폴더에 넣었어요');
		asks = ask;
	});

	const tab = $derived(LIST.tab);
	const list = $derived(BOX[tab]);
</script>

<div class="topbar">
	<BackButton href="/letters" history />
	<span class="title">{selection.active ? '편지 선택' : '편지 보관함'}</span>
	{#if selection.active}
		<button class="btn-text push" onclick={() => selection.stop()}>취소</button>
	{:else if BOX.received.length || BOX.sent.length}
		<button class="btn-text push" onclick={() => selection.start()}>선택</button>
	{/if}
</div>

<div class="page archive" class:selecting={selection.active}>
	<div class="seg" role="tablist" aria-label="보관함">
		<button role="tab" class:on={tab === 'received'} aria-selected={tab === 'received'} onclick={() => (LIST.tab = 'received')}>받은 편지</button>
		<button role="tab" class:on={tab === 'sent'} aria-selected={tab === 'sent'} onclick={() => (LIST.tab = 'sent')}>보낸 편지</button>
		<span class="thumb" class:right={tab === 'sent'} aria-hidden="true"></span>
	</div>

	{#if BOX.folders.length && !selection.active}
		<!-- 폴더 서랍 — 옆으로 밀어서 본다 -->
		<ul class="folders" aria-label="내 폴더">
			{#each BOX.folders as f (f.id)}
				{@const both = !!f.received && !!f.sent}
				<!-- 받은 · 보낸 편지가 섞였으면 둘을 나눠 센다 (Phase 47-3) -->
				<li>
					<a class="folder" href="/letters/f/{f.id}" aria-label="{f.name} 폴더 — 편지 {f.count}통{both ? ` (받은 편지 ${f.received} · 보낸 편지 ${f.sent})` : ''}">
						<span class="tabpiece" aria-hidden="true"></span>
						<span class="fname">{f.name}</span>
						<span class="fcount num">{both ? `받은 ${f.received} · 보낸 ${f.sent}` : `${f.count}통`}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if BOX.error[tab]}
		<div class="center" role="status">
			<p class="muted">{BOX.error[tab]}</p>
			<button class="btn-text" onclick={() => retryBox(tab)}>다시 시도</button>
		</div>
	{/if}
	{#if BOX.loaded[tab] && !BOX.loading[tab] && list.length === 0 && !BOX.error[tab]}
		<p class="muted center">
			{#if BOX.folders.length}폴더에 넣지 않은 {tab === 'received' ? '받은' : '보낸'} 편지가 없어요
			{:else}{tab === 'received' ? '아직 받은 편지가 없어요' : '아직 보낸 편지가 없어요'}{/if}
		</p>
	{:else}
		<!-- 탭을 바꾸면 봉투가 다시 한 통씩 내려앉는다 -->
		{#key tab}
			<MailStack items={list} box={tab} loading={(!BOX.loaded[tab] || BOX.loading[tab]) && list.length === 0} ghosts={2} selecting={selection.active} picked={selection.picked} ontoggle={(item) => selection.toggle(item, tab)} />
		{/key}
		{#if BOX.more[tab]}<button class="more" onclick={() => loadMore(tab)} disabled={BOX.busy[tab] || BOX.loading[tab]}>{BOX.busy[tab] ? '가져오는 중…' : '지난 편지 더 보기'}</button>{/if}
	{/if}
</div>

{#if selection.active}
	<SelectBar count={selection.picked.length}>
		<button class="danger" onclick={() => (selection.dialog = 'delete')} disabled={!selection.picked.length}>삭제</button>
		<button class="go" onclick={() => (selection.dialog = 'folder')} disabled={!selection.picked.length}>폴더에 넣기</button>
	</SelectBar>
{/if}
{#if selection.dialog === 'folder'}
	<FolderPicker ids={selection.picked} folders={BOX.folders} onclose={() => (selection.dialog = null)} ondone={done} />
{/if}
{#if asks[0]}
	{#key asks[0].thread}<FolderRule ask={asks[0]} onclose={() => (asks = asks.slice(1))} />{/key}
{/if}
{#if selection.dialog === 'delete'}
	<DeleteLettersSheet count={selection.picked.length} busy={selection.deleting} ondelete={() => selection.remove()} onclose={() => (selection.dialog = null)} />
{/if}

<style>
	.archive {
		gap: 16px;
		padding-top: 12px;
		padding-bottom: calc(40px + env(safe-area-inset-bottom));
		background: var(--desk);
	}
	/* 고르는 중 — 아래 막대(SelectBar)에 마지막 봉투가 가리지 않게 */
	.archive.selecting {
		padding-bottom: calc(110px + env(safe-area-inset-bottom));
	}
	.push {
		margin-left: auto;
		margin-right: -6px;
	}

	/* ── 폴더 서랍 — 마닐라 폴더 모양 카드가 옆으로 늘어선다 ── */
	.folders {
		display: flex;
		gap: 10px;
		margin: 0 calc(var(--pad) * -1);
		padding: 10px var(--pad) 4px;
		overflow-x: auto;
		scroll-snap-type: x proximity;
		scrollbar-width: none;
		list-style: none;
	}
	.folders::-webkit-scrollbar {
		display: none;
	}
	.folders li {
		flex: none;
		scroll-snap-align: start;
	}
	.folder {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 2px;
		width: 124px;
		height: 82px;
		padding: 10px 12px;
		border-radius: 4px 12px 12px 12px;
		background: linear-gradient(180deg, #f1d49a, #e4bf78);
		color: #4a3317;
		text-decoration: none;
		box-shadow: 0 1px 0 rgb(255 255 255 / 0.5) inset, 0 6px 14px -6px rgb(70 40 10 / 0.45);
		transition: transform 0.15s;
	}
	.folder:active {
		transform: scale(0.96);
	}
	/* 폴더 귀퉁이 탭 */
	.tabpiece {
		position: absolute;
		top: -8px;
		left: 0;
		width: 52px;
		height: 12px;
		border-radius: 6px 8px 0 0;
		background: #f1d49a;
	}
	.fname {
		overflow: hidden;
		font-size: 14px;
		font-weight: 800;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.fcount {
		font-size: 12px;
		font-weight: 600;
		opacity: 0.7;
	}
	/* 두 칸 분할 버튼 — 고른 쪽 아래로 흰 알약이 미끄러진다 */
	.seg {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 4px;
		border-radius: 999px;
		background: var(--field);
	}
	/* 보이는 칸은 38, 누름은 둘레 여백까지 44 (G1) */
	.seg button::after {
		content: '';
		position: absolute;
		inset: -4px 0;
	}
	.seg button:active {
		opacity: 0.6;
	}
	.seg button {
		position: relative;
		z-index: 1;
		height: 38px;
		border-radius: 999px;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-2);
		transition: color 0.25s;
	}
	.seg button.on {
		color: var(--text);
	}
	.thumb {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 4px);
		border-radius: 999px;
		background: var(--bg);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.1);
		transition: transform 0.35s cubic-bezier(0.3, 0.8, 0.25, 1.05);
	}
	.thumb.right {
		transform: translateX(100%);
	}
	.center {
		margin: 40px 0;
		text-align: center;
	}
	.more:active:not(:disabled) {
		transform: scale(0.96);
	}
	.more {
		align-self: center;
		height: 38px;
		margin-top: 6px;
		padding: 0 16px;
		border-radius: 999px;
		background: var(--field);
		font-size: 13px;
		font-weight: 700;
	}
</style>

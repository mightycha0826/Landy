<script lang="ts">
	/**
	 * 봉투 메뉴 (Phase 40 — 편지함 · 보관함에서 봉투를 길게 누르기(마우스는 오른쪽 클릭) · 편지 화면의 ⋯ 가 같이 쓴다).
	 * 채팅 시절의 "나가기"는 없다 — 편지함에 맞는 말로:
	 *   봉투에서 연 메뉴(item 있음): 편지 열기 · 답장 쓰기(읽은 받은 편지) — 그다음 줄에 편지 버리기 · 차단하기 · 신고하기
	 *   편지 화면의 ⋯ (item 없음): 편지 버리기 · 차단하기 · 신고하기 (열기 · 답장은 화면에 이미 있다)
	 * 버리기 · 차단 · 신고는 편지 한 통이 아니라 그 사람과 주고받은 편지 전체에 한다 (서버의 편지 줄기 = dm_close · dm_block · dm_report).
	 * 셋 다 하고 나면 그 사람과의 편지가 내 편지함에서 사라진다 → ondone.
	 * recipient = 내가 이름으로 받은 쪽(모르는 사람이 나를 찾아 보냄) — 버리면 그 사람은 다시 못 보낸다.
	 */
	import Sheet from '$lib/ui/Sheet.svelte';
	import { onDestroy } from 'svelte';
	import ReportPicker from '$lib/ui/ReportPicker.svelte';
	import type { ReportReason } from '$lib/chat/types';
	import { navigateFromOverlay } from '$lib/overlay.svelte';
	import { errMsg, toast } from '$lib/state.svelte';
	import { blockThread, closeThread, josa, reportThread, stampDate, type Box, type MailItem } from './api';
	import { BOX } from './mailbox.svelte';
	// 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 ({#key S.accountVersion}) — 떠 있는지만 보면 된다
	let alive = true;
	onDestroy(() => (alive = false));
	const current = () => alive;

	let {
		thread,
		title = '',
		item,
		box,
		onclose,
		ondone
	}: {
		thread: { id: number; recipient: boolean };
		/** 상대 — 받은 편지면 From., 보낸 편지면 To. */
		title?: string;
		/** 봉투에서 열었으면 그 편지 (열기 · 답장 쓰기를 보여 준다) */
		item?: MailItem;
		box?: Box;
		onclose: () => void;
		ondone: () => void;
	} = $props();

	let step = $state<'menu' | 'discard' | 'block' | 'report'>('menu');
	let reason = $state<ReportReason | null>(null);
	let note = $state('');
	let acting = $state(false);

	const received = $derived(box === 'received');
	// 편지함이 기억해 둔 것 중 이 사람과 주고받은 편지 수 (모르면 0 — 숫자 없이 말한다)
	const count = $derived(BOX.received.filter((x) => x.thread_id === thread.id).length + BOX.sent.filter((x) => x.thread_id === thread.id).length);
	const canReply = $derived(!!item && received && item.opened && !item.removed && item.thread_status === 'open');
	const kind = $derived(item?.is_reply ? '답장' : '편지');
	const who = $derived(title || '이 사람');

	async function act(fn: () => Promise<unknown>, done: string) {
		if (acting || !current()) return;
		acting = true;
		try {
			await fn();
			if (!current()) return;
			toast(done);
			ondone();
		} catch (e) {
			if (current()) toast(errMsg(e));
		} finally {
			acting = false;
		}
	}
	// 시트의 뒤로가기 칸을 닫으면서 이동 (G5.2)
	const go = (url: string) => void navigateFromOverlay(url);
</script>

<Sheet {onclose} label={title ? `${title} 편지 메뉴` : '편지 메뉴'}>
	{#if step === 'menu'}
		{#if item}
			<p class="who">
				<strong>{title}</strong>
				<span class="muted num">{received ? `${stampDate(item.created_at)}에 온 ${kind}` : `${stampDate(item.created_at)}에 보낸 ${kind}`}</span>
			</p>
			<button class="item row" onclick={() => go(`/letters/m/${item.id}`)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5L12 4l8.5 5.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z M3.5 9.5L12 15l8.5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
				{received && !item.opened ? '봉투 열기' : '편지 읽기'}
			</button>
			{#if canReply}
				<button class="item row" onclick={() => go(`/letters/m/${item.id}/reply`)}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
					편지로 답장 쓰기
				</button>
			{/if}
			<i class="gap" aria-hidden="true"></i>
		{:else if title}
			<p class="who"><strong>{title}</strong><span class="muted">주고받은 편지 전체</span></p>
		{/if}
		<button class="item row" onclick={() => (step = 'discard')}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6.5 7l1 12.5h9L17.5 7M10.2 10.5v6M13.8 10.5v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
			편지 버리기
		</button>
		<button class="item row danger" onclick={() => (step = 'block')}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M6.5 17.5l11-11" stroke="currentColor" stroke-width="1.8" /></svg>
			차단하기
		</button>
		<button class="item row danger" onclick={() => (step = 'report')}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4.5M6 5h11l-2.2 4L17 13H6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
			신고하기
		</button>
		<button class="item cancel" onclick={onclose}>취소</button>
	{:else if step === 'discard'}
		<p class="ask">편지를 버릴까요?</p>
		<p class="warn">
			{josa(who, '과', '와')} 주고받은 편지{count ? ` ${count}통` : ''}이 편지함과 보관함에서 모두 사라지고, 더는 서로 답장할 수 없어요.
			{#if thread.recipient}<br /><strong>{josa(who, '은', '는')} 앞으로 나에게 편지를 보낼 수 없어요.</strong>{/if}
		</p>
		<button class="item danger" onclick={() => act(() => closeThread(thread.id), '편지를 버렸어요')} disabled={acting} aria-busy={acting}>버리기</button>
		<button class="item" onclick={() => (step = 'menu')}>돌아가기</button>
	{:else if step === 'block'}
		<p class="ask">{josa(who, '을', '를')} 차단할까요?</p>
		<p class="warn">서로 편지 · 채팅이 안 되고, 주고받은 편지도 편지함에서 사라져요.</p>
		<button class="item danger" onclick={() => act(() => blockThread(thread.id), '차단했어요')} disabled={acting} aria-busy={acting}>차단하기</button>
		<button class="item" onclick={() => (step = 'menu')}>돌아가기</button>
	{:else}
		<ReportPicker
			bind:reason
			bind:note
			title="무엇이 문제인가요?"
			intro="신고하면 자동으로 차단돼요."
		/>
		<button
			class="item danger"
			onclick={() =>
				act(async () => {
					const r = await reportThread(thread.id, reason!, note.trim());
					if (r.status === 'already') throw new Error('이미 신고한 편지예요');
				}, '신고했어요')}
			disabled={!reason || acting}
			aria-busy={acting}
		>
			{acting ? '신고하는 중…' : '신고하기'}
		</button>
		<button class="item" onclick={() => (step = 'menu')}>돌아가기</button>
	{/if}
</Sheet>

<style>
	.who {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		margin: 4px var(--pad) 12px;
		text-align: center;
	}
	.who strong {
		font-family: var(--hand);
		font-size: 24px;
		font-weight: 400;
		line-height: 1.1;
	}
	.who span {
		font-size: 12.5px;
	}
	/* 아이콘 + 글자 — 왼쪽 정렬 (시트의 한 줄 버튼 모양은 그대로) */
	.row {
		display: flex !important;
		align-items: center;
		gap: 14px;
		padding: 0 calc(var(--pad) + 4px);
		text-align: left;
	}
	.row svg {
		flex: none;
		width: 22px;
		height: 22px;
		opacity: 0.85;
	}
	/* 여는 일과 버리는 일 사이 — 굵은 구분 (G1.4) */
	.gap {
		display: block;
		height: 8px;
		background: var(--field);
	}
	.gap + :global(.item) {
		border-top: 0;
	}
	.cancel {
		margin-top: 4px;
		color: var(--text-2);
	}
	.ask {
		margin: 6px var(--pad) 0;
		text-align: center;
		font-size: 17px;
		font-weight: 650;
	}
</style>

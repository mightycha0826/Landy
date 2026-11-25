<script lang="ts">
	/**
	 * 연장 · 고정 투표 띠 (마감 직전, 그리고 시간이 다 된 뒤의 "연장할까요?" 화면).
	 *   연장 차례: "10분 더 얘기할까요?" — 연장하면 공개할 것을 하나 고른다 (Phase 103): 학년 · 디플로마 · 동아리 · 랜덤 질문.
	 *     랜덤 질문을 고르면 슬롯이 돌아 이번 질문에 멈추고(둘이 고르면 같은 질문), 답을 적는다.
	 *   고정 차례(공개를 다섯 번 한 다음, Phase 29): "이 채팅을 고정하시겠습니까?"
	 * 표를 던지는 일 · 고른 것 · 적은 값 확인은 ChatView(vote) 가 한다.
	 */
	import Banner from './Banner.svelte';
	import SlotReel, { QUESTION_POOL } from './SlotReel.svelte';
	import { isDiploma, searchDiplomas } from './diplomas';
	import type { HintKind, RoomSnap } from './types';

	let {
		snap,
		pinNext,
		voting,
		hintDraft = $bindable(''),
		pick = $bindable(null),
		onvote
	}: {
		snap: RoomSnap;
		pinNext: boolean;
		voting: boolean;
		hintDraft?: string;
		/** 고른 공개 */
		pick?: HintKind | null;
		onvote: (agree: boolean) => void;
	} = $props();

	const options = $derived(pinNext ? [] : (snap.next_options ?? []));
	const chosen = $derived(options.find((o) => o.kind === pick) ?? null);
	const asking = $derived(snap.my_vote !== true);
	const view = $derived.by(() => {
		if (snap.my_vote === true)
			return { title: '상대의 대답을 기다리는 중', sub: pinNext ? '둘 다 원해야 고정돼요' : `둘 다 원해야 ${snap.extend_minutes}분 이어져요`, want: false };
		const want = snap.partner_vote === true;
		if (pinNext)
			return { title: '이 채팅을 고정하시겠습니까?', sub: want ? '상대가 고정을 원해요' : '둘 다 고정하면 맨 위에 남고 사라지지 않아요', want };
		const sub = want ? '상대가 연장을 원해요' : options.length ? '연장하면 공개할 것을 하나 골라요' : '둘 다 원해야 이어져요';
		return { title: `${snap.extend_minutes}분 더 얘기할까요?`, sub, want };
	});
	const disclosure = $derived(
		!chosen ? null : chosen.kind === 'grade' ? (chosen.value ?? null) : chosen.kind === 'question' ? (hintDraft.trim() ? `"${hintDraft.trim()}"` : null) : hintDraft.trim() || null
	);

	function choose(k: HintKind) {
		if (pick === k) return;
		pick = k;
		hintDraft = '';
		dq = '';
	}

	// 디플로마 검색 칸 (Phase 35) — 고른 값만 hintDraft 로 (목록에 없는 글은 보낼 수 없다)
	let dq = $state('');
	const matches = $derived(searchDiplomas(dq));
	const picked = $derived(isDiploma(dq));
	// 슬롯 — 질문 목록을 섞어 굴리다 이번 질문에 멈춘다
	const decoys = $derived([...QUESTION_POOL].sort(() => Math.random() - 0.5));
</script>

<Banner title={view.title} sub={view.sub} want={view.want}>
	{#if asking && options.length}
		<div class="picks" role="radiogroup" aria-label="연장하면 공개할 것">
			{#each options as o (o.kind)}
				<button role="radio" aria-checked={pick === o.kind} class:on={pick === o.kind} onclick={() => choose(o.kind)}>
					{o.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if asking && chosen?.kind === 'question' && chosen.question}
		<SlotReel items={decoys} final={chosen.question} label="이번 질문 " />
		<input class="hint-in" bind:value={hintDraft} maxlength="30" placeholder="내 답" aria-label={`랜덤 질문 ${chosen.question} — 내 답`} />
	{:else if asking && chosen?.kind === 'diploma'}
		<!-- 디플로마 — 학교 목록에서만: 적으면 맞는 것이 아래에 뜨고, 눌러서 고른다 (Phase 35) -->
		<div class="dip">
			<input
				class="hint-in"
				bind:value={dq}
				oninput={() => (hintDraft = isDiploma(dq) ? dq.trim() : '')}
				placeholder="디플로마 검색 (예: 물리, ㅅㅎ)"
				aria-label="내 디플로마 검색"
				role="combobox"
				aria-expanded={dq.trim() !== '' && !picked}
				aria-controls="dip-list"
				aria-autocomplete="list"
				autocomplete="off"
			/>
			{#if picked}<span class="ok" aria-hidden="true">✓</span>{/if}
			{#if dq.trim() && !picked}
				<ul id="dip-list" role="listbox" aria-label="디플로마">
					{#each matches as d (d)}
						<li>
							<button
								role="option"
								aria-selected="false"
								onclick={() => {
									dq = d;
									hintDraft = d;
								}}>{d}</button
							>
						</li>
					{:else}
						<li class="none">학교 디플로마에 없어요 · 다르게 적어 보세요</li>
					{/each}
				</ul>
			{/if}
		</div>
	{:else if asking && chosen?.kind === 'club'}
		<input class="hint-in" bind:value={hintDraft} maxlength="20" placeholder="내 동아리" aria-label="내 동아리" />
	{/if}
	{#if asking && chosen}
		<p class="disclosure"><b>둘 다 동의하면 공개:</b> {chosen.kind === 'question' ? '질문 답' : chosen.label}{disclosure ? ` · ${disclosure}` : ''}<br /><span>공개한 정보로 나를 짐작할 수 있어요. 원하지 않으면 그만해도 괜찮아요.</span></p>
	{/if}
	{#snippet actions()}
		{#if asking}
			<button class="no" onclick={() => onvote(false)} disabled={voting}>그만하기</button>
			<button class="yes" onclick={() => onvote(true)} disabled={voting}>{pinNext ? '고정하기' : '더 얘기하기'}</button>
		{/if}
	{/snippet}
</Banner>

<style>
	/* 고르는 칸 — 띠 아래 한 줄에 나란히 (좁은 폰에서도 한 줄) */
	.picks {
		order: 3;
		flex-basis: 100%;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 6px;
	}
	.picks button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 4px;
		border-radius: 14px;
		border: 1.5px solid transparent;
		background: var(--field);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
	}
	.picks button.on {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		color: var(--accent);
	}
	.disclosure { order: 3; flex-basis: 100%; margin: 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
	.disclosure span { color: var(--text-2); }
	/* 디플로마 · 동아리 · 질문 답 적는 칸 — 띠 아래 한 줄 전체 */
	.hint-in {
		order: 3;
		flex-basis: 100%;
		width: 100%;
		padding: 10px 14px;
		border: 1.5px solid transparent;
		border-radius: 12px;
		background: var(--field);
		color: var(--text);
		font-size: 16px; /* 16px 미만이면 아이폰이 확대한다 (Phase 41) */
		outline: none;
	}
	.hint-in:focus {
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
		background: var(--bg);
	}
	/* 디플로마 검색 — 칸 아래로 맞는 것만 */
	.dip {
		position: relative;
		order: 3;
		flex-basis: 100%;
	}
	.dip .hint-in {
		padding-right: 36px;
	}
	.ok {
		position: absolute;
		right: 14px;
		top: 10px;
		color: var(--accent);
		font-weight: 650;
	}
	.dip ul {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		animation: drop 0.2s ease-out;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.dip li button {
		height: 34px;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--field);
		font-size: 14px;
		font-weight: 600;
	}
	.dip li button:active {
		background: color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.dip .none {
		font-size: 12px;
		color: var(--text-2);
	}
</style>

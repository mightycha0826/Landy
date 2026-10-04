<script lang="ts">
	/**
	 * 새 편지 (Phase 32) — 1) 받을 학생을 이름으로 찾고 → 2) 봉투를 열어 편지지에 쓰고 → 봉투에 담아 보낸다 (EnvelopeCompose).
	 * 받는 사람에게 나는 "익명의 ○학생"(성별만) 또는 내가 적은 서명으로만 보인다 (Phase 35). 받기를 끈 사람 · 차단한 사이는 검색에 나오지 않는다.
	 * 찾기 결과에는 학년 · 학번 — 같은 학년 동명이인을 구분한다. 대표 뱃지도 (Phase 84 — 순서는 그 사람이 정한 대로).
	 * 아직 찾지 않았으면 아래에 추천 5명 (Phase 84 — 들어올 때 한 번, "다른 추천"을 누르면 다시. 추천에 안 나오기는 설정 › 편지).
	 */
	import { onDestroy, onMount } from 'svelte';
	import BackButton from '$lib/ui/BackButton.svelte';
	import PrivacySummary from '$lib/ui/PrivacySummary.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import { reloadApp } from '$lib/reload';
	import type { LetterFmt } from '$lib/letters/rich';
	import { anonName, recommendPeople, searchPeople, sendLetter, type DmPerson } from '$lib/letters/api';
	import { afterSent, deliver } from '$lib/letters/send';
	import { S, errMsg, toast } from '$lib/state.svelte';
	// 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 ({#key S.accountVersion}) — 떠 있는지만 보면 된다
	let alive = true;
	onDestroy(() => (alive = false));
	const current = () => alive;

	let q = $state('');
	let results = $state<DmPerson[] | null>(null);
	let searching = $state(false);
	let to = $state<DmPerson | null>(null);

	$effect(() => {
		const term = q.trim();
		if (term.length < 2) {
			results = null;
			return;
		}
		searching = true;
		let active = true;
		const t = setTimeout(async () => {
			try {
				const r = await searchPeople(term);
				if (active && current() && q.trim() === term) results = r;
			} catch (e) {
				if (active && current()) toast(errMsg(e));
			} finally {
				if (active && current()) searching = false;
			}
		}, 250);
		return () => { active = false; clearTimeout(t); };
	});

	// 추천 5명 — 들어올 때 한 번 (주기 요청 없음)
	let recs = $state<DmPerson[] | null>(null);
	let recBusy = $state(false);
	async function loadRecs() {
		if (recBusy || !current()) return;
		recBusy = true;
		try {
			const r = await recommendPeople();
			if (current()) recs = r ?? [];
		} catch {
			if (current()) recs = [];
		} finally {
			if (current()) recBusy = false;
		}
	}
	// 처음 한 번만 — effect 로 부르면 recBusy 를 읽어 바뀔 때마다 다시 돌아 요청이 끝없이 나간다
	onMount(() => void loadRecs());

	// 폰 키보드 내리기 — 찾기 칸이 화면에서 사라져도 키보드는 저절로 내려가지 않는다(아이폰). 고르거나 "검색"을 누르면 직접 내린다
	const hideKeyboard = () => (document.activeElement as HTMLElement | null)?.blur?.();
	function pick(p: DmPerson) {
		hideKeyboard();
		to = p;
	}

	const send = (body: string, fmt: LetterFmt | null, nick: string | null) => (current() && to ? deliver(() => sendLetter(to!.id, body, fmt, nick)) : Promise.resolve(false));
</script>

<div class="topbar">
	{#if to}
		<BackButton onclick={() => (to = null)} label="받는 사람 다시 고르기" />
	{:else}
		<BackButton href="/letters" history />
	{/if}
	<span class="title">{to ? '편지 쓰기' : '누구에게 보낼까요?'}</span>
</div>

{#if to}
	{#await import('$lib/letters/EnvelopeCompose.svelte')}
		<p class="page muted" role="status">편지지를 준비하고 있어요…</p>
	{:then { default: EnvelopeCompose }}
		<EnvelopeCompose
			draftKey={`letter:new:${to.id}`}
			to={to.name}
			toSub={to.grade ? `${to.grade}학년` : ''}
			from={anonName(S.profile?.gender)}
			nickable
			placeholder={`${to.name}님에게 하고 싶은 말을 적어 보세요.`}
			onsend={send}
			ondone={() => { if (current()) afterSent('편지를 보냈어요'); }}
		/>
	{:catch}
		<div class="page" role="alert">
			<p>편지지를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.</p>
			<button class="btn" onclick={() => void reloadApp()}>다시 불러오기</button>
		</div>
	{/await}
{:else}
	<div class="page pick">
		<PrivacySummary mode="letter" />
		<label class="search">
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
				<path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
			</svg>
			<input
				type="search"
				bind:value={q}
				placeholder="받을 학생 이름"
				aria-label="편지 받을 학생 찾기"
				autocomplete="off"
				enterkeyhint="search"
				onkeydown={(e) => e.key === 'Enter' && !e.isComposing && hideKeyboard()}
			/>
		</label>

		{#if results === null}
			<p class="prompt muted">이름을 두 글자 이상 적어 주세요</p>
			<!-- 추천 5명 (Phase 84) -->
			{#if recs === null}
				<p class="sr-only">추천을 불러오는 중…</p>
				<div class="rec-sk" aria-hidden="true">{#each [0, 1, 2] as i (i)}<i class="skeleton"></i>{/each}</div>
			{:else if recs.length}
				<section class="recs" aria-labelledby="rec-h">
					<div class="rec-head">
						<h2 id="rec-h">이 친구에게 써 볼까요?</h2>
						<button class="again u-tap" onclick={loadRecs} disabled={recBusy}>다른 추천</button>
					</div>
					<ul class="people">
						{#each recs as p (p.id)}
							<li>{@render row(p)}</li>
						{/each}
					</ul>
				</section>
			{/if}
		{:else if results.length === 0}
			<p class="muted center">{searching ? '찾는 중…' : '찾는 사람이 없어요'}</p>
		{:else}
			<ul class="people">
				{#each results as p (p.id)}
					<li>{@render row(p)}</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

{#snippet row(p: DmPerson)}
	<button class="person" onclick={() => pick(p)}>
		<Avatar name={p.name} size={44} />
		<span class="who">
			<b>{p.name}</b>
			<small class="muted">{[p.grade ? `${p.grade}학년` : '', p.no ? `학번 ${p.no}` : '', p.checked ? '' : '직접 적은 이름'].filter(Boolean).join(' · ')}</small>
			{#if p.badges?.length}
				<span class="badges" aria-label="대표 뱃지 {p.badges.map((b) => b.title).join(', ')}">
					{#each p.badges as b (b.code)}<Badge code={b.code} icon={b.icon} tier={b.tier} title={b.title} size={22} />{/each}
				</span>
			{/if}
		</span>
		<span class="go">편지 쓰기</span>
	</button>
{/snippet}

<style>
	.pick {
		gap: 10px;
		padding-top: 12px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 46px;
		padding: 0 14px;
		border-radius: 14px;
		background: var(--field);
		color: var(--text-2);
	}
	.search svg {
		flex: none;
		width: 18px;
		height: 18px;
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: none;
		color: var(--text);
		font-size: 16px;
	}
	.prompt {
		margin: 4px 2px 0;
		font-size: 13px;
	}
	.recs {
		margin-top: 10px;
	}
	.rec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.rec-head h2 {
		margin: 0;
		font-size: 15px;
	}
	.again {
		min-height: 44px;
		padding: 0 4px;
		font-size: 13px;
		font-weight: 700;
		color: var(--accent);
	}
	.rec-sk {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 46px;
	}
	.rec-sk i {
		height: 56px;
		border-radius: 16px;
	}
	.badges {
		display: flex;
		gap: 3px;
		margin-top: 4px;
	}
	.center {
		margin: 32px 0;
		text-align: center;
		font-size: 14px;
	}
	.people {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.person:active {
		background: var(--field);
	}
	.person {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 2px;
		text-align: left;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.who b {
		font-size: 15px;
		font-weight: 600;
	}
	.who small {
		font-size: 12px;
	}
	.go {
		flex: none;
		padding: 8px 14px;
		border-radius: 999px;
		background: var(--accent-fill-deep);
		color: var(--on-accent);
		font-size: 13px;
		font-weight: 700;
	}
</style>

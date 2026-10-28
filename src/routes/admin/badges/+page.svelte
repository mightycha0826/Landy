<script lang="ts">
	/**
	 * 뱃지 (Phase 71) — 운영진이 주는 뱃지를 고르고, 여러 학생에게 한 번에 주고 거둔다.
	 *   왼쪽: 분류(특별 · CNSA)별 뱃지 목록 · 가진 사람 수
	 *   오른쪽: 고른 뱃지 — 주기(학생 찾아 고르기 · 학번 목록(관리자) · 모두에게) · 가진 학생(골라서 거두기)
	 */
	import { enhance } from '$app/forms';
	import { can } from '$lib/adminRoles';
	import { CATEGORIES } from '$lib/achievements';
	import { fmtTime } from '$lib/adminTypes';
	import { confirmed } from '$lib/admin/confirm';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import Sid from '$lib/admin/Sid.svelte';
	import Badge from '$lib/ui/Badge.svelte';

	let { data, form } = $props();
	const admin = $derived(can(data.staff, 'identity')); // 학번으로 주기 · (학번 이름) 표시

	const sel = $derived(data.badges.find((b) => b.code === data.code));
	const groups = $derived(
		CATEGORIES.filter((c) => c.k !== 'all')
			.map((c) => ({ label: c.label, items: data.badges.filter((b) => b.category === c.k) }))
			.filter((g) => g.items.length)
	);
	const held = $derived(new Set(data.holders.map((h) => h.id)));

	type Tab = 'find' | 'nos' | 'all';
	let tab = $state<Tab>('find');
	let picked = $state<string[]>([]); // 줄 학생 (찾은 목록에서)
	let dropping = $state<string[]>([]); // 거둘 학생 (가진 학생에서)
	let filter = $state('');
	// 다른 뱃지로 옮기면 고른 것을 비운다
	let lastCode = '';
	$effect(() => {
		if (data.code === lastCode) return;
		lastCode = data.code;
		picked = [];
		dropping = [];
		filter = '';
	});
	// 새로 검색하고 돌아오면 찾기 칸을 연다 (주기 · 거두기 뒤 화면을 새로 읽을 때는 보던 칸 그대로)
	let lastQ: string | null = null;
	$effect(() => {
		const q = data.q;
		if (q === lastQ) return;
		lastQ = q;
		if (q !== null) tab = 'find';
	});

	const givable = $derived((data.results ?? []).filter((u) => !held.has(u.id)));
	const shownHolders = $derived.by(() => {
		const f = filter.trim().toLowerCase();
		return f ? data.holders.filter((h) => (h.nickname ?? '').toLowerCase().includes(f) || (data.students[h.id] ?? '').includes(f)) : data.holders;
	});
	const allPicked = $derived(givable.length > 0 && givable.every((u) => picked.includes(u.id)));
	const allDropping = $derived(shownHolders.length > 0 && shownHolders.every((h) => dropping.includes(h.id)));

	const title = $derived(sel?.title ?? '뱃지');
	const askGive = confirmed((f) => `"${title}" 뱃지를 ${f.getAll('user').length}명에게 줄까요? 학생 앱에 새 업적 축하가 뜨고, 학생마다 활동 기록에 남아요.`, {
		onSuccess: () => (picked = [])
	});
	const askTake = confirmed((f) => `"${title}" 뱃지를 ${f.getAll('user').length}명에게서 거둘까요? 대표 업적에서도 빠져요.`, {
		onSuccess: () => (dropping = [])
	});
	const askNos = confirmed(
		(f) => `학번 ${(String(f.get('nos') ?? '').match(/\d{4,9}/g) ?? []).length}개로 찾은 학생에게 "${title}" 뱃지를 줄까요? 학번 조회는 열람 기록에 남아요.`,
		{ keep: true }
	);
	const askAll = confirmed(() => `학교 인증 · 시작하기를 마친 학생 모두에게 "${title}" 뱃지를 줄까요? 모두에게 새 업적 축하가 떠요.`);
	const missing = $derived(form && 'missing' in form ? (form.missing as number[]) : null);
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">뱃지</h1>
		<p class="a-sub">운영진이 주는 뱃지 — 뱃지를 골라 여러 학생에게 한 번에 주고 거둬요. 학생마다 활동 기록에 남아요.</p>
	</div>
</header>

<FormMsg {form} />

<div class="bd">
	<nav class="list a-card" aria-label="뱃지 목록">
		{#each groups as g (g.label)}
			<p class="group">{g.label}</p>
			{#each g.items as b (b.code)}
				<a href="?code={b.code}" class:on={b.code === data.code} aria-current={b.code === data.code ? 'page' : undefined} data-sveltekit-noscroll>
					<span class="art"><Badge code={b.code} icon={b.icon} title={b.title} tier={3} size={40} /></span>
					<span class="name">
						<b>{b.title}</b>
						<small class="muted num">{b.holders}명</small>
					</span>
				</a>
			{/each}
		{/each}
	</nav>

	{#if sel}
		<div class="a-col">
			<section class="a-card head">
				<span class="art big"><Badge code={sel.code} icon={sel.icon} title={sel.title} tier={3} size={76} /></span>
				<div>
					<h2 class="a-h2">{sel.title}</h2>
					<p class="desc">{sel.description}</p>
					<p class="muted num">{sel.holders}명이 가졌어요 · {sel.category === 'cnsa' ? 'CNSA 뱃지' : '특별 업적'}</p>
				</div>
			</section>

			<section class="a-card">
				<h2 class="a-h2">주기</h2>
				<div class="a-tabs" role="tablist" aria-label="주는 방법">
					<button role="tab" aria-selected={tab === 'find'} class:on={tab === 'find'} onclick={() => (tab = 'find')}>학생 찾아 고르기</button>
					{#if admin}<button role="tab" aria-selected={tab === 'nos'} class:on={tab === 'nos'} onclick={() => (tab = 'nos')}>학번으로</button>{/if}
					<button role="tab" aria-selected={tab === 'all'} class:on={tab === 'all'} onclick={() => (tab = 'all')}>모두에게</button>
				</div>

				{#if tab === 'find'}
					<form class="search" method="GET" data-sveltekit-noscroll data-sveltekit-keepfocus>
						<input type="hidden" name="code" value={data.code} />
						<input class="field" name="q" value={data.q ?? ''} placeholder="익명 이름, ID 앞자리 (비우면 최근 가입순)" autocomplete="off" aria-label="학생 찾기" />
						<button class="btn">찾기</button>
					</form>
					{#if data.results}
						{#if data.results.length === 0}
							<p class="a-empty">검색 결과 없음</p>
						{:else}
							<form method="POST" action="?/give" use:enhance={askGive}>
								<input type="hidden" name="code" value={data.code} />
								<div class="a-scroll">
									<table class="a-table">
										<thead>
											<tr>
												<th class="ck">
													<input
														type="checkbox"
														aria-label="찾은 학생 모두 고르기"
														checked={allPicked}
														disabled={!givable.length}
														onchange={(e) => (picked = e.currentTarget.checked ? givable.map((u) => u.id) : [])}
													/>
												</th>
												<th>익명 이름</th>
												<th>상태</th>
												<th>가입</th>
											</tr>
										</thead>
										<tbody>
											{#each data.results as u (u.id)}
												{@const has = held.has(u.id)}
												<tr class:has>
													<td class="ck"><input type="checkbox" name="user" value={u.id} bind:group={picked} disabled={has} aria-label="{u.nickname ?? '(이름 없음)'} 고르기" /></td>
													<td>
														<a href="/admin/users/{u.id}"><b>{u.nickname ?? '(이름 없음)'}</b></a><Sid label={data.students[u.id]} />
														{#if !u.onboarded}<span class="pill">가입 중</span>{/if}
													</td>
													<td>{#if has}<span class="pill acc">가짐</span>{:else if u.status !== 'active'}<span class="pill red">정지</span>{:else}<span class="muted">—</span>{/if}</td>
													<td class="num muted">{fmtTime(u.created_at)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if data.results.length >= 100}<p class="a-hint">100명까지 표시. 검색어를 좁혀 주세요.</p>{/if}
								<div class="bar">
									<span class="muted num">{picked.length}명 고름</span>
									<button class="btn sm" disabled={!picked.length}>고른 {picked.length}명에게 주기</button>
								</div>
							</form>
						{/if}
					{:else}
						<p class="a-hint">익명 이름이나 ID 앞자리로 찾아서 여러 명을 골라 한 번에 줘요. 비워 두고 찾으면 최근 가입한 학생부터.</p>
					{/if}
				{:else if tab === 'nos' && admin}
					<form method="POST" action="?/nos" use:enhance={askNos}>
						<input type="hidden" name="code" value={data.code} />
						<textarea class="field" name="nos" rows="5" placeholder={'20101, 20102, 20215\n(쉼표 · 띄어쓰기 · 줄바꿈 어느 것이든)'} aria-label="학번 목록"></textarea>
						<p class="a-hint">학교 이메일 앞자리(학번)로 가입한 학생을 찾아 줘요. 동아리 명단을 그대로 붙여 넣어도 돼요. 학번 조회는 열람 기록에 남아요.</p>
						<div class="bar">
							<span></span>
							<button class="btn sm">학번으로 주기</button>
						</div>
					</form>
					{#if missing?.length}
						<p class="a-warn">못 찾은 학번 (아직 가입 전이거나 잘못 적음): <span class="num">{missing.join(', ')}</span></p>
					{/if}
				{:else}
					<form method="POST" action="?/all" use:enhance={askAll}>
						<input type="hidden" name="code" value={data.code} />
						<p class="a-hint" style="margin-top:0">학교 인증 · 시작하기를 마친 학생 모두에게 줘요. 이미 가진 학생은 건너뛰어요. (나중에 가입한 학생은 다시 누르면 받아요)</p>
						<div class="bar">
							<span></span>
							<button class="btn sm">모두에게 주기</button>
						</div>
					</form>
				{/if}
			</section>

			<section class="a-card">
				<h2 class="a-h2">가진 학생 <span class="muted num">{data.holders.length}명</span></h2>
				{#if data.holders.length === 0}
					<p class="a-empty">아직 아무도 없어요</p>
				{:else}
					<form method="POST" action="?/take" use:enhance={askTake}>
						<input type="hidden" name="code" value={data.code} />
						<input class="field filter" bind:value={filter} placeholder="익명 이름으로 좁히기" autocomplete="off" aria-label="가진 학생 좁히기" />
						<div class="a-scroll">
							<table class="a-table">
								<thead>
									<tr>
										<th class="ck">
											<input
												type="checkbox"
												aria-label="보이는 학생 모두 고르기"
												checked={allDropping}
												onchange={(e) => (dropping = e.currentTarget.checked ? shownHolders.map((h) => h.id) : [])}
											/>
										</th>
										<th>익명 이름</th>
										<th>받은 때</th>
									</tr>
								</thead>
								<tbody>
									{#each shownHolders as h (h.id)}
										<tr>
											<td class="ck"><input type="checkbox" name="user" value={h.id} bind:group={dropping} aria-label="{h.nickname ?? '(이름 없음)'} 고르기" /></td>
											<td>
												<a href="/admin/users/{h.id}"><b>{h.nickname ?? '(이름 없음)'}</b></a><Sid label={data.students[h.id]} />
												{#if h.status !== 'active'}<span class="pill red">정지</span>{/if}
											</td>
											<td class="num muted">{fmtTime(h.earned_at)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						{#if data.holders.length >= 1000}<p class="a-hint">최근에 받은 1000명까지 표시.</p>{/if}
						<div class="bar">
							<span class="muted num">{dropping.length}명 고름</span>
							<button class="btn-text danger" disabled={!dropping.length}>고른 {dropping.length}명에게서 거두기</button>
						</div>
					</form>
				{/if}
			</section>
		</div>
	{:else}
		<p class="a-empty">줄 수 있는 뱃지가 없어요</p>
	{/if}
</div>

<style>
	.bd {
		display: grid;
		grid-template-columns: 260px 1fr;
		gap: 20px;
		align-items: start;
	}
	@media (max-width: 860px) {
		.bd {
			grid-template-columns: 1fr;
		}
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px;
	}
	.group {
		margin: 8px 8px 4px;
		color: var(--text-2);
		font-size: 12px;
		font-weight: 600;
	}
	.list a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 10px;
		color: var(--text);
		text-decoration: none;
	}
	.list a:hover {
		background: var(--field);
	}
	.list a.on {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.art {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
	}
	.art.big {
		width: 84px;
		height: 84px;
	}
	.name {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.name b {
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name small {
		font-size: 12px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.head .a-h2 {
		margin: 0;
	}
	.desc {
		margin: 4px 0;
		font-size: 14px;
	}
	.head .muted {
		margin: 0;
		font-size: 13px;
	}
	.a-tabs button {
		flex: none;
		padding: 10px 12px;
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		color: var(--text-2);
		font-size: 14px;
		font-weight: 600;
	}
	.a-tabs button.on {
		color: var(--text);
		border-bottom-color: var(--text);
	}
	.search {
		display: flex;
		gap: 6px;
		margin: 12px 0 8px;
	}
	.search .btn {
		width: auto;
		padding: 0 16px;
		flex-shrink: 0;
	}
	textarea.field {
		width: 100%;
		margin-top: 12px;
		resize: vertical;
		font-family: inherit;
	}
	.filter {
		margin-bottom: 8px;
	}
	.ck {
		width: 36px;
		text-align: center;
	}
	.ck input {
		width: 18px;
		height: 18px;
		accent-color: var(--accent-fill-deep);
	}
	tr.has {
		opacity: 0.6;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
		font-size: 13px;
	}
	.bar .btn {
		width: auto;
		padding: 0 18px;
	}
</style>

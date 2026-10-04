<script lang="ts">
	/**
	 * 뱃지 요청 (Phase 84) — 학생이 앱에서 보낸 CNSA 뱃지 사진 · 동아리 기장 제출 · 새 뱃지 요청. 관리자만.
	 *   기다리는 요청(오래된 순) / 결정한 요청(최근 50개). 사진을 누르면 크게.
	 *   승인: 내 뱃지 인증 → 그 학생에게 / 동아리 → 기장 + 적은 부원 학번 모두에게(못 찾은 학번은 알려 준다) / 새 뱃지 → "추가할게요" 공지만.
	 *   동아리 · 앱에 없는 동아리는 줄 뱃지를 고른다 (뱃지가 아직 없으면 먼저 만들어야 승인할 수 있다).
	 *   반려: 메모를 적으면 학생에게 함께 간다. 결정하면 사진은 지워진다.
	 */
	import { enhance } from '$app/forms';
	import { fmtTime } from '$lib/adminTypes';
	import { confirmed } from '$lib/admin/confirm';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import { focustrap } from '$lib/focustrap';

	let { data, form } = $props();

	const KIND = { proof: '내 뱃지 인증', club: '동아리 기장 제출', new: '새 뱃지 요청' } as const;
	const STATUS = { pending: '기다림', approved: '승인', rejected: '반려' } as const;
	const clubs = $derived(data.badges.filter((b) => b.code.startsWith('club_')));
	let big = $state<string | null>(null);
	let photoErrors = $state<Record<string, boolean>>({});
	// 다시 불러오기는 그 사진만 — 다른 사진까지 새로 받지 않는다
	let retries = $state<Record<string, number>>({});
	const photoUrl = (p: string) => data.urls[p] + (retries[p] ? `&retry=${retries[p]}` : '');

	const askOk = confirmed((f) => {
		const r = data.items.find((x) => x.id === Number(f.get('id')));
		if (!r) return '승인할까요?';
		if (r.kind === 'new') return `"${r.title}" 새 뱃지 요청을 승인할까요? 뱃지는 주지 않고 "추가할게요" 공지만 가요.`;
		if (r.kind === 'club') return `동아리 뱃지를 기장과 부원 ${r.member_nos.length}명에게 줄까요? 사진은 지워져요.`;
		return `"${r.badge}" 뱃지를 이 학생에게 줄까요? 사진은 지워져요.`;
	});
	const askNo = confirmed(() => '반려할까요? 메모는 학생에게 함께 가고, 사진은 지워져요.');
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">뱃지 요청</h1>
		<p class="a-sub">학생이 앱에서 보낸 CNSA 뱃지 사진 — 학번 · 이름이 보여서 관리자만, 열면 열람 기록에 남아요. 결정하면 사진은 지워지고 결과는 학생에게 공지로 가요.</p>
	</div>
</header>

<FormMsg {form} />

<div class="a-tabs" role="tablist" aria-label="요청 목록">
	<a role="tab" href="?" class:on={!data.done} aria-selected={!data.done}>기다리는 요청</a>
	<a role="tab" href="?tab=done" class:on={data.done} aria-selected={data.done}>결정한 요청</a>
</div>

{#if !data.items.length}
	<p class="a-empty muted">{data.done ? '결정한 요청이 없어요' : '기다리는 요청이 없어요'}</p>
{:else}
	<ul class="reqs">
		{#each data.items as r (r.id)}
			<li class="a-card req" data-kind={r.kind}>
				<div class="top">
					{#if r.code}<span class="art"><Badge code={r.code} title={r.badge ?? ''} tier={3} size={48} /></span>{/if}
					<div class="what">
						<span class="kind">{KIND[r.kind]}</span>
						<h2 class="a-h2">{r.badge ?? r.title ?? '뱃지'}{#if r.kind === 'club' && !r.code}<small> (앱에 없는 동아리)</small>{/if}</h2>
						<p class="who num">{r.name ?? '이름 없음'}{r.grade ? ` · ${r.grade}학년` : ''}{r.no ? ` · 학번 ${r.no}` : ''} · {fmtTime(r.created_at)}</p>
						{#if r.has && r.kind === 'proof'}<p class="warn">이미 이 뱃지를 가졌어요</p>{/if}
					</div>
					{#if data.done}<span class="st {r.status}">{STATUS[r.status]}</span>{/if}
				</div>
				{#if r.note}<p class="note">{r.note}</p>{/if}
				{#if r.kind === 'club'}
					<p class="nos num"><b>부원 학번 {r.member_nos.length}명</b> {r.member_nos.join(', ') || '없음 (기장만)'}</p>
				{/if}
				{#if r.photos.length}
					<div class="photos">
						{#each r.photos as p, i (p)}
							{#if data.urls[p]}
								{#if photoErrors[p]}
									<button class="ph" onclick={() => { photoErrors[p] = false; retries[p] = (retries[p] ?? 0) + 1; }}>사진 다시 불러오기</button>
								{:else}
									<button class="ph" onclick={() => (big = photoUrl(p))} aria-label="사진 {i + 1} 크게"><img src={photoUrl(p)} alt="제출 사진 {i + 1}" loading="lazy" onerror={() => (photoErrors[p] = true)} /></button>
								{/if}
							{:else}
								<span class="ph none">사진을 못 불러옴</span>
							{/if}
						{/each}
					</div>
				{/if}
				{#if r.staff_note}<p class="note staff">메모: {r.staff_note}</p>{/if}

				{#if !data.done}
					<div class="acts">
						<form method="POST" action="?/decide" use:enhance={askOk}>
							<input type="hidden" name="id" value={r.id} />
							<input type="hidden" name="ok" value="1" />
							{#if r.kind === 'club'}
								<select class="field" name="code" aria-label="줄 동아리 뱃지">
									{#if !r.code}<option value="">줄 뱃지 고르기</option>{/if}
									{#each clubs as b (b.code)}<option value={b.code} selected={b.code === r.code}>{b.title}</option>{/each}
								</select>
							{/if}
							<input class="field" name="note" maxlength="500" placeholder="학생에게 보낼 메모 (선택)" aria-label="승인 메모" />
							<button class="btn ok">승인</button>
						</form>
						<form method="POST" action="?/decide" use:enhance={askNo}>
							<input type="hidden" name="id" value={r.id} />
							<input type="hidden" name="ok" value="0" />
							<input class="field" name="note" maxlength="500" placeholder="반려 이유 (학생에게 감)" aria-label="반려 이유" />
							<button class="btn danger">반려</button>
						</form>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if big}
	<div class="viewer" role="dialog" aria-modal="true" aria-label="제출 사진 확대" tabindex="-1" use:focustrap>
		<button class="btn" onclick={() => (big = null)}>사진 닫기</button>
		<img src={big} alt="제출 사진 크게" onerror={() => (big = null)} />
	</div>
{/if}
<svelte:window onkeydown={(e) => e.key === 'Escape' && (big = null)} />

<style>
	.a-tabs {
		margin-bottom: 14px;
	}
	.a-tabs a {
		text-decoration: none;
	}
	.reqs {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.req {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.top {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.what {
		flex: 1;
		min-width: 0;
	}
	.kind {
		font-size: 12px;
		font-weight: 700;
		color: var(--accent);
	}
	.what .a-h2 {
		margin: 2px 0;
	}
	.what small {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.who {
		margin: 0;
		font-size: 13px;
		color: var(--text-2);
	}
	.warn {
		margin: 4px 0 0;
		font-size: 12px;
		font-weight: 700;
		color: #b3261e;
	}
	.note {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--field);
		font-size: 14px;
		white-space: pre-wrap;
	}
	.note.staff {
		background: none;
		padding: 0;
		color: var(--text-2);
	}
	.nos {
		margin: 0;
		font-size: 13px;
		word-break: break-all;
	}
	.photos {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.ph {
		width: 150px;
		height: 150px;
		border-radius: 12px;
		overflow: hidden;
		background: var(--field);
	}
	.ph img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.ph.none {
		display: grid;
		place-items: center;
		font-size: 12px;
		color: var(--text-2);
	}
	.acts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	@media (max-width: 720px) {
		.acts {
			grid-template-columns: 1fr;
		}
	}
	.acts form {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.acts .field {
		flex: 1;
		min-width: 140px;
	}
	.acts .btn {
		width: auto;
		padding: 0 18px;
	}
	.btn.danger {
		background: #b3261e;
	}
	.st {
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--field);
		font-size: 12px;
		font-weight: 800;
	}
	.st.approved {
		background: #e7f6ec;
		color: #13753a;
	}
	.st.rejected {
		background: #fdeaea;
		color: #b3261e;
	}
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgb(0 0 0 / 0.8);
		cursor: zoom-out;
	}
	.viewer img {
		max-width: 100%;
		max-height: 100%;
		border-radius: 8px;
	}
</style>

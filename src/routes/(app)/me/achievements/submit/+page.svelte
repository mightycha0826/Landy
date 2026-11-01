<script lang="ts">
	/**
	 * 뱃지 제출 (Phase 84) — CNSA 뱃지를 운영진에게 보낸다 (lib/badgeRequests.ts).
	 *   내 뱃지 인증 — 앱에 있는 CNSA 뱃지(동아리 뱃지 · 기본 CNSA 뱃지 빼고). 뱃지와 학번 · 이름이 함께 보이는 사진.
	 *   동아리 기장 — 동아리 뱃지는 기장만. 기장 인증 사진 + 부원 학번을 함께 보내면 승인될 때 부원 모두에게 달린다.
	 *     (Phase 91 — 동아리 뱃지를 출시판에서 숨겨 이 탭도 감춘다. 다시 열 때 KINDS 에 'club' 을 더한다)
	 *   새 뱃지 요청 — 앱에 없는 뱃지. 뱃지 사진 · 이름 · 설명.
	 * 사진은 이 기기에서 줄여 올리고, 학번 · 이름이 보이니 관리자만 보고 확인이 끝나면 지운다. 결과는 개인 공지(하트)로 온다.
	 * 아래에 내가 보낸 요청과 상태 — 기다리는 요청은 거둘 수 있다.
	 */
	import { onMount } from 'svelte';
	import BackButton from '$lib/ui/BackButton.svelte';
	import LoadError from '$lib/ui/LoadError.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import { fetchMyAchievements, type Achievement } from '$lib/achievements';
	import {
		cancelBadgeRequest,
		KIND_LABEL,
		MAX_PHOTOS,
		myBadgeRequests,
		parseNos,
		shrink,
		STATUS_LABEL,
		SUBMIT_ERROR,
		submitBadgeRequest,
		type MyBadgeRequest,
		type RequestKind
	} from '$lib/badgeRequests';
	import { openBadgeTour } from '$lib/badgeTour.svelte';
	import { S, errMsg, toast } from '$lib/state.svelte';

	let defs = $state<Achievement[] | null>(null);
	let mine = $state<MyBadgeRequest[] | null>(null);
	// 못 불러온 것을 "뱃지가 없어요 · 보낸 요청 없음"으로 보이지 않는다 (UX G4) — 보낸 요청이 안 보이면 거두지 못하고 또 보내게 된다
	let defsFailed = $state(false);
	let mineFailed = $state(false);
	// 들어올 때 한 번 — 뱃지 목록(내 업적) · 보낸 요청
	onMount(() => {
		loadDefs();
		void loadMine();
	});
	function loadDefs() {
		defs = null;
		defsFailed = false;
		fetchMyAchievements()
			.then((d) => (defs = d.items.filter((a) => a.category === 'cnsa')))
			.catch(() => {
				defsFailed = true;
				defs = [];
			});
	}
	async function loadMine() {
		try {
			mine = await myBadgeRequests();
			mineFailed = false;
		} catch {
			mineFailed = true;
		}
	}

	const KINDS = ['proof', 'new'] as const satisfies readonly RequestKind[];
	let kind = $state<RequestKind>('proof');
	// 내 뱃지 인증 — 동아리 뱃지 · 기본 CNSA 뱃지(금 뱃지로 열린다) · 이미 가진 것은 빼고
	const proofable = $derived((defs ?? []).filter((a) => !a.code.startsWith('club_') && a.code !== 'cnsa_student' && a.tier === 0));
	const clubs = $derived((defs ?? []).filter((a) => a.code.startsWith('club_')));
	let code = $state<string | null>(null);
	let clubNew = $state(false);
	let title = $state('');
	let note = $state('');
	let nosText = $state('');
	const nos = $derived(parseNos(nosText));

	type Photo = { blob: Blob; url: string };
	let photos = $state<Photo[]>([]);
	let picking = $state(false);
	let fileEl: HTMLInputElement | undefined = $state();
	async function addPhotos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
		input.value = '';
		if (!files.length) return;
		picking = true;
		try {
			for (const f of files) {
				const blob = await shrink(f);
				photos = [...photos, { blob, url: URL.createObjectURL(blob) }];
			}
		} catch (err) {
			toast(errMsg(err));
		} finally {
			picking = false;
		}
	}
	function dropPhoto(i: number) {
		URL.revokeObjectURL(photos[i].url);
		photos = photos.filter((_, j) => j !== i);
	}
	$effect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)));

	function setKind(k: RequestKind) {
		kind = k;
		code = null;
		clubNew = false;
		title = '';
	}

	const ready = $derived(
		photos.length > 0 &&
			(kind === 'proof'
				? !!code
				: kind === 'club'
					? clubNew
						? title.trim().length >= 2
						: !!code
					: title.trim().length >= 2)
	);

	let busy = $state(false);
	async function send() {
		const uid = S.session?.user.id;
		if (!ready || busy || !uid) return;
		busy = true;
		try {
			const st = await submitBadgeRequest(uid, {
				kind,
				code: kind === 'new' || (kind === 'club' && clubNew) ? null : code,
				title: kind === 'new' || (kind === 'club' && clubNew) ? title.trim() : null,
				note: note.trim(),
				nos: kind === 'club' ? nos : [],
				photos: photos.map((p) => p.blob)
			});
			if (st !== 'ok') {
				toast(SUBMIT_ERROR[st]);
				return;
			}
			photos.forEach((p) => URL.revokeObjectURL(p.url));
			photos = [];
			note = '';
			nosText = '';
			setKind(kind);
			toast('운영진에게 보냈어요 · 확인되면 알림으로 알려 드려요');
			await loadMine();
		} catch (e) {
			toast(errMsg(e));
		} finally {
			busy = false;
		}
	}

	let canceling = $state<number | null>(null);
	async function cancel(r: MyBadgeRequest) {
		if (canceling) return;
		canceling = r.id;
		try {
			// 사진 삭제는 바로 시도하고 실패하면 예약 작업이 다시 한다 — "지웠어요"로 단정하지 않는다 (PRD 7)
			if (await cancelBadgeRequest(r.id)) toast('요청을 거뒀어요 · 사진은 곧 지워져요');
			else toast('이미 처리된 요청이에요');
			await loadMine();
		} catch (e) {
			toast(errMsg(e));
		} finally {
			canceling = null;
		}
	}

	const GUIDE: Record<RequestKind, string> = {
		proof: '뱃지와 학생증(또는 학번 · 이름을 적은 종이)이 한 장에 함께 나오게 찍어 주세요.',
		club: '동아리 뱃지와 기장임을 알 수 있는 것(동아리 명단 · 활동 기록 등)이 학번 · 이름과 함께 나오게 찍어 주세요.',
		new: '뱃지가 잘 보이게 찍어 주세요. 앞면 한 장이면 충분해요.'
	};
	const insta = $derived(S.settings?.badge_instagram ?? null);
	const date = (s: string) => new Date(s).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
</script>

<div class="topbar">
	<BackButton href="/me/achievements" history />
	<span class="title">뱃지 제출</span>
</div>

<div class="page submit">
	<section class="intro">
		<p>
			CNSA 뱃지를 운영진에게 보내면 확인한 뒤 교복에 달아 드려요.
			<button class="link" onclick={openBadgeTour}>CNSA 뱃지 안내</button>
		</p>
		<p class="insta">{insta ? `인스타그램 DM @${insta} 으로도 받아요` : '인스타그램으로 받는 방법은 준비 중이에요'}</p>
	</section>

	<div class="kinds" role="tablist" aria-label="제출 종류">
		{#each KINDS as k (k)}
			<button class:on={kind === k} role="tab" aria-selected={kind === k} onclick={() => setKind(k)}>{KIND_LABEL[k]}</button>
		{/each}
	</div>

	<section class="form" aria-label={KIND_LABEL[kind]}>
		{#if kind === 'proof'}
			<h2>어떤 뱃지인가요?</h2>
			{#if defs === null}
				<p class="muted small">불러오는 중…</p>
			{:else if defsFailed}
				<LoadError msg="뱃지 목록을 불러오지 못했어요." onretry={loadDefs} />
			{:else if proofable.length}
				<div class="picks">
					{#each proofable as a (a.code)}
						<button class="pick" class:on={code === a.code} aria-pressed={code === a.code} onclick={() => (code = a.code)}>
							<Badge code={a.code} icon={a.icon} tier={3} title={a.title} size={44} />
							<span>{a.title}</span>
						</button>
					{/each}
				</div>
			{:else}
				<p class="muted small">인증할 뱃지가 목록에 없어요 · 앱에 없는 뱃지는 "새 뱃지 요청"으로 보내 주세요</p>
			{/if}
			<p class="hint">기본 CNSA 뱃지는 Landy 금 뱃지를 처음 따면 저절로 열려요.</p>
		{:else if kind === 'club'}
			<h2>어느 동아리인가요?</h2>
			{#if defsFailed}<LoadError msg="뱃지 목록을 불러오지 못했어요." onretry={loadDefs} />{/if}
			<div class="picks">
				{#each clubs as a (a.code)}
					<button class="pick" class:on={!clubNew && code === a.code} aria-pressed={!clubNew && code === a.code} onclick={() => ((clubNew = false), (code = a.code))}>
						<Badge code={a.code} icon={a.icon} tier={3} title={a.title} size={44} />
						<span>{a.title}</span>
					</button>
				{/each}
				<button class="pick add" class:on={clubNew} aria-pressed={clubNew} onclick={() => ((clubNew = true), (code = null))}>
					<span class="plus" aria-hidden="true">+</span>
					<span>목록에 없는 동아리</span>
				</button>
			</div>
			{#if clubNew}
				<input class="field" bind:value={title} maxlength="40" placeholder="동아리 이름" aria-label="동아리 이름" />
			{/if}
			<label class="lbl" for="nos">부원 학번 <small>{nos.length ? `${nos.length}명 · 나는 따로 적지 않아도 함께 받아요` : '쉼표 · 띄어쓰기 · 줄바꿈으로 나눠 적어요'}</small></label>
			<textarea id="nos" class="field" rows="3" bind:value={nosText} placeholder="예) 20701, 20702, 20815" inputmode="numeric"></textarea>
			<p class="hint">동아리 뱃지는 기장만 보낼 수 있어요. 승인되면 적은 부원 모두에게 한 번에 달려요.</p>
		{:else}
			<h2>앱에 없는 뱃지</h2>
			<input class="field" bind:value={title} maxlength="40" placeholder="뱃지 이름 (예: 과학 탐구 대회 금상)" aria-label="뱃지 이름" />
		{/if}

		<h2 class="ph-h">사진 <small class="num">{photos.length}/{MAX_PHOTOS}</small></h2>
		<p class="hint">{GUIDE[kind]}</p>
		<div class="photos">
			{#each photos as p, i (p.url)}
				<span class="ph">
					<img src={p.url} alt="고른 사진 {i + 1}" />
					<button class="rm" onclick={() => dropPhoto(i)} aria-label="사진 {i + 1} 빼기">×</button>
				</span>
			{/each}
			{#if photos.length < MAX_PHOTOS}
				<button class="ph add" onclick={() => fileEl?.click()} disabled={picking} aria-busy={picking} aria-label="사진 고르기">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.3-2h6l1.3 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.5" r="3.4" /></svg>
					<span>{picking ? '줄이는 중…' : '사진 추가'}</span>
				</button>
			{/if}
			<input bind:this={fileEl} class="sr-only" type="file" accept="image/*" multiple onchange={addPhotos} tabindex="-1" aria-hidden="true" />
		</div>

		<label class="lbl" for="note">{kind === 'new' ? '설명' : '운영진에게 한마디'} <small>선택</small></label>
		<textarea id="note" class="field" rows="2" maxlength="500" bind:value={note} placeholder={kind === 'new' ? '어떤 활동으로 받는 뱃지인지 적어 주세요' : '덧붙일 말이 있으면 적어 주세요'}></textarea>

		<button class="btn send" onclick={send} disabled={!ready || busy} aria-busy={busy}>{busy ? '보내는 중…' : '운영진에게 보내기'}</button>
		<p class="privacy">사진은 관리자만 보고, 확인이 끝나면 지워요.</p>
	</section>

	{#if mineFailed}
		<LoadError msg="보낸 요청을 불러오지 못했어요." onretry={() => void loadMine()} />
	{/if}
	{#if mine?.length}
		<section class="mine" aria-labelledby="mine-h">
			<h2 id="mine-h">보낸 요청</h2>
			<ul>
				{#each mine as r (r.id)}
					<li>
						<span class="r-main">
							<b>{r.title ?? '뱃지'}</b>
							<small>{KIND_LABEL[r.kind]}{r.kind === 'club' && r.members ? ` · 부원 ${r.members}명` : ''} · {date(r.created_at)}</small>
							{#if r.staff_note}<small class="note">운영진: {r.staff_note}</small>{/if}
						</span>
						<span class="st {r.status}">{STATUS_LABEL[r.status]}</span>
						{#if r.status === 'pending'}
							<button class="cancel u-tap" onclick={() => cancel(r)} disabled={canceling === r.id}>거두기</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.submit {
		gap: 14px;
		padding-top: 12px;
		padding-bottom: calc(28px + env(safe-area-inset-bottom));
	}
	.intro p {
		margin: 0;
		font-size: 14px;
		line-height: 1.55;
	}
	.intro .insta {
		margin-top: 4px;
		font-size: 12px;
		color: var(--text-2);
	}
	.link {
		position: relative;
		color: var(--accent);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.link::after {
		content: '';
		position: absolute;
		inset: -12px -4px;
	}
	.kinds {
		display: flex;
		padding: 3px;
		border-radius: 14px;
		background: var(--field);
	}
	.kinds button {
		flex: 1;
		min-height: 40px;
		border-radius: 11px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	.kinds button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		border-radius: var(--r-card);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	h2 {
		margin: 0;
		font-size: 15px;
	}
	h2 small {
		margin-left: 4px;
		font-size: 12px;
		color: var(--text-2);
	}
	.ph-h {
		margin-top: 6px;
	}
	.picks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 8px;
	}
	.pick {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		min-height: 96px;
		padding: 10px 6px;
		border-radius: 16px;
		border: 1.5px solid var(--line);
		font-size: 12px;
		font-weight: 600;
		text-align: center;
		transition: transform 0.15s;
	}
	.pick:active {
		transform: scale(0.96);
	}
	.pick.on {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.pick .plus {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px dashed var(--line);
		font-size: 22px;
		color: var(--text-2);
	}
	.lbl {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-top: 4px;
		font-size: 14px;
		font-weight: 600;
	}
	.lbl small {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
	}
	.field {
		width: 100%;
		padding: 12px 14px;
		border: 0;
		border-radius: 14px;
		background: var(--field);
		color: var(--text);
		font: inherit;
		font-size: 16px;
		resize: vertical;
	}
	.hint {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-2);
	}
	.photos {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.ph {
		position: relative;
		width: 92px;
		height: 92px;
		border-radius: 14px;
		overflow: hidden;
		background: var(--field);
	}
	.ph img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.ph .rm {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.55);
		color: #fff;
		font-size: 18px;
		line-height: 1;
	}
	.ph.add {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border: 1.5px dashed var(--line);
		background: none;
		color: var(--text-2);
		font-size: 12px;
		font-weight: 600;
	}
	.ph.add svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}
	.send {
		margin-top: 6px;
	}
	.privacy {
		margin: 0;
		font-size: 11px;
		text-align: center;
		color: var(--text-2);
	}
	.mine h2 {
		margin-bottom: 8px;
	}
	.mine ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0 14px;
		list-style: none;
		border-radius: var(--r-card);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.mine li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 60px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line);
	}
	.mine li:last-child {
		border-bottom: 0;
	}
	.r-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.r-main b {
		font-size: 14px;
	}
	.r-main small {
		font-size: 12px;
		color: var(--text-2);
	}
	.r-main .note {
		color: var(--text);
	}
	.st {
		flex: none;
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--field);
		font-size: 11px;
		font-weight: 650;
	}
	.st.approved {
		background: #e7f6ec;
		color: #13753a;
	}
	.st.rejected {
		background: #fdeaea;
		color: #b3261e;
	}
	.cancel {
		min-height: 44px;
		padding: 0 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>

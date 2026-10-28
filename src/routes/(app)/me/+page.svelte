<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import MannerTemp from '$lib/ui/MannerTemp.svelte';
	import Uniform from '$lib/ui/Uniform.svelte';
	import BadgeDetail from '$lib/ui/BadgeDetail.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import {
		featuredError,
		featuredOf,
		FAME,
		fetchMyAchievements,
		placedFeatured,
		progressText,
		setFeaturedBadges,
		slotsOf,
		toggledFeatured,
		type Achievement,
		type MyAchievements
	} from '$lib/achievements';
	import TopbarMe from '$lib/ui/TopbarMe.svelte';
	import { S, errMsg, setProfileField, saveProfile, toast } from '$lib/state.svelte';
	import { readDraft, writeDraft, clearDraft } from '$lib/drafts';
	import { accountToken, accountIsCurrent } from '$lib/accountScope';

	/**
	 * 내 프로필 (하단 탭 오른쪽) — 상대에게 보이는 소개 · 관심사 · MBTI, 이야기하고 싶은 상대.
	 * 설정 화면과 같은 아이폰 설정식 디자인 (app.css .g-*): 맨 위 낮은 이름 카드(아바타 · 이름 · 매너 온도),
	 * 그 아래 교복(대표 업적 = 깃의 배지, Phase 60), 그 아래 둥근 카드들.
	 * 알림 · 비밀번호 · 계정 · 개인정보 안내 · 로그아웃은 설정(/settings)에.
	 * 익명 이름은 고정. 대화 상대에게 보이는 건 이름 + 소개 + 관심사 + MBTI 뿐이다.
	 */

	let busy = $state(false);

	// ── 명성 (Phase 31) — 대표 업적 3개 · 모은 업적 수. 이름 카드의 "업적 n/m" 을 누르면 업적 전체 ──
	// 대표 업적은 교복 깃에 단 배지 (Phase 60). 배지를 누르면 어떻게 얻는지 · 등급 기준 · 대표에서 내리기
	// (Phase 44 — 업적 화면에서 누를 때와 같은 BadgeDetail). 배지를 꾹 눌러 다른 칸으로 끌어 옮긴다 (Phase 69)
	// 교복은 바로 그리고 배지는 오는 대로 단다 — 다시 열 때는 지난번 것을 먼저 보여 준다 (FAME.last)
	let fame = $state<MyAchievements | null>(FAME.last);
	$effect(() => {
		fetchMyAchievements()
			.then((d) => (fame = d))
			.catch(() => {});
	});
	$effect(() => {
		if (fame) FAME.last = fame; // 대표 업적을 바꾼 것도 기억
	});
	const earned = $derived(fame?.items.filter((a) => a.tier > 0).length ?? 0);
	let medal = $state<Achievement | null>(null);
	let featBusy = $state(false);
	async function toggleFeature(a: Achievement) {
		if (!fame || featBusy) return;
		const codes = toggledFeatured(fame, a.code);
		featBusy = true;
		try {
			const r = await setFeaturedBadges(codes);
			if (r.status !== 'ok') throw new Error(featuredError(r.status, slotsOf(fame)));
			fame = { ...fame, featured: r.featured ?? fame.featured, chosen: codes };
			medal = null;
			toast('대표 업적을 바꿨어요');
		} catch (e) {
			toast(errMsg(e));
		} finally {
			featBusy = false;
		}
	}

	/** 배지를 다른 칸에 놓았다 — 바로 옮겨 보이고 서버에 저장, 안 되면 되돌린다 */
	async function place(code: string, slot: number) {
		if (!fame || featBusy) return;
		const codes = placedFeatured(fame, code, slot);
		if (codes.join() === fame.featured.map((b) => b.code).join()) return;
		const prev = fame;
		featBusy = true;
		fame = { ...fame, featured: featuredOf(fame.items, codes), chosen: codes };
		try {
			const r = await setFeaturedBadges(codes);
			if (r.status !== 'ok') throw new Error(featuredError(r.status, slotsOf(fame)));
			if (fame) fame = { ...fame, featured: r.featured ?? fame.featured };
		} catch (e) {
			fame = prev;
			toast(errMsg(e));
		} finally {
			featBusy = false;
		}
	}

	// ── 기본 정보 (상대에게 보이는 것) ──
	const MBTIS = [
		'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
		'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
	];
	const draftToken = accountToken();
	type ProfileDraft = { bio: string; interests: string[]; mbti: string | null };
	const draft = readDraft('profile', (v: unknown): v is ProfileDraft => {
		if (!v || typeof v !== 'object') return false;
		const p = v as ProfileDraft;
		return typeof p.bio === 'string' && p.bio.length <= 60 && Array.isArray(p.interests) &&
			p.interests.length <= 5 && p.interests.every((s) => typeof s === 'string' && s.length <= 12) &&
			(p.mbti === null || MBTIS.includes(p.mbti));
	});
	let bio = $state(draft?.bio ?? S.profile?.bio ?? '');
	let interests = $state<string[]>([...(draft?.interests ?? S.profile?.interests ?? [])]);
	let mbti = $state<string | null>(draft ? draft.mbti : S.profile?.mbti ?? null);
	let tagDraft = $state('');

	// 프로필이 늦게 불러와졌으면 한 번 채운다
	let filled = !!S.profile || !!draft;
	$effect(() => {
		if (filled || !S.profile) return;
		filled = true;
		bio = S.profile.bio;
		interests = [...S.profile.interests];
		mbti = S.profile.mbti;
	});

	const dirty = $derived(
		!!S.profile &&
			(bio.trim() !== S.profile.bio ||
				mbti !== S.profile.mbti ||
				JSON.stringify(interests) !== JSON.stringify(S.profile.interests))
	);

	$effect(() => {
		if (dirty) writeDraft('profile', { bio, interests, mbti }, draftToken);
		else clearDraft('profile', draftToken);
	});
	function discardProfileDraft() {
		clearDraft('profile', draftToken);
		bio = S.profile?.bio ?? ''; interests = [...(S.profile?.interests ?? [])]; mbti = S.profile?.mbti ?? null;
	}

	function addTag() {
		const t = tagDraft.trim().replace(/^#/, '');
		if (!t) return;
		if (t.length > 12) return toast('관심사 하나는 12자까지 담을 수 있어요');
		if (interests.length >= 5) return toast('관심사는 5개까지 담을 수 있어요');
		if (!interests.some((x) => x.toLowerCase() === t.toLowerCase())) interests.push(t);
		tagDraft = '';
	}
	function onTagKey(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
			e.preventDefault();
			addTag();
		}
	}

	async function saveInfo() {
		if (busy) return;
		busy = true;
		try {
			await saveProfile(bio, interests, mbti);
			if (!accountIsCurrent(draftToken)) return;
			clearDraft('profile', draftToken);
			toast('저장 완료');
		} catch (e) {
			toast(errMsg(e));
		} finally {
			busy = false;
		}
	}

	// ── 매칭 선호 ──
	const WANTS = [
		{ v: 'm' as const, label: '남자' },
		{ v: 'f' as const, label: '여자' },
		{ v: 'any' as const, label: '상관없어요' }
	];

	async function setWant(want: 'm' | 'f' | 'any') {
		if (busy || S.profile?.want === want) return;
		busy = true;
		try {
			await setProfileField({ want });
			toast('변경 완료');
		} catch (e) {
			toast(errMsg(e));
		} finally {
			busy = false;
		}
	}

</script>

<!-- 머리글은 다른 탭(익명편지 · 채팅)과 같은 높이 · 같은 자리 — 탭을 바꿔도 위쪽이 움직이지 않게 (Phase 35) -->
<div class="topbar">
	<span class="title display">내 프로필</span>
	<TopbarMe />
</div>

<div class="page grouped me">
	{#if S.profile?.nickname}
		<!-- 이름 카드 — 낮게 (Phase 60): 표지 위에 아바타 · 이름 · 업적 수, 그 아래 매너 온도 -->
		<section class="who">
			<div class="cover" aria-hidden="true"></div>
			<div class="head">
				<span class="who-ring"><Avatar name={S.profile.nickname} size={60} online /></span>
				<p class="nick">{S.profile.nickname}</p>
				{#if fame}
					<a class="ach-link" href="/me/achievements" aria-label="업적 {earned}개 · 전체 보기"><span class="num">업적 {earned}/{fame.items.length}</span> ›</a>
				{/if}
			</div>
			<div class="temp"><MannerTemp temp={S.profile.manner_temp} /></div>
		</section>
	{/if}

	<!-- 업적을 읽는 동안에도 교복은 보인다 — 빈 칸 표시(emptyHref)만 읽은 뒤에 -->
	{#if S.profile}
		<!-- 교복 — 대표 업적은 깃의 배지, 빈 칸은 업적 화면으로 (Phase 60) -->
		<section class="dress">
			<Uniform
				neck={S.profile?.gender === 'f' ? 'ribbon' : 'tie'}
				badges={fame?.featured ?? []}
				slots={slotsOf(fame)}
				emptyHref={fame ? '/me/achievements' : undefined}
				allHref="/me/achievements"
				onpick={(b) => (medal = fame?.items.find((a) => a.code === b.code) ?? null)}
				onplace={place}
			/>
		</section>
	{/if}

	{#if medal && fame}
		{@const a = medal}
		<Sheet onclose={() => (medal = null)} label={a.title}>
			<BadgeDetail badge={a} def={a} sub={a.granted ? '' : progressText(a)}>
				<button aria-busy={featBusy} class="btn feat" onclick={() => toggleFeature(a)} disabled={featBusy}>
					{fame.featured.some((f) => f.code === a.code) ? '대표 업적에서 내리기' : '대표 업적으로 걸기'}
				</button>
				<a class="all u-tap" href="/me/achievements">업적 전체 보기</a>
			</BadgeDetail>
		</Sheet>
	{/if}

	<h2 class="g-head" id="bio-h">소개</h2>
	<div class="g-card bio">
		<textarea
			class="area"
			bind:value={bio}
			maxlength="60"
			rows="2"
			aria-labelledby="bio-h"
			placeholder="한 줄로 나를 소개해 주세요 (예: 밴드 음악 좋아해요)"
		></textarea>
		<span class="count muted num">{bio.trim().length}/60</span>
	</div>

	<h2 class="g-head">관심사 <span class="num">{interests.length}/5</span></h2>
	<div class="g-card tags">
		{#each interests as t, i (t)}
			<button class="tag" onclick={() => interests.splice(i, 1)} aria-label="{t} 지우기">
				{t} <span aria-hidden="true">×</span>
			</button>
		{/each}
		{#if interests.length < 5}
			<input
				class="tag-input"
				bind:value={tagDraft}
				maxlength="12"
				placeholder="+ 추가"
				aria-label="관심사 추가"
				onkeydown={onTagKey}
				onblur={addTag}
			/>
		{/if}
	</div>

	<h2 class="g-head">MBTI</h2>
	<div class="g-card mbti">
		<button class="chip none" class:on={mbti === null} onclick={() => (mbti = null)}>안 적을래요</button>
		{#each MBTIS as m (m)}
			<button class="chip" class:on={mbti === m} onclick={() => (mbti = m)}>{m}</button>
		{/each}
	</div>

	{#if dirty}<button class="btn ghost" onclick={discardProfileDraft} disabled={busy}>수정 내용 버리기</button>{/if}
	<button aria-busy={busy} class="btn save" onclick={saveInfo} disabled={!dirty || busy}>
		{busy ? '저장 중…' : dirty ? '저장' : '저장됨'}
	</button>

	<h2 class="g-head" id="want-h">이런 사람과 이야기할래요</h2>
	<div class="g-card" role="radiogroup" aria-labelledby="want-h">
		{#each WANTS as w (w.v)}
			{@const on = S.profile?.want === w.v}
			<button class="g-row" role="radio" aria-checked={on} onclick={() => setWant(w.v)}>
				<span>{w.label}</span>
				{#if on}
					<svg class="g-check" viewBox="0 0 18 18" fill="none" aria-hidden="true">
						<path d="M3 9.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.me {
		padding-bottom: 32px; /* 아래쪽 안전영역은 탭바가 맡는다 */
	}

	/* 맨 위 — 낮은 이름 카드 (Phase 60): 브랜드색 표지에 걸친 아바타 · 표지 위 이름 · 업적 수, 아래 매너 온도 */
	.who {
		position: relative;
		display: flex;
		flex-direction: column;
		margin: 4px 16px 0;
		padding: 10px 16px 14px;
		border-radius: var(--r-card);
		background: var(--cell);
		box-shadow: var(--shadow-1);
		overflow: hidden;
	}
	.cover {
		position: absolute;
		inset: 0 0 auto;
		height: 56px;
		background:
			radial-gradient(60% 120% at 20% 0%, rgb(255 255 255 / 0.35), transparent 60%),
			var(--brand);
	}
	.head {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.who-ring {
		flex: none;
		padding: 4px;
		border-radius: 50%;
		background: var(--cell);
		box-shadow: var(--shadow-1);
	}
	.nick {
		flex: 1;
		min-width: 0;
		margin: 8px 0 0;
		overflow: hidden;
		color: #fff;
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.04em;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-shadow: 0 1px 6px rgb(0 0 0 / 0.18);
	}
	/* 업적 전체 — 표지 오른쪽 (누름 높이 44) */
	.ach-link {
		flex: none;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		margin: -4px -6px 0 0;
		padding: 0 6px;
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
		text-shadow: 0 1px 6px rgb(0 0 0 / 0.18);
	}
	.ach-link:active {
		opacity: 0.6;
	}
	.who .temp {
		display: flex;
		justify-content: center;
		width: 100%;
		margin-top: 6px;
	}
	.dress {
		margin: 14px 16px 0;
	}
	/* 메달 자세히(BadgeDetail) 아래 */
	.feat {
		width: 100%;
		max-width: 320px;
	}
	.all {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 12px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
		text-decoration: none;
	}

	.g-head span {
		font-weight: 400;
	}

	.bio {
		display: flex;
		flex-direction: column;
		padding: 12px 16px 10px;
	}
	.area {
		width: 100%;
		padding: 0;
		border: 0;
		outline: none;
		resize: none;
		background: none;
		font-size: 16px;
		line-height: 1.5;
	}
	.area::placeholder {
		color: var(--text-2);
	}
	.count {
		align-self: flex-end;
		font-size: 12px;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 14px 16px;
	}
	/* 칩은 36, 누름은 줄 간격(8)의 반씩 더해 44 (G1) */
	.tag,
	.chip {
		position: relative;
		transition: transform 0.15s, opacity 0.15s;
	}
	.tag::after,
	.chip::after {
		content: '';
		position: absolute;
		inset: -4px min(-4px, calc(50% - 22px));
	}
	.tag:active,
	.chip:active {
		transform: scale(0.95);
		transition-duration: 0.08s;
	}
	.tag {
		height: 36px;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--field);
		font-size: 14px;
	}
	.tag span {
		color: var(--text-2);
		margin-left: 2px;
	}
	.tag-input {
		width: 100px;
		height: 36px;
		padding: 0 14px;
		border: 1px dashed var(--cell-line);
		border-radius: 999px;
		background: none;
		font-size: 16px; /* 16px 미만이면 아이폰이 확대한다 (Phase 41) */
		outline: none;
	}
	.tag-input:focus {
		border-style: solid;
		border-color: var(--text-2);
	}

	.mbti {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
		padding: 14px 16px;
	}
	.chip {
		height: 36px;
		border-radius: 12px;
		background: var(--field);
		font-size: 14px;
		font-weight: 500;
	}
	.chip.none {
		grid-column: 1 / -1;
	}
	.chip.on {
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
	}
	/* "안 적을래요"는 고르지 않은 상태 — 카드 폭 가득한 검은 막대가 화면에서 가장 무겁게 보이지 않게 테두리로만 (Phase 40) */
	.chip.none.on {
		background: var(--field);
		color: var(--text);
		box-shadow: inset 0 0 0 1.5px var(--text);
	}

	.save {
		margin-top: 18px;
		height: 50px;
		border-radius: 16px;
		font-size: 16px;
	}
</style>

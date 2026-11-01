<script lang="ts">
	/**
	 * CNSA 뱃지 안내 (Phase 84 · 89) — 프로필 안내의 끝에 이어서 한 번 (lib/badgeTour.svelte.ts), 업적 화면 CNSA 탭 · 설정 › 뱃지에서 다시.
	 * 다섯 장: 무엇인가(기본 CNSA 뱃지 · 금뱃지) → Landy 에서 얻는 법(기본 뱃지는 금 뱃지로 · 나머지는 사진으로 운영진에게) → 앱에 없는 뱃지(추가 요청 — 동아리 뱃지는 출시판에서 숨겨 두어 안내하지 않는다, Phase 91) →
	 *   어디에 보일지(랜덤채팅에서 뱃지마다 숨기기 · 편지 찾기의 뱃지 순서 — 여기서 바로 정한다) → 금 뱃지 5개면 대표 칸 5개.
	 * 마지막 장에서 "뱃지 제출하기"로 바로 간다. 닫거나 끝까지 보면 이 기기에 "봤음".
	 */
	import { focustrap } from '$lib/focustrap';
	import { backClose, navigateFromOverlay } from '$lib/overlay.svelte';
	import { BADGE_TOUR, closeBadgeTour } from '$lib/badgeTour.svelte';
	import { fetchMyAchievements, GOLDS_FOR_FIVE, slotsOf, type MyAchievements } from '$lib/achievements';
	import { S, errMsg, setProfileField, toast } from '$lib/state.svelte';
	import Badge from './Badge.svelte';
	import BadgeChatToggles from './BadgeChatToggles.svelte';

	const STEPS = ['what', 'how', 'club', 'where', 'five'] as const;
	let step = $state(0);
	let mine = $state<MyAchievements | null>(null);

	// 열릴 때마다 처음 장부터 · 내 뱃지(숨기기 · 금 뱃지 수)를 한 번 받아 온다
	$effect(() => {
		if (!BADGE_TOUR.open) return;
		step = 0;
		mine = null;
		fetchMyAchievements()
			.then((d) => (mine = d))
			.catch(() => {});
	});
	// 떠 있는 동안 다른 저절로 뜨는 창은 기다린다 — lib/tour.svelte.ts 의 touring() 이 BADGE_TOUR.open 을 같이 본다
	backClose(closeBadgeTour, { open: () => BADGE_TOUR.open });

	const last = $derived(step === STEPS.length - 1);
	const insta = $derived(S.settings?.badge_instagram ?? null);
	const golds = $derived(mine?.golds ?? 0);

	// 편지 찾기에서 내 뱃지 순서 — 내 순서 / 무작위
	let orderBusy = $state(false);
	async function setOrder(v: 'mine' | 'random') {
		if (orderBusy || (S.profile?.letter_badge_order ?? 'mine') === v) return;
		orderBusy = true;
		try {
			await setProfileField({ letter_badge_order: v });
		} catch (e) {
			toast(errMsg(e));
		} finally {
			orderBusy = false;
		}
	}

	// 창을 닫으며 이동 — 이 창의 뒤로가기 칸을 제출 화면으로 바꿔 끼운다 (닫기의 뒤로가기와 이동이 서로 취소하지 않게, lib/overlay.svelte.ts)
	function submit() {
		void navigateFromOverlay('/me/achievements/submit');
		closeBadgeTour();
	}
	const PINS = ['cnsa_student', 'msmp_gold'];
</script>

<svelte:window onkeydown={(e) => BADGE_TOUR.open && e.key === 'Escape' && closeBadgeTour()} />

{#if BADGE_TOUR.open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="scrim" role="presentation" onclick={closeBadgeTour}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="card" role="dialog" aria-modal="true" aria-label="CNSA 뱃지 안내" tabindex="-1" use:focustrap onclick={(e) => e.stopPropagation()}>
			<button class="x u-tap" onclick={closeBadgeTour} aria-label="안내 닫기">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
			{#key step}
				<div class="inner" data-step={STEPS[step]}>
					{#if STEPS[step] === 'what'}
						<div class="pins" aria-hidden="true">
							{#each PINS as c, i (c)}<span style:--i={i}><Badge code={c} tier={3} size={72} /></span>{/each}
						</div>
						<h2>CNSA 뱃지란?</h2>
						<p>충남삼성고 학생들이 <b>동아리 · 행사 · 수상</b>처럼 여러 활동으로 받는 실제 뱃지예요. Landy에서는 교복 깃에 달아 보여 줄 수 있어요.</p>
					{:else if STEPS[step] === 'how'}
						<h2>Landy에서 얻는 법</h2>
						<ul class="rows">
							<li>
								<span class="ic gold" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="6" /><path d="M9 15.5L7.5 21l4.5-2.2 4.5 2.2-1.5-5.5" /></svg></span>
								<span><b>기본 CNSA 뱃지</b>Landy 뱃지 중 <b class="em">금 뱃지를 처음 따면</b> 저절로 열려요.</span>
							</li>
							<li>
								<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.3-2h6l1.3 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.5" r="3.4" /></svg></span>
								<span><b>다른 CNSA 뱃지</b>뱃지와 <b class="em">학번 · 이름</b>이 함께 보이게 찍어 운영진에게 보내 주세요. 확인되면 운영팀이 달아 드려요.</span>
							</li>
						</ul>
						<div class="ways">
							<span class="way on">앱에서 바로 보내기</span>
							<span class="way" class:soon={!insta}>{insta ? `인스타그램 DM @${insta}` : '인스타그램 DM · 준비 중'}</span>
						</div>
					{:else if STEPS[step] === 'club'}
						<h2>앱에 없는 뱃지</h2>
						<ul class="rows">
							<li>
								<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8.5v7M8.5 12h7" /></svg></span>
								<span><b>없는 뱃지는 추가 요청</b>뱃지 사진과 이름을 보내 주시면 앱에 새로 만들어요.</span>
							</li>
						</ul>
					{:else if STEPS[step] === 'where'}
						<h2>어디에 보일지 골라요</h2>
						<p class="lead">랜덤채팅에선 뱃지가 나를 짐작하게 할 수 있어요. 뱃지마다 보일지 정해요.</p>
						<div class="toggles">
							{#if mine}<BadgeChatToggles data={mine} compact />{:else}<p class="muted small">불러오는 중…</p>{/if}
						</div>
						<div class="order">
							<span id="order-h">편지 찾기에서 내 뱃지 순서</span>
							<div class="seg" role="radiogroup" aria-labelledby="order-h">
								{#each [['mine', '내 순서'], ['random', '무작위']] as const as [v, label] (v)}
									<button
										class="seg-btn word"
										class:on={(S.profile?.letter_badge_order ?? 'mine') === v}
										role="radio"
										aria-checked={(S.profile?.letter_badge_order ?? 'mine') === v}
										disabled={orderBusy}
										onclick={() => setOrder(v)}>{label}</button
									>
								{/each}
							</div>
						</div>
					{:else}
						<div class="slots" aria-hidden="true">
							{#each [0, 1, 2, 3, 4] as i (i)}<i class:more={i >= 3} style:--i={i}></i>{/each}
						</div>
						<h2>금 뱃지 5개면 칸이 5개</h2>
						<p>Landy 금 뱃지를 {GOLDS_FOR_FIVE}개 모으면 교복에 다는 대표 뱃지 칸이 <b>3개에서 5개</b>로 늘어요.</p>
						<p class="prog num">
							{#if mine && slotsOf(mine) >= 5}이미 5칸이에요 · 금 뱃지 {golds}개{:else}지금 금 뱃지 <b>{Math.min(golds, GOLDS_FOR_FIVE)}/{GOLDS_FOR_FIVE}</b>{/if}
						</p>
					{/if}
				</div>
			{/key}

			<div class="dots" aria-label="{STEPS.length}장 중 {step + 1}장">
				{#each STEPS as _, i (i)}<i class:on={i === step} class:past={i < step}></i>{/each}
			</div>
			<div class="btns">
				{#if last}
					<button class="btn ghost" onclick={submit}>뱃지 제출하기</button>
					<button class="btn" onclick={closeBadgeTour}>확인</button>
				{:else}
					{#if step > 0}<button class="prev u-tap" onclick={() => (step -= 1)}>이전</button>{:else}<span></span>{/if}
					<button class="btn next" onclick={() => (step += 1)}>다음</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgb(10 6 8 / 0.55);
		animation: fade 0.2s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.card {
		position: relative;
		width: min(380px, 100%);
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		padding: 22px 20px 16px;
		border-radius: 26px;
		background: var(--surface);
		box-shadow: var(--shadow-2);
		animation: rise 0.36s cubic-bezier(0.2, 0.9, 0.3, 1.05);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(24px) scale(0.96);
		}
	}
	.x {
		position: absolute;
		top: 6px;
		right: 6px;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		color: var(--text-2);
	}
	.x svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
		animation: step-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	@keyframes step-in {
		from {
			opacity: 0;
			transform: translateX(14px);
		}
	}
	h2 {
		margin: 4px 0 0;
		font-size: 19px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	p {
		margin: 0;
		font-size: 14px;
		line-height: 1.55;
		color: var(--text-2);
	}
	p b,
	.rows b.em {
		color: var(--text);
	}
	.lead {
		font-size: 13px;
	}
	/* 첫 장 — 기본 CNSA 뱃지 · 금뱃지가 차례로 톡 */
	.pins {
		display: flex;
		gap: 14px;
		margin: 6px 0 4px;
	}
	.pins span {
		animation: pin-in 0.5s calc(var(--i) * 90ms) cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	@keyframes pin-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.6) rotate(-12deg);
		}
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		text-align: left;
	}
	.rows li {
		display: flex;
		gap: 12px;
		padding: 12px;
		border-radius: 16px;
		background: var(--field);
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-2);
	}
	.rows li > span:last-child b:first-child {
		display: block;
		margin-bottom: 2px;
		font-size: 14px;
		color: var(--text);
	}
	.ic {
		flex: none;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 12px;
		background: var(--surface);
		color: var(--accent);
	}
	.ic.gold {
		color: #b07a06;
	}
	.ic svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ways {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin-top: 4px;
	}
	.way {
		padding: 5px 11px;
		border-radius: 999px;
		background: var(--field);
		font-size: 12px;
		font-weight: 600;
	}
	.way.on {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.way.soon {
		color: var(--text-2);
	}
	.toggles {
		width: 100%;
		max-height: 220px;
		overflow-y: auto;
		padding: 0 8px;
		border-radius: 16px;
		background: var(--field);
	}
	.order {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		margin-top: 4px;
		font-size: 13px;
		font-weight: 600;
		text-align: left;
	}
	/* 고르기 칸 (설정과 같은 모양) */
	.seg {
		flex: none;
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--field);
	}
	.seg-btn {
		position: relative;
		height: 32px;
		padding: 0 13px;
		border-radius: 999px;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.seg-btn::after {
		content: '';
		position: absolute;
		inset: -6px 0;
	}
	.seg-btn.on {
		background: var(--accent-fill);
		color: var(--on-accent);
	}
	/* 마지막 장 — 칸 다섯 (넷째 · 다섯째가 금빛으로 생긴다) */
	.slots {
		display: flex;
		gap: 8px;
		margin: 10px 0 6px;
	}
	.slots i {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #fff6d0, #f5c95a 55%, #c48a0c);
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.18);
		animation: pin-in 0.45s calc(var(--i) * 110ms) cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	.slots i:not(.more) {
		background: var(--field);
		box-shadow: inset 0 0 0 2px var(--line);
	}
	.prog {
		font-size: 13px;
	}
	.dots {
		display: flex;
		justify-content: center;
		gap: 4px;
		margin-top: 16px;
	}
	.dots i {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--line);
		transition:
			width 0.25s,
			background 0.25s;
	}
	.dots i.past {
		background: color-mix(in srgb, var(--accent) 45%, var(--line));
	}
	.dots i.on {
		width: 18px;
		background: var(--accent);
	}
	.btns {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 12px;
	}
	.btns .btn {
		flex: 1;
		height: 46px;
		font-size: 15px;
	}
	.btns .btn.next {
		flex: none;
		width: auto;
		padding: 0 22px;
	}
	.btn.ghost {
		background: var(--field);
		color: var(--text);
		box-shadow: none;
	}
	.prev {
		min-height: 44px;
		padding: 0 12px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>

<script lang="ts">
	/**
	 * 사용법 안내 (튜토리얼, Phase 44 · 89) — 탭마다 그 화면에 처음 오면 한 단계씩: 어디를 누르면 무엇이 되는지 화면의 그 자리를 비춰 주고,
	 * 화면에 없는 규칙은 그림 카드로. 세 가지:
	 *   홈 — 새 대화 찾기 · 익명편지 탭 · 프로필 탭 · 알림 · 설정, 규칙(시간 · 연장 · 공개 · 고정 · 말풍선 · 매너 온도 · 지킬 것)
	 *   프로필 — 이름 카드 · 교복(대표 업적) · 전체 업적 · 소개 · 이야기하고 싶은 상대 → 끝까지 보면 CNSA 뱃지 안내(CnsaBadgeTour)가 이어진다
	 *   익명편지 — 우체통 · 편지 보관함 · 편지 쓰기 · 버리기 · 차단 · 신고 (편지가 열려 있을 때만)
	 * 언제든 "건너뛰기". 끝까지 보거나 건너뛰면 이 기기에 "봤음" (lib/tour.svelte.ts), 설정 › 앱 › "사용법 다시 보기"로 다시.
	 * 저절로 뜨는 창은 한 번에 하나 — 안내가 뜰 차례면(due) 뜨기 전부터 다른 창(업적 축하 · 매너 평가 · 알림 권한)이 기다린다 (lib/tour.svelte.ts 의 touring).
	 * 예전엔 떠 있는 동안만 기다리게 해서, 홈이 그려지고 안내가 뜨기까지 0.6초 사이에 축하 · 알림 안내가 먼저 떠 한꺼번에 겹쳤다.
	 */
	import { focustrap } from '$lib/focustrap';
	import { backClose } from '$lib/overlay.svelte';
	import { S } from '$lib/state.svelte';
	import { TOUR, markTourSeen, tourDue } from '$lib/tour.svelte';
	import { badgeTourSeen, openBadgeTour } from '$lib/badgeTour.svelte';
	import { gateMin, gateOn, lettersState } from '$lib/letters/gate.svelte';
	import MannerTemp from './MannerTemp.svelte';

	type Art = 'hello' | 'timer' | 'reveal' | 'bubbles' | 'temp' | 'rules' | 'letter';
	/** next = 다음 단추 글 (없으면 "다음", 마지막은 "확인") · badges = 끝까지 보면 CNSA 뱃지 안내로 이어진다 */
	type Step = { target?: string; round?: boolean; title: string; body: string; art?: Art; next?: string; badges?: boolean };

	const room = $derived(S.settings?.room_minutes ?? 5);
	const extend = $derived(S.settings?.extend_minutes ?? 10);
	const lettersLocked = $derived(gateOn() && lettersState() !== 'open');

	const HOME = $derived<Step[]>([
		{
			art: 'hello',
			title: '랜디에 온 걸 환영해요',
			body: '이름도 학번도 묻지 않는 우리 학교 익명 대화 앱이에요. 어떻게 쓰는지 하나씩 알려 드릴게요.',
			next: '알려 주세요'
		},
		{
			target: '.dock-action',
			title: '새 대화 찾기',
			body: '누르면 지금 상대를 찾는 학생 중 한 명과 익명으로 이어져요. 화면을 켜 두면 계속 찾아요.'
		},
		{
			art: 'timer',
			title: `첫 대화는 ${room}분`,
			body: `둘 다 대화 화면을 보고 있을 때만 시간이 흘러요. 끝나기 조금 전에 둘 다 원하면 ${extend}분씩 더 이야기할 수 있어요.`
		},
		{
			art: 'reveal',
			title: '연장할 때마다 하나씩',
			body: '연장할 때마다 학년 → 공통 질문 → 디플로마 → 공통 질문 → 동아리 순서로 서로를 조금씩 알게 돼요. 끝까지 가면 둘 다 "고정"해서 시간 제한 없이 이어갈 수 있어요.'
		},
		{
			art: 'bubbles',
			title: '말풍선 다루기',
			body: '길게 누르면 공감 · 답장 · 복사, 두 번 톡 치면 하트, 옆으로 밀면 답장이에요. 대화 목록에서 줄을 길게 누르면 신고 · 차단 · 나가기.'
		},
		{
			art: 'temp',
			title: '매너 온도',
			body: '대화가 끝나면 서로를 익명으로 평가해요. 좋은 대화가 쌓이면 온도가 올라가고, 대화 상대에게 보여요.'
		},
		{
			target: 'a.tab[href="/letters"]',
			title: '익명편지',
			body:
				'학생 이름을 찾아 익명으로 편지를 보내요. 받는 사람에게 나는 성별이나 내가 적은 서명으로만 보여요.' +
				(lettersLocked ? ` 가입한 학생이 ${gateMin()}명 모이면 열려요.` : '')
		},
		{
			target: 'a.tab[href="/me"]',
			title: '프로필과 명성',
			body: '대화 상대에게 보이는 소개 · 관심사 · MBTI를 적어요. 대화하고 편지를 주고받으면 업적이 모이고, 메달을 누르면 얻는 방법이 나와요.'
		},
		{ target: 'button.heart', round: true, title: '알림', body: '새 메시지 · 편지 · 공지가 여기에 모여요.' },
		{
			target: 'button.settings',
			round: true,
			title: '설정',
			body: '화면 · 글자 크기 · 알림 종류를 바꿀 수 있어요. 이 안내도 여기서 다시 볼 수 있어요.'
		},
		{ art: 'rules', title: '이것만 지켜 주세요', body: '', next: '시작하기' }
	]);

	// 프로필 — CNSA 뱃지 안내를 아직 못 본 기기는 마지막 장에서 그 안내로 이어진다 (열 때마다 다시 본다)
	const meSteps = (): Step[] => [
		{
			target: '.who',
			title: '내 프로필',
			body: '익명 이름은 처음에 정해져서 바뀌지 않아요. 매너 온도는 대화가 끝난 뒤 받은 평가로 오르내려요.'
		},
		{
			target: '.dress',
			title: '교복과 대표 업적',
			body: '모은 업적 중 대표로 건 것이 교복 깃에 달려서 대화 상대에게 보여요. 배지를 누르면 얻는 방법이 나오고, 꾹 눌러 끌면 자리를 바꿀 수 있어요.'
		},
		{
			target: '.dress a.all',
			title: '전체 업적',
			body: '대화하고 편지를 주고받으면 업적이 모여요. 여기서 전부 보고 대표 업적을 골라요.'
		},
		{
			target: '.g-card.bio',
			title: '소개 · 관심사 · MBTI',
			body: '대화 상대에게 보이는 건 익명 이름과 여기 적은 것뿐이에요. 고친 뒤에는 아래 "저장"을 눌러 주세요.'
		},
		{
			target: '[aria-labelledby="want-h"]',
			title: '이야기하고 싶은 상대',
			body: '새 대화를 찾을 때 누구와 이어질지 골라요. 언제든 바꿀 수 있어요.'
		},
		...(badgeTourSeen()
			? []
			: [{ title: 'CNSA 뱃지', body: '학교에서 받은 실제 뱃지도 교복에 달 수 있어요. 이어서 알려 드릴게요.', next: '다음', badges: true }])
	];

	const LETTERS: Step[] = [
		{
			art: 'letter',
			title: '익명편지',
			body: '학생 이름을 찾아 익명으로 편지를 보내요. 받는 사람에게 나는 성별이나 내가 적은 서명으로만 보여요.'
		},
		{
			target: '.wall .post',
			title: '우체통',
			body: '새 편지는 우체통으로 와요. 빨간 점이 보이면 눌러서 가장 최근에 온 편지를 꺼내 읽어요.'
		},
		{
			target: '.archive',
			title: '편지 보관함',
			body: '읽은 편지와 보낸 편지가 여기 모여요. 누르면 전부 볼 수 있고, 폴더로 나눠 정리할 수 있어요.'
		},
		{
			target: '.dock-action a.btn',
			title: '편지 쓰기',
			body: '받을 학생을 이름으로 찾아 편지지에 쓰고 봉투에 담아 보내요. 받은 편지에는 답장을 쓸 수 있어요.'
		},
		{
			title: '불편한 편지가 오면',
			body: '봉투를 길게 누르면 버리기 · 차단 · 신고가 나와요. 편지를 받고 싶지 않으면 설정 › 편지에서 "편지 받기"를 꺼 주세요.'
		}
	];

	// ── 언제 띄우나 — due = 지금 화면에서 떠야 하는 안내 (lib/tour.svelte.ts), active = 지금 떠 있는 안내 ──
	const due = $derived(tourDue());
	const active = $derived(TOUR.active);
	let step = $state(0);
	// 화면이 다 그려진 뒤에 살짝 늦게 — 화면을 옮기는 중에 열면 그 이동이 끝나며 뒤로가기 칸(overlay)이 지워져 곧바로 닫힌다
	$effect(() => {
		if (!due || active) return;
		const id = due;
		const t = setTimeout(() => {
			step = 0;
			TOUR.active = id;
		}, 600);
		return () => clearTimeout(t);
	});
	// 떠 있는 채 다른 화면으로 넘어갔으면 접는다 — "봤음"으로 치지 않는다 (다음에 그 탭에 오면 처음부터)
	$effect(() => {
		if (active && due !== active) TOUR.active = null;
	});
	$effect(() => () => void (TOUR.active = null)); // 화면이 통째로 사라질 때

	const STEPS = $derived<Step[]>(active === 'me' ? meSteps() : active === 'letters' ? LETTERS : HOME);

	/** done = 끝까지 봤다 (건너뛰기 · 뒤로가기가 아니다) */
	function finish(done = false) {
		const id = active;
		if (!id) return;
		const badges = done && !!STEPS.at(-1)?.badges;
		TOUR.active = null;
		markTourSeen(id);
		window.scrollTo(0, 0); // 비추려고 내려갔던 화면을 맨 위로
		if (badges) openBadgeTour();
	}
	// 안드로이드 뒤로가기 = 건너뛰기 (저절로 뜨는 창 — 누른 적이 있는 화면에서만 기록을 쌓는다)
	backClose(() => finish(), { auto: true, open: () => !!active });

	const cur = $derived(STEPS[step]);
	const last = $derived(step === STEPS.length - 1);
	const next = () => (last ? finish(true) : (step += 1));
	const prev = () => step > 0 && (step -= 1);

	// ── 비출 자리 — 단계마다 · 화면 크기가 바뀌면 다시 잰다. 자리가 없으면(화면에 안 보임) 가운데 카드로 ──
	let hole = $state<{ x: number; y: number; w: number; h: number; r: number } | null>(null);
	let vh = $state(800);
	function measure() {
		vh = window.innerHeight;
		const sel = STEPS[step]?.target;
		const el = sel ? document.querySelector<HTMLElement>(sel) : null;
		let r = el?.getBoundingClientRect();
		// 화면 밖에 걸쳐 있으면(프로필 아래쪽 카드) 가운데로 끌어온다
		if (el && r && r.width && (r.top < 0 || r.bottom > vh)) {
			el.scrollIntoView({ block: 'center', behavior: 'instant' });
			r = el.getBoundingClientRect();
		}
		if (!el || !r || r.width === 0 || r.bottom < 0 || r.top > vh) {
			hole = null;
			return;
		}
		const pad = STEPS[step].round ? 2 : 6;
		hole = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2, r: STEPS[step].round ? 999 : 18 };
	}
	$effect(() => {
		if (!active) return;
		void step;
		const raf = requestAnimationFrame(measure);
		const late = setTimeout(measure, 350); // 탭바 · 버튼이 늦게 자리를 잡는 경우
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, { passive: true }); // 안내 뒤에서 화면이 밀려도 비춘 자리가 따라간다
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(late);
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure);
		};
	});
	// 비춘 자리가 화면 아래쪽이면 카드는 그 위에, 위쪽이면 아래에. 자리가 커서(교복 · 우체통) 위아래 어디에도 카드가 안 들어가면 화면 아래에 겹쳐 놓는다
	// ponytail: 카드 높이를 재지 않고 어림값으로 본다 — 글이 길어져 카드가 250px 을 넘는 단계가 생기면 실제 높이를 잰다
	const CARD_H = 250;
	const cardAt = $derived.by(() => {
		if (!hole) return 'center';
		const above = hole.y;
		const below = vh - hole.y - hole.h;
		return Math.max(above, below) < CARD_H ? 'over' : above > below ? 'above' : 'below';
	});
</script>

{#if active}
	<div class="tour" role="dialog" aria-modal="true" aria-label="사용법 안내" tabindex="-1" use:focustrap>
		<!-- 비추기 — 자리를 뺀 나머지를 어둡게 (자리가 없으면 전체를 어둡게) -->
		<div
			class="hole"
			class:none={!hole}
			style:left="{hole?.x ?? 0}px"
			style:top="{hole?.y ?? 0}px"
			style:width="{hole?.w ?? 0}px"
			style:height="{hole?.h ?? 0}px"
			style:border-radius="{hole?.r ?? 0}px"
			aria-hidden="true"
		></div>

		<div
			class="card {cardAt}"
			style:top={cardAt === 'below' && hole ? `${hole.y + hole.h + 14}px` : null}
			style:bottom={cardAt === 'above' && hole ? `${vh - hole.y + 14}px` : null}
		>
			{#key step}
				<div class="inner">
					{#if cur.art}
						<div class="art art-{cur.art}" aria-hidden="true">
							{#if cur.art === 'hello'}
								<img src="/icon-192.png" alt="" width="72" height="72" />
							{:else if cur.art === 'letter'}
								<svg viewBox="0 0 96 68" class="env">
									<rect x="2" y="2" width="92" height="64" rx="10" />
									<path d="M6 10l42 32 42-32" />
								</svg>
							{:else if cur.art === 'timer'}
								<svg viewBox="0 0 100 100" class="ring">
									<circle cx="50" cy="50" r="42" class="track" />
									<circle cx="50" cy="50" r="42" class="fill" pathLength="100" />
								</svg>
								<span class="ring-text"><b class="num">{room}</b>분<small class="num">+{extend}분씩</small></span>
							{:else if cur.art === 'reveal'}
								<ol class="path">
									{#each ['학년', '질문', '디플로마', '질문', '동아리'] as t, i (i)}<li style:--i={i}>{t}</li>{/each}
									<li class="pin" style:--i={5}>고정</li>
								</ol>
							{:else if cur.art === 'bubbles'}
								<div class="mini">
									<span class="b them">오늘 급식 뭐였어?</span>
									<span class="b me">카레! <i class="heart">♥</i></span>
									<span class="finger"></span>
								</div>
							{:else if cur.art === 'temp'}
								<div class="temp-art"><MannerTemp temp={42.3} /></div>
							{:else if cur.art === 'rules'}
								<ul class="rules">
									<li><span>🙊</span>이름 · 학번 · 반 · SNS는 <b>묻지도, 말하지도 않기</b></li>
									<li><span>🤝</span>상대가 불편할 말은 하지 않기</li>
									<li><span>🚨</span>불쾌한 일이 있으면 <b>바로 신고하기</b></li>
								</ul>
							{/if}
						</div>
					{/if}
					<h2>{cur.title}</h2>
					{#if cur.body}<p>{cur.body}</p>{/if}
				</div>
			{/key}

			<div class="dots" aria-label="{STEPS.length}단계 중 {step + 1}단계">
				{#each STEPS as _, i (i)}<i class:on={i === step} class:past={i < step}></i>{/each}
			</div>
			<div class="foot">
				<!-- 건너뛰기는 카드 안에 — 화면 위쪽(알림 · 설정)을 비출 때 가리지 않게 -->
				{#if !last}<button class="skip u-tap" onclick={() => finish()}>건너뛰기</button>{:else}<span></span>{/if}
				<div class="btns">
					{#if step > 0}<button class="prev u-tap" onclick={prev}>이전</button>{/if}
					<button class="btn next" onclick={next}>{cur.next ?? (last ? '확인' : '다음')}</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.tour {
		position: fixed;
		inset: 0;
		z-index: 90;
		outline: none;
	}
	/* 비추는 구멍 — 둘레를 크게 어둡게 칠해서 구멍만 밝게 남긴다. 단계를 넘기면 구멍이 미끄러져 옮겨 간다 */
	.hole {
		position: fixed;
		box-shadow:
			0 0 0 3px color-mix(in srgb, #fff 85%, transparent),
			0 0 0 200vmax rgb(12 6 9 / 0.66);
		transition:
			left 0.38s cubic-bezier(0.3, 0.8, 0.25, 1),
			top 0.38s cubic-bezier(0.3, 0.8, 0.25, 1),
			width 0.38s cubic-bezier(0.3, 0.8, 0.25, 1),
			height 0.38s cubic-bezier(0.3, 0.8, 0.25, 1),
			border-radius 0.38s;
		pointer-events: none;
		animation: hole-in 0.3s ease-out;
	}
	.hole.none {
		left: 50% !important;
		top: 50% !important;
		width: 0 !important;
		height: 0 !important;
		box-shadow: 0 0 0 200vmax rgb(12 6 9 / 0.66);
	}
	@keyframes hole-in {
		from {
			opacity: 0;
		}
	}
	.skip {
		min-height: 44px;
		margin-left: -8px;
		padding: 0 8px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
	.card {
		position: fixed;
		left: 50%;
		width: min(360px, calc(100vw - 32px));
		translate: -50% 0;
		padding: 20px 20px 16px;
		border-radius: 26px;
		background: var(--surface);
		box-shadow: var(--shadow-2);
		transition:
			top 0.38s cubic-bezier(0.3, 0.8, 0.25, 1),
			bottom 0.38s cubic-bezier(0.3, 0.8, 0.25, 1);
	}
	.card.center {
		top: 50%;
		translate: -50% -50%;
	}
	.card.over {
		bottom: calc(16px + env(safe-area-inset-bottom));
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
			transform: translateY(8px);
		}
	}
	h2 {
		margin: 0;
		font-size: 19px;
		font-weight: 650;
		letter-spacing: -0.03em;
	}
	p {
		margin: 0;
		font-size: 14px;
		line-height: 1.6;
		color: var(--text-2);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 12px;
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
		gap: 4px;
	}
	.prev {
		min-height: 44px;
		padding: 0 12px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
	.next {
		width: auto;
		height: 46px;
		padding: 0 20px;
		font-size: 15px;
	}

	/* ── 그림 ── */
	.art {
		display: grid;
		place-items: center;
		min-height: 96px;
		margin-bottom: 6px;
	}
	.art-hello img {
		border-radius: 20px;
		box-shadow: var(--glow);
		animation: pop 0.6s cubic-bezier(0.3, 1.5, 0.5, 1);
	}
	@keyframes pop {
		from {
			transform: scale(0.6);
			opacity: 0;
		}
	}
	/* 익명편지 — 봉투 */
	.env {
		width: 96px;
		fill: var(--field);
		stroke: var(--g-coral);
		stroke-width: 4;
		stroke-linecap: round;
		stroke-linejoin: round;
		animation: pop 0.6s cubic-bezier(0.3, 1.5, 0.5, 1);
	}
	/* 시간 — 줄어드는 고리 */
	.art-timer {
		position: relative;
		width: 104px;
		height: 104px;
	}
	.ring {
		position: absolute;
		inset: 0;
		rotate: -90deg;
	}
	.ring circle {
		fill: none;
		stroke-width: 8;
		stroke-linecap: round;
	}
	.ring .track {
		stroke: var(--field);
	}
	.ring .fill {
		stroke: var(--g-coral);
		stroke-dasharray: 100;
		animation: drain 3.2s ease-in-out infinite alternate;
	}
	@keyframes drain {
		from {
			stroke-dashoffset: 0;
		}
		to {
			stroke-dashoffset: 72;
		}
	}
	.ring-text {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1;
		font-weight: 650;
	}
	.ring-text b {
		font-family: var(--display);
		font-size: 34px;
		font-weight: 650;
		background: var(--brand);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.ring-text small {
		margin-top: 4px;
		font-size: 11px;
		color: var(--text-2);
	}
	/* 공개 순서 — 칩이 하나씩 켜진다 */
	.path {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		max-width: 300px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.path li {
		padding: 6px 11px;
		border-radius: 999px;
		background: var(--field);
		font-size: 13px;
		font-weight: 600;
		animation: chip 0.4s calc(var(--i) * 0.18s) both cubic-bezier(0.3, 1.4, 0.5, 1);
	}
	.path li.pin {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	@keyframes chip {
		from {
			opacity: 0;
			transform: scale(0.7);
		}
	}
	/* 말풍선 — 내 말풍선에 하트가 톡 */
	.mini {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 220px;
	}
	.mini .b {
		max-width: 80%;
		padding: 8px 13px;
		border-radius: 18px;
		font-size: 14px;
	}
	.mini .them {
		align-self: flex-start;
		background: var(--field);
	}
	.mini .me {
		position: relative;
		align-self: flex-end;
		background: var(--bubble-fill);
		color: var(--on-accent);
	}
	.heart {
		position: absolute;
		left: -8px;
		bottom: -8px;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: var(--shadow-1);
		color: var(--point-mark);
		font-size: 12px;
		font-style: normal;
		animation: heart 2.4s 0.6s infinite;
	}
	@keyframes heart {
		0%,
		20% {
			transform: scale(0);
		}
		30% {
			transform: scale(1.3);
		}
		40%,
		100% {
			transform: scale(1);
		}
	}
	.finger {
		position: absolute;
		right: 22px;
		bottom: -2px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.18);
		box-shadow: 0 0 0 6px rgb(0 0 0 / 0.06);
		animation: tap 2.4s infinite;
	}
	@keyframes tap {
		0%,
		100% {
			transform: scale(1);
			opacity: 0;
		}
		8%,
		22% {
			opacity: 1;
		}
		12% {
			transform: scale(0.8);
		}
		18% {
			transform: scale(1);
		}
		26% {
			transform: scale(0.8);
			opacity: 1;
		}
		34% {
			opacity: 0;
		}
	}
	.temp-art {
		width: 240px;
	}
	.rules {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
		text-align: left;
	}
	.rules li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 14px;
		background: var(--field);
		font-size: 14px;
		line-height: 1.45;
	}
	.rules span {
		font-size: 18px;
	}
</style>

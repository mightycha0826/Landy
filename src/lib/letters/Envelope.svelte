<script lang="ts" module>
	type Side = 'front' | 'back';
	/** 편지지 위치 — 봉투 안 / 반쯤 나옴 / 거의 다 나옴 */
	type PaperPos = 'in' | 'peek' | 'out';
	/** 항공우편 테두리 색 — brand: 테마 색(보낸 편지) · f: 붉은색(여학생이 보낸 편지) · m: 푸른색(남학생) · x: 성별 없음 */
	type Border = 'brand' | 'f' | 'm' | 'x';
</script>

<script lang="ts">
	/**
	 * 우편 봉투 한 장 (Phase 32 · 35 다시 그림) — 편지함 · 봉투 열기 · 편지 쓰기 연출이 같이 쓴다.
	 *   앞면(front): 항공우편 줄무늬 테두리 · 보내는 사람(From.) · 항공 표시 · 학교 로고 우표 · 소인 · 받는 사람(To.) · 우편번호 칸
	 *   뒷면(back) : 안감 · 편지지 · 양옆/아래 주머니(접힌 선 · 그늘) · 덮개(그림자) · 밀랍 봉인(학교 로고 양각, 덮개 끝에 붙음) · 가장자리 줄무늬
	 * 받은 편지는 보낸 사람의 성별로 테두리 색이 다르다 (border — 여학생 붉은색, 남학생 푸른색).
	 * 크기는 w 하나로 — 안쪽은 전부 em (1em = w / 20) 이라 목록의 작은 봉투와 연출의 큰 봉투가 같은 모양이다.
	 * 움직임은 부모가 상태(side · sealed · stamping · cracked · open · paper)를 바꾸면 CSS 전환으로. 동작 줄이기면 app.css 가 전환을 끈다.
	 *   stamping: 밀랍이 떨어지고 → 놋쇠 도장이 화면 앞에서 내려와 쿵 찍고(밀랍이 눌려 퍼짐 · 충격 파문 · 봉투가 눌림) → 들린다 (1.2s, Phase 40)
	 *   cracked : 봉인이 부르르 떨며 덮개 선을 따라 금이 가고 부스러기가 떨어진다 → open 이면 봉인이 덮개에 붙은 채 함께 들린다 (Phase 40 —
	 *             예전의 "두 쪽으로 갈라져 날아가기"를 대신한다)
	 */
	import '@fontsource/nanum-pen-script/index.css';
	import { LOGO_FACES, LOGO_PATH, LOGO_VIEWBOX } from '$lib/ui/schoolLogo';

	let {
		to,
		toSub = '',
		from,
		date,
		side = 'front',
		sealed = true,
		cracked = false,
		open = false,
		paper = 'in',
		postmark = '',
		glow = false,
		sticker = '',
		stamping = false,
		border = 'brand',
		body = undefined,
		w = 320
	}: {
		to: string;
		toSub?: string;
		from: string;
		date: string;
		side?: Side;
		sealed?: boolean;
		/** 봉인에 금이 감 (봉투를 여는 중) */
		cracked?: boolean;
		open?: boolean;
		paper?: PaperPos;
		postmark?: string;
		glow?: boolean;
		sticker?: string;
		/** 봉인이 막 찍히는 중 — 도장이 내려와 쿵 찍는 움직임 (1.2s) */
		stamping?: boolean;
		border?: Border;
		/** 봉투 안 편지지에 비칠 본문 — 읽는 편지 · 보내는 편지의 첫 줄들 (손글씨). 빈 글이면 빈 줄 편지지, 없으면(목록) 알아볼 수 없는 손글씨 획 */
		body?: string | null;
		w?: number;
	} = $props();

	// 봉투마다 다른 id — 편지함에 봉투가 여러 장이어도 SVG id 가 겹치지 않게
	const uid = $props.id();
	// 밀랍 — 가장자리가 울퉁불퉁하고 아래로 한 방울 흘러내린 모양. 도장 자국(가운데 20, 20.5)을 중심으로 사방이 고르게 (Phase 58 —
	// 예전 모양은 오른쪽으로 2.7 치우쳐 왼쪽 가장자리가 도장 테두리에 닿아 찝혀 잘린 것처럼 보였다)
	const WAX =
		'M37.56 20.5C37.8 21.36 37.5 22.4 37.02 23.2C36.53 23.99 35.26 24.58 34.64 25.26C34.01 25.93 33.6 26.52 33.28 27.26C32.95 28.01 32.92 28.86 32.69 29.72C32.46 30.57 32.34 31.63 31.9 32.4C31.46 33.17 30.82 33.95 30.04 34.32C29.25 34.69 28.06 34.42 27.19 34.62C26.33 34.81 25.62 34.98 24.87 35.48C24.12 35.98 23.52 36.98 22.71 37.61C21.9 38.24 20.95 38.96 20 39.26C19.05 39.56 17.8 40.11 17 39.41C16.21 38.72 15.99 35.83 15.26 35.1C14.52 34.37 13.49 35.15 12.59 35.04C11.69 34.93 10.65 34.85 9.87 34.44C9.1 34.03 8.38 33.34 7.93 32.57C7.48 31.8 7.47 30.65 7.18 29.82C6.88 28.98 6.69 28.24 6.16 27.55C5.62 26.87 4.4 26.45 3.97 25.71C3.54 24.97 3.37 23.97 3.57 23.1C3.77 22.23 4.92 21.33 5.16 20.5C5.4 19.67 5.24 19 5.02 18.13C4.79 17.25 3.93 16.17 3.82 15.24C3.72 14.32 3.97 13.32 4.41 12.55C4.85 11.79 5.71 11.18 6.48 10.67C7.24 10.16 8.24 9.92 8.99 9.49C9.74 9.06 10.41 8.73 11 8.11C11.58 7.48 11.84 6.32 12.48 5.75C13.13 5.18 14 4.7 14.86 4.67C15.71 4.64 16.78 5.52 17.63 5.57C18.49 5.62 19.15 5.36 20 4.97C20.85 4.58 21.83 3.42 22.73 3.24C23.63 3.05 24.65 3.37 25.41 3.86C26.17 4.35 26.71 5.45 27.3 6.17C27.89 6.9 28.33 7.64 28.92 8.23C29.51 8.81 30.09 9.24 30.84 9.66C31.58 10.09 32.69 10.24 33.39 10.77C34.09 11.3 34.79 12.02 35.02 12.84C35.26 13.67 34.69 14.83 34.78 15.7C34.87 16.56 35.11 17.23 35.57 18.03C36.03 18.83 37.32 19.64 37.56 20.5z';
</script>

<div class="env b-{border}" class:show-back={side === 'back'} class:glow class:thud={stamping} style:--w="{w}px" aria-hidden="true">
	<!-- 앞면 (주소 쪽) -->
	<div class="face front">
		<div class="inner grain">
			<i class="show-through"></i>

			<div class="from-block">
				<span class="lbl">보내는 사람</span>
				<span class="from-line"><span class="en">From.</span> <span class="hand">{from}</span></span>
				<span class="avion">
					<svg viewBox="0 0 24 24"><path d="M21 15.5v-2l-8-5V3.8a1.5 1.5 0 0 0-3 0v4.7l-8 5v2l8-2.5v4.6L7.5 19v1.5L11.5 19l4 1.5V19L13 17.6V13z" fill="currentColor" /></svg>
					항공 · PAR AVION
				</span>
			</div>

			<!-- 우표 — 톱니 가장자리 · 학교 로고 · 액면가 -->
			<div class="stamp">
				<div class="stamp-art">
					<svg class="logo" viewBox={LOGO_VIEWBOX}>
						{#each LOGO_FACES as f (f.d)}<path d={f.d} fill={f.fill} />{/each}
					</svg>
					<span class="s-name">CNSA</span>
					<span class="s-val num">430</span>
				</div>
			</div>

			<!-- 소인 — 물결 줄 + 이중 원 (학교 로고 · 날짜) -->
			<div class="postmark">
				<svg class="waves" viewBox="0 0 60 22">
					<path d="M0 3q5-4 10 0t10 0 10 0 10 0 10 0 10 0M0 9q5-4 10 0t10 0 10 0 10 0 10 0 10 0M0 15q5-4 10 0t10 0 10 0 10 0 10 0 10 0M0 21q5-4 10 0t10 0 10 0 10 0 10 0 10 0" fill="none" stroke="currentColor" stroke-width="1.3" />
				</svg>
				<div class="ring">
					<small>CNSA POST</small>
					<b class="num">{postmark || date}</b>
					<svg class="pm-logo" viewBox={LOGO_VIEWBOX}><path d={LOGO_PATH} fill="currentColor" /></svg>
				</div>
			</div>

			<div class="to-block">
				<span class="lbl">받는 사람</span>
				<span class="to-line">
					<span class="en">To.</span>
					<span class="hand big">{to}</span>
					{#if toSub}<span class="sub">{toSub}</span>{/if}
				</span>
				<i class="rule"></i>
				<i class="rule short"></i>
				<span class="zip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
			</div>

			{#if sticker}<span class="sticker">{sticker}</span>{/if}
		</div>
	</div>

	<!-- 뒷면 (덮개 쪽) -->
	<div class="face back" class:open data-paper={paper}>
		<div class="wall"></div>
		<!-- 봉투 안의 편지지 — 읽는 편지지(.letter-paper)를 줄인 모양: 종이 결 · 바랜 가장자리 · 두 줄 여백선 · 테마 색 줄 ·
		     마스킹 테이프 · 학교 로고 물자국, 그리고 세 번 접었던 자국. To. · From. 은 봉투와 같은 손글씨,
		     본문은 편지의 첫 줄들(꺼내 펼치면 그대로 이어진다) — 본문을 모르는 곳(목록)에서는 알아볼 수 없는 손글씨 획 -->
		<div class="paper-in">
			<span class="tape"></span>
			<span class="pi-head">
				<span class="pi-to"><span class="en">To.</span> <span class="hand">{to}</span></span>
				<span class="pi-date num">{date}</span>
			</span>
			<span class="pi-lines">
				{#if body === undefined}<i></i><i></i><i></i><i></i><i></i>{:else}<span class="pi-text">{body}</span>{/if}
			</span>
			<span class="pi-from">
				<svg class="doodle" viewBox="0 0 24 24"><path d="M12 19.5c-3.8-2.6-7.4-5.6-7.4-9.2 0-2.3 1.8-4 3.9-4 1.5 0 2.7.8 3.5 2.1.8-1.3 2-2.1 3.5-2.1 2.1 0 3.9 1.7 3.9 4 0 3.6-3.6 6.6-7.4 9.2z" /></svg>
				<span class="en">From.</span> <span class="hand">{from}</span>
			</span>
			<svg class="pi-logo" viewBox={LOGO_VIEWBOX}><path d={LOGO_PATH} /></svg>
		</div>
		<div class="pocket grain">
			<i class="side l"></i>
			<i class="side r"></i>
			<i class="bottom"></i>
			<span class="back-date num">{date}</span>
			<span class="back-from"><span class="en">From.</span> <span class="hand">{from}</span></span>
		</div>
		<div class="flap">
			<!-- 덮개 그림자는 덮개 면에만 — 덮개(.flap)에 걸면 사파리가 덮개 끝 아래로 내려온 봉인 · 도장 · 파문을 잘랐다 (Phase 58) -->
			<div class="flap-shade"><div class="flap-face"></div></div>
			<!-- 밀랍 봉인 — 덮개 끝에 붙어 있다. 열면 금이 간 채로 덮개와 함께 들린다 (Phase 40) -->
			{#if sealed}
				<div class="seal" class:cracked class:stamping>
					<div class="wax">
						<svg viewBox="0 0 40 44">
							<defs>
								<radialGradient id="wax-{uid}" cx="36%" cy="30%" r="75%">
									<stop offset="0" stop-color="#e2455f" />
									<stop offset=".45" stop-color="#b8142f" />
									<stop offset="1" stop-color="#6d0718" />
								</radialGradient>
								<radialGradient id="pool-{uid}" cx="50%" cy="50%" r="50%">
									<stop offset=".7" stop-color="#000" stop-opacity="0" />
									<stop offset="1" stop-color="#000" stop-opacity=".28" />
								</radialGradient>
								<!-- 금은 밀랍 안에만 (밀랍 밖 봉투 위로 삐져나오지 않게) -->
								<clipPath id="waxclip-{uid}"><path d={WAX} /></clipPath>
							</defs>
							<path d={WAX} fill="url(#wax-{uid})" />
							<!-- 눌러 찍은 자리 — 가운데가 살짝 꺼지고 테두리가 솟는다 (찍히는 순간 나타난다) -->
							<g class="emboss">
								<circle cx="20" cy="20.5" r="11.8" fill="url(#pool-{uid})" />
								<circle cx="20" cy="20.5" r="11.8" fill="none" stroke="rgb(255 190 200 / .35)" stroke-width=".7" />
								<circle cx="20" cy="20.5" r="10.4" fill="none" stroke="rgb(70 0 12 / .35)" stroke-width=".6" />
								<!-- 학교 로고 양각: 밝은 윤곽을 살짝 위에, 어두운 면을 그 위에 -->
								<g transform="translate(13.2 12.6) scale(.068)">
									<path d={LOGO_PATH} fill="rgb(255 200 208 / .45)" transform="translate(-10 -12)" />
									<path d={LOGO_PATH} fill="rgb(92 0 18 / .6)" />
								</g>
							</g>
							<!-- 빛 반사 -->
							<ellipse cx="15" cy="12" rx="4.2" ry="2" fill="#fff" opacity=".28" transform="rotate(-24 15 12)" />
							<!-- 덮개 선을 따라 가는 금 — 봉투를 열 때 그어진다 -->
							<g class="crack" fill="none" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#waxclip-{uid})">
								<path d="M3.5 21.6l4.6-1.4 3.1 2.2 4.4-2.6 3.6 1.9 3.9-1.7 3.4 2.3 4.2-2 3.6 1.3 3.2-.8" pathLength="1" stroke="rgb(255 185 195 / .45)" stroke-width="1.1" transform="translate(0 .7)" />
								<path d="M3.5 21.6l4.6-1.4 3.1 2.2 4.4-2.6 3.6 1.9 3.9-1.7 3.4 2.3 4.2-2 3.6 1.3 3.2-.8" pathLength="1" stroke="#3a0310" stroke-width=".9" />
							</g>
						</svg>
					</div>
					<!-- 금이 갈 때 떨어지는 밀랍 부스러기 -->
					<i class="crumb c1"></i><i class="crumb c2"></i><i class="crumb c3"></i>
					{#if stamping}
						<!-- 봉인 도장 — 위(화면 앞)에서 내려와 쿵 찍고 들린다. 그림자가 가까워질수록 작고 진해진다 -->
						<i class="shock"></i>
						<i class="stamp-shadow"></i>
						<svg class="stamper" viewBox="0 0 40 40">
							<defs>
								<radialGradient id="brass-{uid}" cx="34%" cy="28%" r="78%">
									<stop offset="0" stop-color="#fff3c4" />
									<stop offset=".3" stop-color="#e6bb5c" />
									<stop offset=".72" stop-color="#a8752a" />
									<stop offset="1" stop-color="#5f3f10" />
								</radialGradient>
								<radialGradient id="wood-{uid}" cx="38%" cy="32%" r="72%">
									<stop offset="0" stop-color="#b98356" />
									<stop offset=".55" stop-color="#6e3f22" />
									<stop offset="1" stop-color="#3a1f0d" />
								</radialGradient>
							</defs>
							<circle cx="20" cy="20" r="19.4" fill="url(#brass-{uid})" />
							<circle cx="20" cy="20" r="16.2" fill="none" stroke="rgb(80 50 8 / .5)" stroke-width=".8" />
							<circle cx="20" cy="20" r="12.6" fill="url(#wood-{uid})" />
							<ellipse cx="15.6" cy="13.8" rx="4.6" ry="2.5" fill="#fff" opacity=".32" transform="rotate(-32 15.6 13.8)" />
						</svg>
					{/if}
				</div>
			{/if}
		</div>
		<i class="edge"></i>
	</div>
</div>

<style>
	.env {
		--w: 320px;
		--s1: var(--g-orange);
		--s2: var(--g-pink);
		position: relative;
		width: var(--w);
		height: calc(var(--w) * 0.62);
		font-size: calc(var(--w) / 20);
		transform-style: preserve-3d;
		transform: rotateY(0deg);
		transition: transform 0.8s cubic-bezier(0.34, 0.8, 0.26, 1);
		color: var(--env-ink);
	}
	/* 항공우편 테두리 — 받은 편지는 보낸 사람 성별로 */
	.b-f {
		--s1: #d8313b;
		--s2: #9d1830;
	}
	.b-m {
		--s1: #2f6fd6;
		--s2: #173f8c;
	}
	.env.show-back {
		transform: rotateY(180deg);
	}
	.face {
		position: absolute;
		inset: 0;
		border-radius: 0.3em;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
	}
	.back {
		transform: rotateY(180deg);
	}
	.env.glow .face {
		box-shadow:
			0 0 0 0.08em color-mix(in srgb, var(--s1) 55%, transparent),
			0 0.35em 1.4em color-mix(in srgb, var(--s1) 38%, transparent),
			0 0.1em 0.4em rgb(0 0 0 / 0.12);
	}

	/* ── 앞면 ── */
	.front {
		/* 항공우편 줄무늬 테두리 */
		background: repeating-linear-gradient(
			-45deg,
			var(--s1) 0 0.9em,
			var(--env-paper) 0.9em 1.35em,
			var(--s2) 1.35em 2.25em,
			var(--env-paper) 2.25em 2.7em
		);
		box-shadow:
			0 0.3em 1em -0.1em rgb(40 20 10 / 0.22),
			0 0.06em 0.15em rgb(40 20 10 / 0.14);
	}
	.inner {
		position: absolute;
		inset: 0.42em;
		border-radius: 0.12em;
		overflow: hidden;
		box-shadow: inset 0 0 0.9em rgb(120 90 50 / 0.1);
	}
	/* 종이 결 — 아주 옅은 잡음 + 가장자리가 살짝 바랜 빛 */
	.grain {
		background-image:
			url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .25 0 0 0 0 .2 0 0 0 0 .15 0 0 0 .09 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"),
			radial-gradient(130% 120% at 30% 20%, rgb(255 255 255 / 0.35), transparent 60%),
			linear-gradient(var(--env-paper), var(--env-paper));
	}
	/* 뒷면 덮개 모양이 종이 너머로 아주 옅게 비친다 */
	.show-through {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(to bottom right, transparent calc(50% - 0.03em), rgb(80 60 40 / 0.05) 50%, transparent calc(50% + 0.03em)) left top / 50% 62% no-repeat,
			linear-gradient(to bottom left, transparent calc(50% - 0.03em), rgb(80 60 40 / 0.05) 50%, transparent calc(50% + 0.03em)) right top / 50% 62% no-repeat;
		pointer-events: none;
	}
	.lbl {
		display: block;
		font-size: 0.46em;
		font-weight: 650;
		letter-spacing: 0.1em;
		opacity: 0.55;
	}
	/* From. · To. 머리말 (Phase 43) — 예전(0.6em · 옅게 0.55)은 휴대폰에서 거의 안 보였다 */
	.en {
		font-size: 0.68em;
		font-weight: 650;
		letter-spacing: 0.03em;
		opacity: 0.75;
	}
	/* 이름 손글씨 (Phase 43) — 나눔펜은 획이 가늘고 글자가 작게 그려져서 한 단계 크게 · 잉크를 조금 굵게.
	   줄 높이는 1 이 아니라 여유 있게 — 나눔펜 받침은 글자 칸 아래로 내려가서, 1 이면 overflow: hidden 에 받침이 잘렸다 ("학생" → "학새") */
	.hand {
		font-family: var(--hand);
		font-size: 1.45em;
		line-height: 1.3;
		-webkit-text-stroke: 0.022em currentColor;
	}
	.hand.big {
		font-size: 1.9em;
	}
	.from-block {
		position: absolute;
		top: 0.7em;
		left: 0.85em;
		display: flex;
		flex-direction: column;
		gap: 0.18em;
		max-width: 52%;
	}
	.from-line {
		display: flex;
		align-items: baseline;
		gap: 0.3em;
		white-space: nowrap;
		overflow: hidden;
		padding-bottom: 0.12em;
		border-bottom: 0.05em dashed var(--env-line);
	}
	.avion {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		margin-top: 0.3em;
		padding: 0.14em 0.45em 0.14em 0.35em;
		border: 0.07em solid var(--s2);
		border-radius: 0.2em;
		color: var(--s2);
		font-size: 0.46em;
		font-weight: 650;
		letter-spacing: 0.08em;
		transform: rotate(-1.5deg);
		opacity: 0.85;
	}
	.avion svg {
		width: 1.25em;
		height: 1.25em;
		transform: rotate(45deg);
	}

	/* 우표 — 톱니 가장자리 (가운데는 꽉 채우고 여백에만 둥근 구멍) */
	.stamp {
		position: absolute;
		top: 0.55em;
		right: 0.65em;
		width: 3em;
		height: 3.55em;
		padding: 0.24em;
		background: #fffdf8;
		transform: rotate(3deg);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			radial-gradient(circle, transparent 0.11em, #000 0.12em) 0 0 / 0.44em 0.44em round;
		mask:
			linear-gradient(#000 0 0) content-box,
			radial-gradient(circle, transparent 0.11em, #000 0.12em) 0 0 / 0.44em 0.44em round;
		filter: drop-shadow(0 0.05em 0.1em rgb(0 0 0 / 0.25));
	}
	.stamp-art {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		padding-top: 0.1em;
		/* 하늘 — 로고가 떠 있는 옅은 새벽빛 */
		background:
			radial-gradient(120% 70% at 50% 110%, color-mix(in srgb, var(--s1) 30%, transparent), transparent 70%),
			linear-gradient(180deg, #eaf6fd, #fff4ec);
		box-shadow: inset 0 0 0 0.06em rgb(1 64 153 / 0.35);
		color: #014099;
	}
	.stamp-art .logo {
		width: 1.35em;
		height: 1.55em;
		filter: drop-shadow(0 0.04em 0.05em rgb(1 40 90 / 0.3));
	}
	.s-name {
		margin-top: 0.12em;
		font-size: 0.34em;
		font-weight: 650;
		letter-spacing: 0.14em;
	}
	.s-val {
		position: absolute;
		top: 0.14em;
		left: 0.18em;
		font-size: 0.3em;
		font-weight: 650;
	}
	/* 소인 — 우표 위에 비스듬히 찍힌 잉크 */
	.postmark {
		position: absolute;
		top: 1em;
		right: 2.1em;
		display: flex;
		align-items: center;
		color: rgb(40 30 60 / 0.62);
		transform: rotate(-10deg);
		mix-blend-mode: multiply;
		pointer-events: none;
	}
	.waves {
		width: 3.3em;
		height: 1.2em;
		margin-right: -0.25em;
	}
	.ring {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 3em;
		height: 3em;
		border-radius: 50%;
		border: 0.1em solid currentColor;
		box-shadow:
			inset 0 0 0 0.14em transparent,
			inset 0 0 0 0.2em currentColor;
		line-height: 1;
	}
	.ring small {
		font-size: 0.3em;
		font-weight: 650;
		letter-spacing: 0.06em;
	}
	.ring b {
		margin: 0.1em 0 0.06em;
		font-size: 0.66em;
		font-weight: 650;
	}
	.pm-logo {
		width: 0.5em;
		height: 0.58em;
	}
	.to-block {
		position: absolute;
		left: 36%;
		right: 0.85em;
		bottom: 0.55em;
		display: flex;
		flex-direction: column;
	}
	.to-line {
		display: flex;
		align-items: baseline;
		gap: 0.35em;
		min-width: 0;
	}
	.to-line .big {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.sub {
		flex: none;
		font-size: 0.56em;
		font-weight: 600;
		opacity: 0.6;
	}
	.rule {
		height: 0;
		margin-top: 0.2em;
		border-bottom: 0.05em dashed var(--env-line);
	}
	.rule.short {
		width: 72%;
		margin-top: 0.62em;
	}
	/* 우편번호 칸 — 한국 편지 봉투의 빨간 네모 다섯 개 */
	.zip {
		display: flex;
		align-self: flex-end;
		gap: 0.14em;
		margin-top: 0.4em;
	}
	.zip i {
		width: 0.62em;
		height: 0.72em;
		border: 0.06em solid rgb(214 48 60 / 0.6);
	}
	/* 읽음 · 답장 옴 — 고무 도장 */
	.sticker {
		position: absolute;
		left: 0.8em;
		bottom: 0.8em;
		padding: 0.18em 0.5em;
		border: 0.12em double currentColor;
		border-radius: 0.25em;
		color: color-mix(in srgb, var(--s2) 85%, #000);
		font-size: 0.62em;
		font-weight: 650;
		letter-spacing: 0.08em;
		transform: rotate(-8deg);
		mix-blend-mode: multiply;
		opacity: 0.85;
	}

	/* ── 뒷면 ── */
	.wall {
		position: absolute;
		inset: 0;
		border-radius: 0.3em;
		/* 안감 — 잔 무늬 종이 (덮개를 열면 보인다) */
		background:
			radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--s1) 35%, transparent) 0.06em, transparent 0.07em) 0 0 / 0.55em 0.55em,
			radial-gradient(circle at 75% 75%, color-mix(in srgb, var(--s2) 30%, transparent) 0.06em, transparent 0.07em) 0 0 / 0.55em 0.55em,
			linear-gradient(160deg, #fbe7e2, #f3dbe6);
		box-shadow:
			0 0.3em 1em -0.1em rgb(40 20 10 / 0.22),
			0 0.06em 0.15em rgb(40 20 10 / 0.14);
	}
	/* ── 봉투 안의 편지지 — 꺼내 펼치면 되는 읽는 편지지(app.css .letter-paper)와 같은 종이를 봉투 크기로 ──
	   종이는 봉투처럼 다크 모드에서도 밝은 미색 그대로 */
	.paper-in {
		--pi-ink: #2b2620;
		--pi-edge: #efe4cf;
		--pi-rule: color-mix(in srgb, var(--accent) 16%, rgb(90 70 50 / 0.14));
		--pi-margin: color-mix(in srgb, var(--accent) 40%, transparent);
		--pi-line: 1.15em;
		position: absolute;
		left: 0.9em;
		right: 0.9em;
		top: 0.5em;
		height: 88%;
		display: flex;
		flex-direction: column;
		padding: 1em 0.95em 0.7em 1.75em;
		border-radius: 0.18em;
		color: var(--pi-ink);
		text-align: left;
		background-color: #fffaf0;
		background-image:
			/* 세 번 접었던 자국 — 1/3 은 골(그늘 → 빛), 2/3 은 마루(빛 → 그늘) */
			linear-gradient(180deg, transparent calc(33.3% - 0.4em), rgb(90 60 30 / 0.07) calc(33.3% - 0.03em), rgb(255 255 255 / 0.75) 33.3%, transparent calc(33.3% + 0.35em)),
			linear-gradient(180deg, transparent calc(66.6% - 0.35em), rgb(255 255 255 / 0.65) 66.6%, rgb(90 60 30 / 0.08) calc(66.6% + 0.03em), transparent calc(66.6% + 0.4em)),
			/* 두 줄 여백선 (테마 색) */
			linear-gradient(90deg, transparent 1.05em, var(--pi-margin) 1.05em 1.1em, transparent 1.1em 1.25em, var(--pi-margin) 1.25em 1.3em, transparent 1.3em),
			/* 가장자리가 살짝 바랜 빛 */
			radial-gradient(140% 100% at 50% 35%, transparent 55%, color-mix(in srgb, var(--pi-edge) 75%, transparent)),
			/* 종이 결 */
			url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42 0 0 0 0 .32 0 0 0 0 .22 0 0 0 .08 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
		background-size: auto, auto, auto, auto, 6em;
		box-shadow:
			0 0 0 0.04em var(--pi-edge),
			0 0.1em 0.4em rgb(0 0 0 / 0.15);
		transform: translateY(0);
		transition: transform 0.75s cubic-bezier(0.22, 0.9, 0.3, 1);
		z-index: 2;
	}
	/* 마스킹 테이프 — 반투명 테마 색 · 사선 무늬 · 양 끝은 손으로 뜯은 톱니 (읽는 편지지와 같은 조각) */
	.tape {
		position: absolute;
		top: -0.38em;
		left: 50%;
		width: 4.4em;
		height: 1em;
		translate: -50% 0;
		rotate: -2.5deg;
		background:
			repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.22) 0 0.22em, transparent 0.22em 0.44em),
			var(--accent-fill);
		opacity: 0.75;
		box-shadow: 0 0.04em 0.1em rgb(0 0 0 / 0.12);
		clip-path: polygon(0 8%, 4% 0, 8% 10%, 12% 0, 88% 0, 92% 12%, 96% 0, 100% 10%, 100% 92%, 96% 100%, 92% 88%, 88% 100%, 12% 100%, 8% 90%, 4% 100%, 0 90%);
	}
	.pi-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5em;
	}
	.pi-to,
	.pi-from {
		display: flex;
		align-items: baseline;
		gap: 0.3em;
		min-width: 0;
		white-space: nowrap;
	}
	.pi-to .hand,
	.pi-from .hand {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pi-date {
		flex: none;
		font-size: 0.5em;
		font-weight: 600;
		opacity: 0.5;
	}
	/* 본문 — 테마 색 줄 위에 알아볼 수 없는 손글씨 획 (봉투를 열기 전에는 내용이 보이지 않게). 줄마다 길이 · 시작점이 다르다 */
	.pi-lines {
		flex: 1;
		display: flex;
		flex-direction: column;
		margin: 0.2em -0.95em 0 -1.75em;
		padding: 0 0.95em 0 1.75em;
		overflow: hidden;
		background-image: repeating-linear-gradient(to bottom, transparent 0 calc(var(--pi-line) - 0.05em), var(--pi-rule) calc(var(--pi-line) - 0.05em) var(--pi-line));
	}
	/* 편지의 첫 줄들 — 읽는 편지지와 같은 손글씨, 줄 높이 = 줄 간격이라 글줄이 줄 위에 앉는다. 넘치는 뒷부분은 접힌 종이 속으로 */
	.pi-text {
		font-family: var(--hand);
		font-size: 0.86em;
		line-height: calc(var(--pi-line) / 0.86);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: color-mix(in srgb, var(--pi-ink) 88%, transparent);
		/* 손글씨 글꼴은 글자가 줄 칸 위쪽에 떠 있다 — 조금 내려 줄 위에 앉힌다 */
		translate: 0 0.32em;
	}
	.pi-lines i {
		flex: none;
		height: var(--pi-line);
		background: color-mix(in srgb, var(--pi-ink) 42%, transparent);
		-webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 10'%3E%3Cpath d='M1 6.5c1.4-3.2 2.9-3.4 3.4-.4s1.8 3.1 2.9.3 1.6-3.8 3.1-.8 1.1 3.2 2.7.6 1.3-2.4 2.6-.2M19 6.2c1.1-2.8 2.6-3.3 3.5-.6s1.6 3 3 .4 2.1-3.3 3.1-.6 1.4 2.8 3 .2 1.2-1.9 2.4.1M37 6.4c1.3-3 2.7-3.1 3.2 0s1.5 2.9 2.8.3 1.7-2.6 3.3-.3' fill='none' stroke='black' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 0 92% / 3.9em 0.7em repeat-x;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 10'%3E%3Cpath d='M1 6.5c1.4-3.2 2.9-3.4 3.4-.4s1.8 3.1 2.9.3 1.6-3.8 3.1-.8 1.1 3.2 2.7.6 1.3-2.4 2.6-.2M19 6.2c1.1-2.8 2.6-3.3 3.5-.6s1.6 3 3 .4 2.1-3.3 3.1-.6 1.4 2.8 3 .2 1.2-1.9 2.4.1M37 6.4c1.3-3 2.7-3.1 3.2 0s1.5 2.9 2.8.3 1.7-2.6 3.3-.3' fill='none' stroke='black' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 0 92% / 3.9em 0.7em repeat-x;
	}
	.pi-lines i:nth-child(1) {
		width: 88%;
	}
	.pi-lines i:nth-child(2) {
		width: 96%;
		-webkit-mask-position: -1.4em 92%;
		mask-position: -1.4em 92%;
	}
	.pi-lines i:nth-child(3) {
		width: 74%;
		-webkit-mask-position: -2.5em 92%;
		mask-position: -2.5em 92%;
	}
	.pi-lines i:nth-child(4) {
		width: 92%;
		-webkit-mask-position: -0.8em 92%;
		mask-position: -0.8em 92%;
	}
	.pi-lines i:nth-child(5) {
		width: 46%;
		-webkit-mask-position: -3.1em 92%;
		mask-position: -3.1em 92%;
	}
	.pi-from {
		align-self: flex-end;
		max-width: 80%;
		margin-top: 0.15em;
	}
	/* 서명 옆 작은 하트 낙서 — 테마 색 펜 */
	.doodle {
		flex: none;
		width: 0.85em;
		height: 0.85em;
		align-self: center;
		fill: none;
		stroke: var(--accent);
		stroke-width: 2.2;
		stroke-linejoin: round;
		rotate: -12deg;
		opacity: 0.8;
	}
	/* 오른쪽 아래 학교 로고 물자국 */
	.pi-logo {
		position: absolute;
		right: 1em;
		bottom: 1.9em;
		width: 2.6em;
		height: 3em;
		fill: #8a6f55;
		opacity: 0.08;
		pointer-events: none;
	}
	.back[data-paper='peek'] .paper-in {
		transform: translateY(-42%);
	}
	.back[data-paper='out'] .paper-in {
		transform: translateY(-80%);
	}
	/* 앞주머니 — 양옆 날개 · 아래 날개가 가운데로 모인 모양 (각 날개에 접힌 그늘) */
	.pocket {
		position: absolute;
		inset: 0;
		border-radius: 0.3em;
		clip-path: polygon(0 0, 50% 56%, 100% 0, 100% 100%, 0 100%);
		z-index: 3;
	}
	.side,
	.bottom {
		position: absolute;
		inset: 0;
	}
	.side.l {
		clip-path: polygon(0 0, 50% 56%, 0 100%);
		background: linear-gradient(90deg, rgb(255 255 255 / 0.12), rgb(90 60 30 / 0.1));
	}
	.side.r {
		clip-path: polygon(100% 0, 50% 56%, 100% 100%);
		background: linear-gradient(270deg, rgb(255 255 255 / 0.1), rgb(90 60 30 / 0.12));
	}
	/* 아래 날개 — 가장 위에 겹쳐 조금 밝고, 접힌 선을 따라 그늘이 진다 */
	.bottom {
		clip-path: polygon(0 100%, 50% 44%, 100% 100%);
		background:
			linear-gradient(180deg, rgb(90 60 30 / 0.14), transparent 22%),
			linear-gradient(0deg, rgb(255 255 255 / 0.2), transparent 60%),
			var(--env-paper);
		filter: drop-shadow(0 -0.05em 0.08em rgb(0 0 0 / 0.1));
	}
	.back-date {
		position: absolute;
		left: 1em;
		bottom: 0.9em;
		font-size: 0.55em;
		font-weight: 650;
		letter-spacing: 0.06em;
		opacity: 0.45;
	}
	.back-from {
		position: absolute;
		right: 1em;
		bottom: 0.75em;
		display: flex;
		align-items: baseline;
		gap: 0.3em;
		max-width: 56%;
		white-space: nowrap;
		overflow: hidden;
	}
	/* 덮개 — 위에서 접혀 내려와 봉인된다 (아래 주머니에 그림자). 열면 위로 넘어가고, 반쯤 넘어간 때부터 편지지 뒤로 */
	.flap {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 62%;
		transform-origin: 50% 0;
		transform: perspective(40em) rotateX(0deg);
		transition:
			transform 0.7s cubic-bezier(0.45, 0.05, 0.25, 1),
			z-index 0s 0.33s;
		z-index: 4;
	}
	.flap-shade {
		position: absolute;
		inset: 0;
		filter: drop-shadow(0 0.12em 0.12em rgb(60 30 10 / 0.22));
		transition: filter 0s 0.33s;
	}
	.back.open .flap-shade {
		filter: none;
	}
	.flap-face {
		position: absolute;
		inset: 0;
		border-radius: 0.3em 0.3em 0 0;
		clip-path: polygon(0 0, 100% 0, 53.5% 95%, 50% 100%, 46.5% 95%);
		background:
			linear-gradient(180deg, transparent 70%, rgb(90 60 30 / 0.1)),
			linear-gradient(180deg, var(--env-shade), var(--env-paper) 75%);
		transition: background 0s 0.33s;
	}
	.back.open .flap {
		transform: perspective(40em) rotateX(180deg);
		z-index: 1;
	}
	.back.open .flap-face {
		background:
			radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--s1) 35%, transparent) 0.06em, transparent 0.07em) 0 0 / 0.55em 0.55em,
			linear-gradient(0deg, #fbe7e2, #f3dbe6);
	}
	/* 가장자리 줄무늬 — 받은 편지는 보낸 사람 성별 색. 덮개를 열면 옅어진다 */
	.edge {
		position: absolute;
		inset: 0;
		border-radius: 0.3em;
		padding: 0.3em;
		background: repeating-linear-gradient(-45deg, var(--s1) 0 0.9em, transparent 0.9em 1.35em, var(--s2) 1.35em 2.25em, transparent 2.25em 2.7em);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask-composite: exclude;
		opacity: 0.92;
		transition: opacity 0.3s;
		pointer-events: none;
		z-index: 5;
	}
	.back.open .edge {
		opacity: 0;
	}
	.b-brand .edge {
		opacity: 0;
	}
	/* ── 밀랍 봉인 — 덮개 끝(뾰족한 곳)에 붙어 있다. 덮개가 열리면 함께 들리고, 반쯤 넘어가면 덮개 뒤로 사라진다 ── */
	.seal {
		position: absolute;
		left: 50%;
		top: 100%;
		width: 3.2em;
		height: 3.52em;
		margin: -2em 0 0 -1.6em;
		transition:
			transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
			opacity 0s;
	}
	.back.open .seal {
		opacity: 0;
		transition-delay: 0s, 0.33s;
	}
	.wax {
		position: absolute;
		inset: 0;
		/* 밀랍 동그라미의 가운데 (viewBox 40×44 에서 20, 20.5) */
		transform-origin: 50% 46.6%;
		/* 그림자는 밀랍에만 (Phase 58) — 봉인 칸(.seal) 전체에 걸면 사파리가 칸 밖으로 나오는 놋쇠 도장 · 충격 파문을 칸 경계에서 잘랐다 */
		filter: drop-shadow(0 0.1em 0.12em rgb(70 0 15 / 0.4));
	}
	.wax svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* 찍기 (1.2s) — 0~20% 녹은 밀랍이 떨어져 퍼지고 · 30% 도장이 다가와 · 37% 살짝 들었다가 · 45% 쿵 · 60% 누른 채 · 85% 들려 사라진다 */
	.seal.stamping .wax {
		animation: pour 1.2s both;
	}
	@keyframes pour {
		0% {
			transform: scale(0.25);
			opacity: 0;
			animation-timing-function: cubic-bezier(0.2, 0.8, 0.3, 1.2);
		}
		8% {
			opacity: 1;
		}
		22%,
		44% {
			transform: scale(0.74);
		}
		/* 도장에 눌려 옆으로 퍼진다 */
		47% {
			transform: scale(1.16, 0.9);
			animation-timing-function: cubic-bezier(0.3, 0, 0.3, 1);
		}
		58% {
			transform: scale(0.96, 1.04);
		}
		66% {
			transform: scale(1.02, 0.99);
		}
		76%,
		100% {
			transform: none;
		}
	}
	/* 로고 양각은 찍힌 순간부터 */
	.seal.stamping .emboss {
		animation: emboss 1.2s both;
	}
	@keyframes emboss {
		0%,
		45% {
			opacity: 0;
		}
		47%,
		100% {
			opacity: 1;
		}
	}
	/* 놋쇠 도장 (위에서 내려다본 모습 — 손잡이 나무 · 놋쇠 테) */
	.stamper,
	.stamp-shadow,
	.shock {
		position: absolute;
		left: 50%;
		top: 46.6%;
		border-radius: 50%;
		pointer-events: none;
	}
	.stamper {
		/* 머리는 양각 자리(로고 둘레)만큼 — 밀랍이 도장 둘레로 밀려 나오는 게 보이게 */
		width: 2.3em;
		height: 2.3em;
		margin: -1.15em 0 0 -1.15em;
		opacity: 0;
		animation: stamper 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	@keyframes stamper {
		0%,
		10% {
			transform: translate(0.5em, -1.2em) scale(2.6);
			opacity: 0;
		}
		30% {
			transform: translate(0.1em, -0.25em) scale(1.45);
			opacity: 1;
			animation-timing-function: ease-in-out;
		}
		/* 치기 전에 살짝 들어 올린다 (예비 동작) */
		37% {
			transform: translate(0.14em, -0.32em) scale(1.62);
			animation-timing-function: cubic-bezier(0.6, 0, 1, 0.5);
		}
		/* 쿵 */
		45% {
			transform: none;
			opacity: 1;
			animation-timing-function: ease-out;
		}
		50% {
			transform: scale(0.96);
		}
		62% {
			transform: scale(0.97);
			opacity: 1;
			animation-timing-function: cubic-bezier(0.4, 0, 0.8, 0.5);
		}
		86%,
		100% {
			transform: translate(-0.2em, -0.9em) scale(1.9);
			opacity: 0;
		}
	}
	/* 도장 그림자 — 멀면 크고 흐리고 비껴 있고, 닿으면 작고 진하다 */
	.stamp-shadow {
		width: 2.3em;
		height: 2.3em;
		margin: -1.15em 0 0 -1.15em;
		background: radial-gradient(closest-side, rgb(40 5 10 / 0.6), rgb(40 5 10 / 0.25) 70%, transparent);
		opacity: 0;
		animation: stamp-shadow 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	@keyframes stamp-shadow {
		0%,
		10% {
			transform: translate(1.6em, 2em) scale(1.9);
			opacity: 0;
		}
		30% {
			transform: translate(0.6em, 0.8em) scale(1.3);
			opacity: 0.35;
			animation-timing-function: ease-in-out;
		}
		37% {
			transform: translate(0.75em, 1em) scale(1.4);
			opacity: 0.3;
			animation-timing-function: cubic-bezier(0.6, 0, 1, 0.5);
		}
		45%,
		62% {
			transform: translate(0.06em, 0.1em) scale(1.06);
			opacity: 0.7;
			animation-timing-function: cubic-bezier(0.4, 0, 0.8, 0.5);
		}
		86%,
		100% {
			transform: translate(1.4em, 1.8em) scale(1.8);
			opacity: 0;
		}
	}
	/* 충격 파문 — 쿵 하는 순간 밀랍 둘레로 퍼진다 */
	.shock {
		width: 3em;
		height: 3em;
		margin: -1.5em 0 0 -1.5em;
		border: 0.1em solid rgb(184 20 47 / 0.55);
		box-shadow: 0 0 0.3em rgb(255 255 255 / 0.5) inset;
		opacity: 0;
		animation: shock 1.2s cubic-bezier(0.1, 0.7, 0.3, 1) both;
	}
	@keyframes shock {
		0%,
		45% {
			transform: scale(0.75);
			opacity: 0;
		}
		47% {
			opacity: 0.9;
		}
		78%,
		100% {
			transform: scale(2.1);
			opacity: 0;
		}
	}
	/* 쿵 — 봉투 전체가 한 번 눌렸다 돌아온다 (뒤집기 transform 과 겹치지 않게 scale · translate 속성으로) */
	.env.thud {
		animation: thud 1.2s both;
	}
	@keyframes thud {
		0%,
		44.5% {
			scale: 1;
			translate: 0 0;
		}
		47.5% {
			scale: 0.972;
			translate: 0 0.14em;
			animation-timing-function: cubic-bezier(0.3, 0, 0.3, 1.4);
		}
		62%,
		100% {
			scale: 1;
			translate: 0 0;
		}
	}

	/* 열기 — 봉인이 부르르 떨고, 덮개 선을 따라 금이 가고, 부스러기가 떨어진다. 그다음 덮개와 함께 들린다 */
	.crack path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
	}
	.seal.cracked .crack path {
		animation: crack 0.32s 0.16s cubic-bezier(0.5, 0, 0.2, 1) forwards;
	}
	@keyframes crack {
		to {
			stroke-dashoffset: 0;
		}
	}
	.seal.cracked .wax {
		animation: tremble 0.42s ease-in-out;
	}
	@keyframes tremble {
		20% {
			transform: rotate(-4deg) scale(1.02);
		}
		40% {
			transform: rotate(3.5deg);
		}
		60% {
			transform: rotate(-2deg);
		}
		80% {
			transform: rotate(1deg);
		}
	}
	/* 떨어진 뒤에는 살짝 들떠 있다 (그늘이 조금 깊어진다) */
	.seal.cracked {
		transform: translateY(-0.05em) scale(1.03);
		transition-delay: 0.45s, 0s;
	}
	.back.open .seal.cracked {
		transition-delay: 0s, 0.33s;
	}
	.crumb {
		position: absolute;
		width: 0.34em;
		height: 0.28em;
		background: radial-gradient(circle at 35% 30%, #e0465e, #8a0c20 70%);
		clip-path: polygon(10% 20%, 60% 0, 100% 45%, 75% 100%, 20% 85%, 0 50%);
		opacity: 0;
	}
	.c1 {
		left: 10%;
		top: 46%;
		--dx: -0.7em;
		--dy: 1.3em;
		--r: -140deg;
	}
	.c2 {
		left: 80%;
		top: 49%;
		--dx: 0.8em;
		--dy: 1.1em;
		--r: 160deg;
	}
	.c3 {
		left: 58%;
		top: 52%;
		width: 0.24em;
		height: 0.2em;
		--dx: 0.25em;
		--dy: 1.5em;
		--r: 90deg;
	}
	.seal.cracked .crumb {
		animation: crumb 0.5s 0.3s cubic-bezier(0.35, 0, 0.8, 0.6) both;
	}
	/* 톡 튀었다가 떨어진다 */
	@keyframes crumb {
		0% {
			opacity: 1;
			transform: none;
		}
		30% {
			opacity: 1;
			transform: translate(calc(var(--dx) * 0.35), -0.3em) rotate(calc(var(--r) * 0.3));
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy)) rotate(var(--r));
		}
	}
</style>

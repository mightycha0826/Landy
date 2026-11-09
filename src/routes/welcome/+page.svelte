<script lang="ts">
	import PrivacySummary from '$lib/ui/PrivacySummary.svelte';
	import { surface } from '$lib/transitions';

	let sample = $state<'chat' | 'letter'>('chat');
	// 샘플 대화 — 0: 첫 말 · 1: 내 답장 + 상대 입력 중 · 2: 상대 답장
	let step = $state(0);
	let opened = $state(false);
	let typing: ReturnType<typeof setTimeout> | undefined;

	function toggleReply() {
		clearTimeout(typing);
		if (step) { step = 0; return; }
		step = 1;
		typing = setTimeout(() => (step = 2), 1100);
	}
	$effect(() => () => clearTimeout(typing));

	function moveSample(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault(); sample = sample === 'chat' ? 'letter' : 'chat';
		document.getElementById(`sample-${sample}-tab`)?.focus();
	}

	// 이 화면만 늘 어두운 무대 (링크 미리보기 og.jpg 와 같은 분위기) — 위아래로 당겨도 흰 바탕이 비치지 않게, 상태 막대 색도 맞춘다
	$effect(() => {
		const root = document.documentElement;
		root.classList.add('welcome-stage');
		const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
		const before = metas.map((m) => m.content);
		for (const m of metas) m.content = '#121212';
		return () => {
			root.classList.remove('welcome-stage');
			metas.forEach((m, i) => (m.content = before[i]));
		};
	});

	const chips = ['🍛 급식 최애', '🎧 요즘 듣는 노래', '✨ MBTI', '🎨 동아리', '💌 익명편지', '🏃 체육대회', '📚 시험 끝나면', '🌙 야자 끝나고', '☕ 매점 메뉴', '🎤 축제 무대'];
</script>

<svelte:head><title>Landy · 우리 학교에서 시작하는 대화</title><meta name="description" content="학교 이메일로 인증하는 익명 대화와 편지. 설치 전에 샘플과 익명 범위를 둘러보세요." /></svelte:head>

<main class="welcome">
	<div class="glow" aria-hidden="true"></div>

	<header>
		<div class="brand"><img class="appicon" src="/icon-192.png" alt="" width="30" height="30" /><span class="wordmark">Landy</span></div>
		<span class="school"><i aria-hidden="true"></i>충남삼성고 전용</span>
	</header>

	<section class="hero">
		<h1><span class="line">이름보다</span><span class="line">이야기 <em>먼저.</em></span></h1>
		<p class="lead">짧은 익명 대화로 서로를 알아가고,<br />직접 하기 어려웠던 말은 편지로 전해요.</p>

		<!-- 장식 — og.jpg 의 리본 · 말풍선 · 봉투 -->
		<div class="stage" aria-hidden="true">
			<svg class="ribbon" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice">
				<defs>
					<linearGradient id="rib" x1="0" x2="1" y1="0" y2="0">
						<stop offset="0" stop-color="#ffc6a8" />
						<stop offset="0.45" stop-color="#ff86bd" />
						<stop offset="0.8" stop-color="#f0337f" />
						<stop offset="1" stop-color="#ff5f8f" />
					</linearGradient>
				</defs>
				<path class="rib-shadow" d="M-20 190 C 50 150, 110 238, 190 196 S 320 120, 420 168" />
				<path class="rib-line" pathLength="1" d="M-20 190 C 50 150, 110 238, 190 196 S 320 120, 420 168" />
			</svg>
			<span class="bubble b1">안녕!<br />무슨 노래 들어?</span>
			<span class="bubble b2">나도 그 노래 좋아!</span>
			<span class="env"><span class="seal">✓</span></span>
			<img class="petal" src="/icon-192.png" alt="" width="64" height="64" />
			<span class="spark s1">✦</span><span class="spark s2">✦</span><span class="spark s3">✦</span>
		</div>
	</section>

	<div class="marquee" aria-hidden="true">
		<div class="track">
			{#each [0, 1] as copy (copy)}
				{#each chips as c (c)}<span class="chip">{c}</span>{/each}
			{/each}
		</div>
	</div>

	<section class="block" aria-labelledby="sample-title">
		<p class="kicker">TRY IT</p>
		<h2 id="sample-title">먼저 둘러보세요</h2>
		<p class="hint">가상의 샘플이에요. 실제 학생에게 전송되지 않아요.</p>

		<div class="seg" role="tablist" aria-label="샘플 선택" style:--i={sample === 'chat' ? 0 : 1}>
			<button id="sample-chat-tab" role="tab" aria-selected={sample === 'chat'} aria-controls="sample-panel" tabindex={sample === 'chat' ? 0 : -1} onclick={() => (sample = 'chat')} onkeydown={moveSample}>익명 대화</button>
			<button id="sample-letter-tab" role="tab" aria-selected={sample === 'letter'} aria-controls="sample-panel" tabindex={sample === 'letter' ? 0 : -1} onclick={() => (sample = 'letter')} onkeydown={moveSample}>익명편지</button>
		</div>

		<div id="sample-panel" class="panel" role="tabpanel" aria-labelledby={`sample-${sample}-tab`}>
			{#if sample === 'chat'}
				<div in:surface>
					<div class="chat-head">
						<span class="avatar" aria-hidden="true">햇</span>
						<div><b>햇살고래</b><small><i aria-hidden="true"></i>가상의 대화 상대</small></div>
					</div>
					<p class="sys"><span>이름·학번 대신, 좋아하는 이야기부터</span></p>
					<div class="msgs">
						<div class="msg">급식 메뉴 중에 최애가 뭐예요?</div>
						{#if step >= 1}<div class="msg mine" in:surface>저는 카레요! 그쪽은요?</div>{/if}
						{#if step === 1}<div class="msg dots" in:surface aria-label="상대가 입력 중"><i></i><i></i><i></i></div>{/if}
						{#if step === 2}<div class="msg" in:surface>저도요. 카레 나오는 날은 기다려져요 :)</div>{/if}
					</div>
					<button class="try" onclick={toggleReply}>{step ? '샘플 다시 보기' : '샘플 답장해 보기'}</button>
				</div>
			{:else}
				<div class="letter" in:surface>
					{#if opened}
						<article class="sample-paper" in:surface={{ y: 24 }}>
							<small>To. 샘플 친구</small>
							<p>오늘 발표 정말 좋았어요.<br />준비한 마음이 느껴져서<br />응원하고 싶었어요.</p>
							<small class="from">From. 익명의 학생</small>
						</article>
					{:else}
						<div class="envelope" aria-hidden="true"><span class="to">To. 샘플 친구</span><span class="seal">♥</span></div>
					{/if}
					<button class="try" onclick={() => (opened = !opened)}>{opened ? '봉투 다시 보기' : '샘플 편지 열어 보기'}</button>
				</div>
			{/if}
		</div>
	</section>

	<section class="block" aria-labelledby="how-title">
		<p class="kicker">HOW IT WORKS</p>
		<h2 id="how-title">내 속도로 가까워져요</h2>

		<div class="bento">
			<article class="card wide">
				<div class="viz talk" aria-hidden="true">
					<span class="face a">나</span>
					<span class="wire"><i></i></span>
					<span class="face b">?</span>
					<span class="plus">+ 연장</span>
				</div>
				<h3>짧게 시작하는 대화</h3>
				<p>둘 다 원할 때 시간을 연장해요. 불편하면 나가거나 차단할 수 있어요.</p>
			</article>
			<article class="card">
				<div class="viz mail" aria-hidden="true"><span class="env mini"><span class="seal">♥</span></span></div>
				<h3>이름으로 찾아 보내는 편지</h3>
				<p>발신자는 익명으로 말을 전해요. 받는 사람은 답장하거나 수신을 끌 수 있어요.</p>
			</article>
			<article class="card">
				<div class="viz steps" aria-hidden="true">
					<span class="tag on">익명 이름</span>
					<span class="tag">🔒 학년</span>
					<span class="tag">🔒 동아리</span>
				</div>
				<h3>공개는 동의한 만큼</h3>
				<p>채팅의 단계별 정보는 쌍방 동의 후 공개돼요. 글과 뱃지로 신원을 짐작할 수도 있어요.</p>
			</article>
		</div>
		<p class="hint">편지는 운영 설정과 참여 인원에 따라 잠겨 있을 수 있어요.</p>
	</section>

	<section class="block" aria-labelledby="start-title">
		<p class="kicker">GET STARTED</p>
		<h2 id="start-title">시작은 세 걸음</h2>
		<ol class="start">
			<li><b>01</b><span>홈 화면에 <strong>설치</strong></span></li>
			<li><b>02</b><span>학교 이메일로 <strong>인증</strong></span></li>
			<li><b>03</b><span>익명으로 <strong>첫마디</strong></span></li>
		</ol>
	</section>

	<div class="privacy"><PrivacySummary expanded /></div>

	<footer>
		<p class="sign">첫마디는<br /><span class="wordmark">Landy</span></p>
		<nav aria-label="약관 및 정책"><a href="/legal/terms">이용약관</a><a href="/legal/privacy">개인정보 처리방침</a><a href="/legal/policy">운영정책</a></nav>
	</footer>

	<!-- 하단 고정 — 어디까지 내려 봐도 시작 버튼은 엄지 아래 -->
	<div class="cta">
		<a class="go" href="/install"><span>설치하고 시작하기</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
		<p class="hint">학교 이메일 인증 후 이용할 수 있어요.</p>
	</div>
</main>

<style>
	/* 이 화면만의 무대 — 늘 어둡게. 안에 들어오는 공용 부품(PrivacySummary)도 같은 색을 쓰게 토큰을 덮는다 */
	:global(html.welcome-stage), :global(html.welcome-stage body) { background: #121212; color-scheme: only dark; }
	.welcome {
		--ink: #f7f1e8;
		--ink-2: rgb(247 241 232 / 0.62);
		--ink-3: rgb(247 241 232 / 0.4);
		--glass: rgb(255 255 255 / 0.06);
		--glass-2: rgb(255 255 255 / 0.1);
		--edge: rgb(255 255 255 / 0.09);
		--pink: #ff6fa8;
		--rib: linear-gradient(100deg, #ffb59a, #ff7eb6 45%, #ec2f7b 80%, #d2257a);
		--cream: #f8ecd8;
		--text: var(--ink);
		--text-2: var(--ink-2);
		--field: var(--glass);
		--row: var(--glass);
		--line: var(--edge);
		--accent: var(--pink);
		--focus: var(--ink);

		position: relative;
		isolation: isolate;
		width: 100%;
		min-width: 0;
		max-width: 560px;
		min-height: 100dvh;
		box-sizing: border-box;
		margin: 0 auto;
		padding: max(8px, env(safe-area-inset-top)) var(--pad) 0;
		background: #121212;
		color: var(--ink);
		overflow-x: clip;
	}
	.glow {
		position: absolute; z-index: -1; inset: -120px 0 auto; height: 620px; pointer-events: none;
		background:
			radial-gradient(40% 46% at 78% 30%, rgb(236 47 123 / 0.28), transparent 70%),
			radial-gradient(36% 40% at 14% 12%, rgb(255 181 154 / 0.16), transparent 70%);
		filter: blur(10px);
	}

	header { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
	.brand { display: flex; align-items: center; gap: 9px; }
	.brand .wordmark { font-size: 25px; line-height: 34px; }
	.school { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 999px; background: var(--glass); border: 1px solid var(--edge); color: var(--ink-2); font-size: 12px; font-weight: 600; }
	.school i { width: 6px; height: 6px; border-radius: 50%; background: #3ee6b8; box-shadow: 0 0 0 3px rgb(62 230 184 / 0.18); animation: blink 2.4s ease-in-out infinite; }

	/* ── 첫 화면 ── */
	.hero { padding: 40px 0 0; }
	h1 { display: flex; flex-direction: column; margin: 0; font-size: clamp(40px, 12.4vw, 62px); line-height: 1.08; font-weight: 800; letter-spacing: -0.055em; }
	h1 .line { animation: rise 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
	h1 .line + .line { animation-delay: 0.08s; }
	h1 em { font-style: normal; background: var(--rib); -webkit-background-clip: text; background-clip: text; color: transparent; padding-right: 0.06em; }
	.lead { margin: 18px 0 0; color: var(--ink-2); font-size: 16px; line-height: 1.7; animation: rise 0.8s 0.16s cubic-bezier(0.2, 0.8, 0.2, 1) both; }

	.stage { position: relative; height: 250px; margin: 6px calc(-1 * var(--pad)) 0; overflow-x: clip; }
	.ribbon { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
	.ribbon path { fill: none; stroke-linecap: round; }
	.rib-shadow { stroke: rgb(236 47 123 / 0.28); stroke-width: 34px; filter: blur(14px); }
	.rib-line { stroke: url(#rib); stroke-width: 22px; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.6s 0.25s cubic-bezier(0.6, 0, 0.2, 1) forwards; }
	.bubble { position: absolute; padding: 10px 14px; font-size: 13px; font-weight: 600; line-height: 1.4; color: #1b1b1b; border-radius: 18px; box-shadow: 0 12px 30px rgb(0 0 0 / 0.35); }
	.b1 { left: 6%; top: 18px; background: #fffaf2; border-bottom-left-radius: 4px; --r: -5deg; animation: pop 0.6s 0.6s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 5s 1.2s ease-in-out infinite; }
	.b2 { left: 34%; top: 92px; background: #ffc4dc; border-bottom-left-radius: 4px; --r: 4deg; animation: pop 0.6s 0.85s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 5.6s 1.5s ease-in-out infinite; }
	.env { position: absolute; display: grid; place-items: center; width: 108px; height: 70px; border-radius: 8px; background: linear-gradient(160deg, #fff4e3, #f2dfc2); box-shadow: 0 16px 34px rgb(0 0 0 / 0.4); overflow: hidden; }
	.env::before { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom right, transparent 49%, rgb(80 60 40 / 0.25) 50%, transparent 51%) left / 50% 100% no-repeat, linear-gradient(to bottom left, transparent 49%, rgb(80 60 40 / 0.25) 50%, transparent 51%) right / 50% 100% no-repeat; }
	.env .seal, .envelope .seal { position: relative; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--rib); color: #fff; font-size: 13px; font-weight: 800; box-shadow: 0 3px 8px rgb(236 47 123 / 0.45); }
	.stage .env { right: 6%; top: 34px; --r: 10deg; animation: pop 0.6s 1.05s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 6s 1.7s ease-in-out infinite; }
	.petal { position: absolute; right: 10%; bottom: 8px; width: 76px; height: 76px; border-radius: 22%; box-shadow: 0 18px 40px rgb(236 47 123 / 0.35); --r: -8deg; animation: pop 0.7s 1.3s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 6.4s 2s ease-in-out infinite; }
	.spark { position: absolute; color: #ffcfb8; font-size: 16px; animation: twinkle 2.8s ease-in-out infinite; }
	.s1 { left: 58%; top: 20px; }
	.s2 { left: 18%; bottom: 30px; font-size: 11px; color: #ff9cc6; animation-delay: 0.9s; }
	.s3 { right: 34%; bottom: 64px; font-size: 12px; animation-delay: 1.7s; }

	/* ── 흐르는 칩 ── */
	.marquee { margin: 4px calc(-1 * var(--pad)) 0; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }
	.track { display: flex; gap: 8px; width: max-content; animation: slide 36s linear infinite; }
	.chip { flex: none; padding: 9px 14px; border-radius: 999px; background: var(--glass); border: 1px solid var(--edge); color: var(--ink-2); font-size: 13px; font-weight: 600; white-space: nowrap; }

	/* ── 구역 ── */
	.block { margin-top: 64px; }
	.kicker { margin: 0 0 8px; color: var(--pink); font-size: 11px; font-weight: 800; letter-spacing: 0.16em; }
	h2 { margin: 0; font-size: 28px; line-height: 1.25; font-weight: 800; letter-spacing: -0.045em; }
	.hint { margin: 8px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }

	/* 샘플 고르기 — 미끄러지는 알약 */
	.seg { position: relative; display: grid; grid-template-columns: 1fr 1fr; margin: 18px 0 12px; padding: 4px; border-radius: 999px; background: var(--glass); border: 1px solid var(--edge); }
	.seg::before { content: ''; position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 999px; background: var(--rib); box-shadow: 0 6px 18px rgb(236 47 123 / 0.35); transform: translateX(calc(var(--i) * 100%)); transition: transform 0.45s cubic-bezier(0.3, 1.3, 0.5, 1); }
	.seg button { position: relative; min-height: 42px; border-radius: 999px; color: var(--ink-2); font-size: 15px; font-weight: 600; transition: color 0.2s; }
	.seg button[aria-selected='true'] { color: #fff; }
	.seg button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

	.panel { padding: 18px; border-radius: 28px; background: linear-gradient(180deg, rgb(255 255 255 / 0.08), rgb(255 255 255 / 0.03)); border: 1px solid var(--edge); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06); }
	.chat-head { display: flex; align-items: center; gap: 12px; font-size: 15px; }
	.avatar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--rib); color: #fff; font-size: 17px; font-weight: 700; }
	.chat-head small { display: flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 12px; margin-top: 2px; }
	.chat-head small i { width: 6px; height: 6px; border-radius: 50%; background: #3ee6b8; }
	.sys { display: flex; justify-content: center; margin: 18px 0 14px; }
	.sys span { padding: 5px 12px; border-radius: 999px; background: var(--glass-2); color: var(--ink-2); font-size: 12px; }
	.msgs { display: flex; flex-direction: column; gap: 8px; min-height: 152px; }
	.msg { width: fit-content; max-width: 82%; padding: 10px 14px; background: var(--glass-2); border-radius: 20px 20px 20px 6px; font-size: 15px; line-height: 1.5; }
	.msg.mine { margin-left: auto; color: #fff; background: var(--rib); border-radius: 20px 20px 6px 20px; }
	.dots { display: flex; gap: 4px; padding: 14px 16px; }
	.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-2); animation: dot 1s ease-in-out infinite; }
	.dots i:nth-child(2) { animation-delay: 0.15s; }
	.dots i:nth-child(3) { animation-delay: 0.3s; }
	.try { display: block; width: 100%; min-height: 48px; margin-top: 16px; color: var(--ink); font-size: 15px; font-weight: 600; border-radius: 16px; background: var(--glass-2); border: 1px solid var(--edge); transition: transform 0.2s, background 0.2s; }
	.try:active { transform: scale(0.97); background: rgb(255 255 255 / 0.14); }

	.letter { display: flex; flex-direction: column; }
	.envelope { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 196px; padding: 22px; overflow: hidden; border-radius: 18px; background: linear-gradient(160deg, #fff4e3, #efdcbd); color: #4b3e30; }
	.envelope::before { content: ''; position: absolute; inset: 0 0 auto; height: 58%; background: linear-gradient(160deg, #fffaf0, #f4e5cc); clip-path: polygon(0 0, 100% 0, 50% 100%); filter: drop-shadow(0 4px 6px rgb(80 60 40 / 0.18)); }
	.envelope .to { position: relative; align-self: flex-start; font-size: 14px; font-weight: 600; }
	.envelope .seal { width: 46px; height: 46px; font-size: 18px; margin-top: auto; }
	/* 편지지 — 글줄이 34px 줄칸에 그대로 앉게 (줄 간격 = 줄 높이) */
	.sample-paper { padding: 17px 24px; border-radius: 18px; background: #fff8ea repeating-linear-gradient(transparent 0 33px, rgb(90 70 50 / 0.12) 33px 34px) 0 17px / 100% 100% no-repeat; color: #3b2f24; }
	.sample-paper > * { display: block; margin: 0; line-height: 34px; }
	.sample-paper small { font-size: 13px; }
	.sample-paper p { font-size: 18px; }
	.sample-paper .from { text-align: right; }

	/* 기능 — 벤토 */
	.bento { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
	.card { display: flex; flex-direction: column; min-width: 0; padding: 16px; border-radius: 24px; background: var(--glass); border: 1px solid var(--edge); }
	.card.wide { grid-column: 1 / -1; background: linear-gradient(135deg, rgb(236 47 123 / 0.2), rgb(255 181 154 / 0.06) 70%), var(--glass); }
	.card h3 { margin: 14px 0 6px; font-size: 16px; line-height: 1.35; font-weight: 700; letter-spacing: -0.02em; }
	.card p { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
	.viz { display: flex; align-items: center; min-height: 56px; }
	.talk { gap: 0; }
	.face { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 50%; font-size: 14px; font-weight: 800; }
	.face.a { background: var(--rib); color: #fff; }
	.face.b { background: var(--cream); color: #3b2f24; }
	.wire { position: relative; flex: 1; max-width: 120px; height: 2px; margin: 0 6px; background: repeating-linear-gradient(90deg, var(--ink-3) 0 4px, transparent 4px 8px); }
	.wire i { position: absolute; top: -3px; left: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--pink); box-shadow: 0 0 10px var(--pink); animation: travel 2.4s ease-in-out infinite; }
	.plus { margin-left: auto; padding: 6px 11px; border-radius: 999px; background: rgb(62 230 184 / 0.14); color: #6ff0cb; font-size: 12px; font-weight: 700; }
	.env.mini { position: relative; width: 72px; height: 48px; transform: rotate(-6deg); }
	.env.mini .seal { width: 20px; height: 20px; font-size: 10px; }
	.steps { flex-direction: column; align-items: flex-start; gap: 5px; }
	.tag { padding: 4px 9px; border-radius: 999px; background: var(--glass-2); color: var(--ink-3); font-size: 11px; font-weight: 700; white-space: nowrap; }
	.tag.on { background: var(--rib); color: #fff; }

	/* 시작 단계 */
	.start { display: grid; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
	.start li { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--glass); border: 1px solid var(--edge); font-size: 15px; color: var(--ink-2); }
	.start b { font-size: 13px; font-weight: 800; background: var(--rib); -webkit-background-clip: text; background-clip: text; color: transparent; letter-spacing: 0.04em; }
	.start strong { color: var(--ink); font-weight: 700; }

	.privacy { margin-top: 40px; }

	footer { margin-top: 56px; text-align: center; }
	.sign { margin: 0; color: var(--ink-2); font-size: 18px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.4; }
	.sign .wordmark { display: inline-block; margin-top: 6px; font-size: 54px; line-height: 1; }
	footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 12px; margin: 24px 0 8px; }
	footer nav a { display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--ink-3); text-decoration: underline; }

	/* 하단 고정 시작 버튼 — 유리 막대 위 리본 버튼 */
	.cta { position: sticky; bottom: 0; z-index: 5; margin: 0 calc(-1 * var(--pad)); padding: 14px var(--pad) calc(10px + env(safe-area-inset-bottom)); background: linear-gradient(to top, #121212 55%, rgb(18 18 18 / 0)); text-align: center; }
	.go { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; overflow: hidden; border-radius: 999px; background: var(--rib); color: #fff; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; box-shadow: 0 10px 30px rgb(236 47 123 / 0.4); transition: transform 0.2s, filter 0.2s; }
	.go::after { content: ''; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / 0.35) 50%, transparent 65%); transform: translateX(-100%); animation: shine 3.6s 1.5s ease-in-out infinite; }
	.go svg { width: 20px; height: 20px; transition: transform 0.2s; }
	.go:active { transform: scale(0.97); filter: brightness(0.92); }
	@media (hover: hover) { .go:hover svg { transform: translateX(3px); } }
	.go:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
	.cta .hint { margin-top: 6px; }

	@keyframes rise { from { opacity: 0; transform: translateY(22px); } }
	@keyframes draw { to { stroke-dashoffset: 0; } }
	@keyframes pop { from { opacity: 0; transform: scale(0.6) rotate(0deg); } to { opacity: 1; transform: rotate(var(--r)); } }
	@keyframes bob { 0%, 100% { transform: translateY(0) rotate(var(--r)); } 50% { transform: translateY(-8px) rotate(var(--r)); } }
	@keyframes twinkle { 0%, 100% { opacity: 0.25; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1.15); } }
	@keyframes slide { to { transform: translateX(calc(-50% - 4px)); } }
	@keyframes blink { 50% { opacity: 0.45; } }
	@keyframes dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
	@keyframes travel { 0% { left: 0; } 50% { left: calc(100% - 8px); } 100% { left: 0; } }
	@keyframes shine { 0% { transform: translateX(-100%); } 40%, 100% { transform: translateX(100%); } }

	@media (prefers-reduced-motion: reduce) { .track { animation: none; } }
	:global(:root[data-motion='reduce']) .track { animation: none; }
</style>

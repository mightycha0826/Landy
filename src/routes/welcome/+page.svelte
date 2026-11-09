<script lang="ts">
	import PrivacySummary from '$lib/ui/PrivacySummary.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Banner from '$lib/chat/Banner.svelte';
	import Envelope from '$lib/letters/Envelope.svelte';
	import LetterSheet from '$lib/letters/LetterSheet.svelte';
	import { surface } from '$lib/transitions';
	import { reducedMotion } from '$lib/motion';

	// 샘플은 앱의 진짜 부품 그대로 — 익명 구슬(Avatar) · 대화방 연장 띠(Banner) · 항공우편 봉투(Envelope) · 편지지(LetterSheet)
	const ME = '말랑복숭아';
	const YOU = '새벽수달';
	const now = new Date();
	const stampDate = `${now.getMonth() + 1}.${now.getDate()}`;
	const paperDate = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

	let sample = $state<'chat' | 'letter'>('chat');

	// ── 샘플 대화 — 0: 첫 말 · 1: 내 답장 + 상대 입력 중 · 2: 상대 답장 ──
	let step = $state(0);
	let banner = $state<'none' | 'ask' | 'done'>('none');
	let left = $state(600); // 남은 초 — 대화방 오른쪽 위 시계처럼
	const timers: ReturnType<typeof setTimeout>[] = [];
	const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, reducedMotion() ? 0 : ms));
	const clearAll = () => { timers.forEach(clearTimeout); timers.length = 0; };
	const clock = $derived(`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`);

	function toggleReply() {
		clearAll();
		if (step) { step = 0; banner = 'none'; left = 600; return; }
		step = 1;
		later(1100, () => (step = 2));
		later(2300, () => (banner = 'ask'));
	}
	function extend() {
		banner = 'done';
		left += 600;
		later(2200, () => (banner = 'none'));
	}
	$effect(() => {
		const t = setInterval(() => (left = left > 0 ? left - 1 : 600), 1000);
		return () => { clearInterval(t); clearAll(); };
	});

	// ── 샘플 편지 — 실제 편지 열기처럼: 뒤집고 → 봉인에 금 → 덮개 열림 → 편지지가 나옴 → 펼쳐 읽기 ──
	let phase = $state<'front' | 'back' | 'crack' | 'open' | 'out' | 'read'>('front');
	let envBox = $state(300);
	const envW = $derived(Math.min(320, Math.max(220, envBox - 32)));
	function openLetter() {
		clearAll();
		if (phase !== 'front') { phase = 'front'; return; }
		phase = 'back';
		later(850, () => (phase = 'crack'));
		later(1500, () => (phase = 'open'));
		later(2000, () => (phase = 'out'));
		later(2800, () => (phase = 'read'));
	}

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

	// ── 리본 — 첫 화면에서 시작해 구역 사이를 좌우로 건너며 맨 아래 Landy 꽃잎까지 한 줄로 이어진다.
	//    스크롤한 만큼 그려지고, 그리는 끝에 빛나는 점. 구역 위치로 길을 다시 그리므로 샘플이 펼쳐져도 어긋나지 않는다 ──
	let page = $state<HTMLElement>();
	let ribbon = $state({ d: '', w: 0, h: 0 });
	let pathEl = $state<SVGPathElement>();
	let drawn = $state(0);
	let tip = $state({ x: -99, y: -99 });
	let table: { len: number; y: number }[] = [];
	let total = 1;
	let goal = 0;
	let raf = 0;

	function layout() {
		const root = page;
		if (!root) return;
		const W = root.clientWidth;
		const base = root.getBoundingClientRect().top;
		const box = (sel: string) => {
			const r = root.querySelector(sel)!.getBoundingClientRect();
			return { top: r.top - base, bottom: r.bottom - base, mid: (r.top + r.bottom) / 2 - base };
		};
		const stage = box('.stage');
		const secs = ['.marquee', '#sample', '#how', '#start', '.privacy'].map(box);
		const end = box('.petal');
		const L = 6, R = W - 6;
		const y0 = stage.top + (stage.bottom - stage.top) * 0.74;
		let d = `M -40 ${y0} C ${W * 0.28} ${y0 - 80}, ${W * 0.5} ${y0 + 64}, ${W * 0.72} ${y0 + 4} C ${W * 0.88} ${y0 - 30}, ${R} ${y0 - 14}, ${R} ${y0 + 46}`;
		let x = R;
		const cross = (yA: number, yB: number, to: number) => {
			const k = (yB - yA) * 0.62;
			d += ` L ${x} ${yA} C ${x} ${yA + k}, ${to} ${yB - k}, ${to} ${yB}`;
			x = to;
		};
		for (let i = 0; i < secs.length - 1; i++) cross(secs[i].bottom + 6, secs[i + 1].top - 6, x === R ? L : R);
		cross(secs[secs.length - 1].bottom + 4, end.mid, W / 2);
		ribbon = { d, w: W, h: root.scrollHeight };
	}

	function measure() {
		if (!pathEl) return;
		total = pathEl.getTotalLength();
		table = [];
		let maxY = -Infinity;
		for (let i = 0; i <= 400; i++) {
			const len = (total * i) / 400;
			maxY = Math.max(maxY, pathEl.getPointAtLength(len).y);
			table.push({ len, y: maxY });
		}
		follow();
	}

	function follow() {
		if (!page || !table.length) return;
		const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
		const top = page.getBoundingClientRect().top + scrollY;
		const target = scrollY + innerHeight * (0.78 + 0.3 * Math.min(1, scrollY / max)) - top;
		const hit = table.find((t) => t.y >= target);
		goal = hit ? hit.len / total : 1;
		if (reducedMotion()) { drawn = goal; paintTip(); return; }
		if (!raf) raf = requestAnimationFrame(tick);
	}
	function tick() {
		raf = 0;
		const diff = goal - drawn;
		drawn = Math.abs(diff) < 0.0004 ? goal : drawn + diff * 0.1;
		paintTip();
		if (drawn !== goal) raf = requestAnimationFrame(tick);
	}
	function paintTip() {
		if (!pathEl) return;
		const p = pathEl.getPointAtLength(drawn * total);
		tip = { x: p.x, y: p.y };
	}

	$effect(() => {
		if (!page) return;
		// 구역마다 지켜본다 — 글꼴이 늦게 와 한 구역만 줄어도(전체 높이는 리본 그림이 붙잡고 있어 안 바뀐다) 길을 다시 그리게
		const ro = new ResizeObserver(() => layout());
		ro.observe(page);
		for (const el of page.querySelectorAll('.stage, .marquee, .block, .privacy, footer')) ro.observe(el);
		void document.fonts?.ready.then(() => layout());
		const onScroll = () => follow();
		addEventListener('scroll', onScroll, { passive: true });
		addEventListener('resize', onScroll, { passive: true });
		return () => {
			ro.disconnect();
			removeEventListener('scroll', onScroll);
			removeEventListener('resize', onScroll);
			cancelAnimationFrame(raf);
		};
	});
	// 길이 바뀌면 (그려진 뒤) 길이표를 다시 잰다
	$effect(() => {
		if (ribbon.d && pathEl) requestAnimationFrame(measure);
	});

	const chips = ['🍛 급식 최애', '🎧 요즘 듣는 노래', '✨ MBTI', '🎨 동아리', '💌 익명편지', '🏃 체육대회', '📚 시험 끝나면', '🌙 야자 끝나고', '☕ 매점 메뉴', '🎤 축제 무대'];
</script>

<svelte:head><title>Landy · 우리 학교에서 시작하는 대화</title><meta name="description" content="학교 이메일로 인증하는 익명 대화와 편지. 설치 전에 샘플과 익명 범위를 둘러보세요." /></svelte:head>

<main class="welcome" bind:this={page}>
	<div class="glow" aria-hidden="true"></div>

	<!-- 한 줄 리본 — 내용 뒤에 깔린다 -->
	{#if ribbon.d}
		<svg class="rib" width={ribbon.w} height={ribbon.h} viewBox="0 0 {ribbon.w} {ribbon.h}" aria-hidden="true">
			<defs>
				<linearGradient id="rib-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={ribbon.w * 0.7} y2="520" spreadMethod="reflect">
					<stop offset="0" stop-color="#ffc6a8" />
					<stop offset="0.45" stop-color="#ff86bd" />
					<stop offset="0.85" stop-color="#f0337f" />
					<stop offset="1" stop-color="#d72a86" />
				</linearGradient>
			</defs>
			<path class="halo" d={ribbon.d} pathLength="1" style:stroke-dashoffset={1 - drawn} />
			<path class="band" d={ribbon.d} pathLength="1" style:stroke-dashoffset={1 - drawn} bind:this={pathEl} />
			{#if drawn < 0.998}<circle class="tip-glow" cx={tip.x} cy={tip.y} r="16" /><circle class="tip" cx={tip.x} cy={tip.y} r="6" />{/if}
		</svg>
	{/if}

	<header>
		<div class="brand"><img class="appicon" src="/icon-192.png" alt="" width="30" height="30" /><span class="wordmark">Landy</span></div>
		<span class="school"><i aria-hidden="true"></i>충남삼성고 전용</span>
	</header>

	<section class="hero">
		<h1><span class="line">이름보다</span><span class="line">이야기 <em>먼저.</em></span></h1>
		<p class="lead">짧은 익명 대화로 서로를 알아가고,<br />직접 하기 어려웠던 말은 편지로 전해요.</p>

		<!-- 장식 — 앱의 말풍선 · 항공우편 봉투가 리본 위에 떠 있다 -->
		<div class="stage" aria-hidden="true">
			<span class="float f1"><span class="bub">안녕하세요!<br />요즘 뭐 듣는 노래 있어요?</span></span>
			<span class="float f2"><span class="bub mine">저 요즘 밴드 음악만 들어요</span></span>
			<span class="float f3"><Envelope to="우리 학교 친구" from="익명의 학생" date={stampDate} postmark={stampDate} border="brand" w={150} /></span>
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

	<section id="sample" class="block" aria-labelledby="sample-title">
		<p class="kicker">TRY IT</p>
		<h2 id="sample-title">먼저 둘러보세요</h2>
		<p class="hint">가상의 샘플이에요. 실제 학생에게 전송되지 않아요.</p>

		<div class="seg" role="tablist" aria-label="샘플 선택" style:--i={sample === 'chat' ? 0 : 1}>
			<button id="sample-chat-tab" role="tab" aria-selected={sample === 'chat'} aria-controls="sample-panel" tabindex={sample === 'chat' ? 0 : -1} onclick={() => (sample = 'chat')} onkeydown={moveSample}>익명 대화</button>
			<button id="sample-letter-tab" role="tab" aria-selected={sample === 'letter'} aria-controls="sample-panel" tabindex={sample === 'letter' ? 0 : -1} onclick={() => (sample = 'letter')} onkeydown={moveSample}>익명편지</button>
		</div>

		<div id="sample-panel" class="panel" class:paper={sample === 'letter'} role="tabpanel" aria-labelledby={`sample-${sample}-tab`}>
			{#if sample === 'chat'}
				<div class="room" in:surface>
					<!-- 대화방 머리글 — 익명 구슬 · 이름 · 남은 시간 -->
					<div class="room-head">
						<Avatar name={YOU} size={40} online />
						<div class="who"><b>{YOU}</b><small>지금 보고 있음</small></div>
						<span class="clock" aria-label="남은 시간 {clock}">{clock}</span>
					</div>
					{#if banner === 'ask'}
						<Banner title="10분 더 얘기할까요?" sub="상대가 연장을 원해요" want>
							{#snippet actions()}
								<button class="no" onclick={() => (banner = 'none')}>그만하기</button>
								<button class="yes" onclick={extend}>더 얘기하기</button>
							{/snippet}
						</Banner>
					{:else if banner === 'done'}
						<Banner title="10분 연장됐어요" sub="둘 다 원해서 대화가 이어져요" />
					{/if}

					<div class="room-body">
						<!-- 연결 순간 (MatchScreen 을 작게) -->
						<div class="matched">
							<span class="pair"><span class="orb"><Avatar name={ME} size={46} /></span><span class="orb"><Avatar name={YOU} size={46} /></span></span>
							<p class="matched-title">연결됐어요!</p>
							<small><b>{YOU}</b>님과 10분 동안 이야기해요</small>
						</div>
						<p class="sys">이름·학번 대신, 좋아하는 이야기부터</p>
						<div class="msgs">
							<div class="row"><span class="bubble first">안녕하세요!</span></div>
							<div class="row"><span class="bubble last">급식 메뉴 중에 최애가 뭐예요?</span></div>
							{#if step >= 1}<div class="row mine" in:surface><span class="bubble">저는 카레요! 그쪽은요?</span></div>{/if}
							{#if step === 1}<div class="row" in:surface aria-label="상대가 입력 중"><span class="bubble dots"><i></i><i></i><i></i></span></div>{/if}
							{#if step === 2}<div class="row" in:surface><span class="bubble">저도요. 카레 나오는 날은 기다려져요 :)</span></div>{/if}
						</div>
					</div>
					<button class="try" onclick={toggleReply}>{step ? '샘플 다시 보기' : '샘플 답장해 보기'}</button>
				</div>
			{:else}
				<div class="letter" in:surface bind:clientWidth={envBox}>
					{#if phase === 'read'}
						<div class="sample-paper" in:surface={{ y: 24 }}>
							<LetterSheet to="샘플 친구" from="익명의 학생" date={paperDate} body={'오늘 발표 정말 좋았어요.\n준비한 마음이 느껴져서\n응원하고 싶었어요.'} />
						</div>
					{:else}
						<div class="desk" class:rising={phase === 'out'} style:--rise="{Math.round(envW * 0.42)}px">
							<Envelope
								to="샘플 친구"
								from="익명의 학생"
								date={stampDate}
								postmark={stampDate}
								side={phase === 'front' ? 'front' : 'back'}
								border="f"
								sealed
								cracked={phase === 'crack' || phase === 'open' || phase === 'out'}
								open={phase === 'open' || phase === 'out'}
								paper={phase === 'out' ? 'out' : 'in'}
								glow={phase === 'front'}
								body={'오늘 발표 정말 좋았어요.\n준비한 마음이 느껴져서'}
								w={envW}
							/>
						</div>
					{/if}
					<button class="try" onclick={openLetter} disabled={phase !== 'front' && phase !== 'read'}>{phase === 'read' ? '봉투 다시 보기' : phase === 'front' ? '샘플 편지 열어 보기' : '봉투 여는 중…'}</button>
				</div>
			{/if}
		</div>
	</section>

	<section id="how" class="block" aria-labelledby="how-title">
		<p class="kicker">HOW IT WORKS</p>
		<h2 id="how-title">내 속도로 가까워져요</h2>

		<div class="bento">
			<article class="card wide">
				<div class="viz talk" aria-hidden="true">
					<Avatar name={ME} size={44} />
					<span class="wire"><i></i></span>
					<Avatar name={YOU} size={44} online />
					<span class="plus">+10분</span>
				</div>
				<h3>짧게 시작하는 대화</h3>
				<p>둘 다 원할 때 시간을 연장해요. 불편하면 나가거나 차단할 수 있어요.</p>
			</article>
			<article class="card">
				<div class="viz mail" aria-hidden="true"><Envelope to="김하늘" from="익명" date={stampDate} postmark={stampDate} border="m" w={104} /></div>
				<h3>이름으로 찾아 보내는 편지</h3>
				<p>발신자는 익명으로 말을 전해요. 받는 사람은 답장하거나 수신을 끌 수 있어요.</p>
			</article>
			<article class="card">
				<div class="viz steps" aria-hidden="true">
					<span class="tag on">익명 이름</span>
					<span class="tag">🔒 학년</span>
					<span class="tag">🔒 디플로마</span>
					<span class="tag">🔒 동아리</span>
				</div>
				<h3>공개는 동의한 만큼</h3>
				<p>채팅의 단계별 정보는 쌍방 동의 후 공개돼요. 글과 뱃지로 신원을 짐작할 수도 있어요.</p>
			</article>
		</div>
		<p class="hint">편지는 운영 설정과 참여 인원에 따라 잠겨 있을 수 있어요.</p>
	</section>

	<section id="start" class="block" aria-labelledby="start-title">
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
		<!-- 리본이 끝나는 자리 — og.jpg 처럼 리본 끝에 Landy 꽃잎 -->
		<img class="petal" src="/icon-192.png" alt="" width="84" height="84" />
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
	/* 이 화면만의 무대 — 늘 어둡게. 안에 들어오는 앱 부품(말풍선 · 연장 띠 · 편지지 · 개인정보 요약)도 앱의 다크 모드 색을 쓰게 토큰을 덮는다 */
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
		/* 앱 다크 모드 토큰 (app.css) */
		--bg: #121212;
		--surface: #232323;
		--row: #2e2e2e;
		--field: var(--row);
		--track: #3d3d3d;
		--line: #3d3d3d;
		--badge-bg: #3b3b3b;
		--text: #f2f2f2;
		--text-2: #a8a8a8;
		--accent: #ec5c95;
		--primary-text: #ec5c95;
		--focus: #eeeeee;
		--paper: #1f1c17;
		--paper-ink: #ece5d8;
		--paper-edge: #34302a;
		--paper-rule: rgb(236 229 216 / 0.1);
		--env-paper: #e6d9c2;
		--env-shade: #d4c3a6;
		--letter-red: #ff9a9f;
		--letter-blue: #81c0ff;

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
		position: absolute; z-index: -2; inset: -120px 0 auto; height: 620px; pointer-events: none;
		background:
			radial-gradient(40% 46% at 78% 30%, rgb(236 47 123 / 0.28), transparent 70%),
			radial-gradient(36% 40% at 14% 12%, rgb(255 181 154 / 0.16), transparent 70%);
		filter: blur(10px);
	}

	/* 리본 */
	.rib { position: absolute; z-index: -1; top: 0; left: 0; overflow: visible; pointer-events: none; }
	.rib path { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1 2; }
	.rib .halo { stroke: rgb(236 47 123 / 0.12); stroke-width: 34px; }
	.rib .band { stroke: url(#rib-grad); stroke-width: 20px; }
	.rib .tip { fill: #fff; }
	.rib .tip-glow { fill: rgb(255 134 189 / 0.35); }

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

	.stage { position: relative; height: 250px; margin: 6px calc(-1 * var(--pad)) 0; }
	.float { position: absolute; }
	.bub { display: block; padding: 8px 13px; border-radius: 20px; background: #2e2e2e; color: #f2f2f2; font-size: 14px; line-height: 1.38; white-space: nowrap; box-shadow: 0 14px 30px rgb(0 0 0 / 0.45); }
	.bub.mine { color: #fff; background: linear-gradient(180deg, #d33b27 -40%, #d6246e 55%, #8134af 170%); }
	.f1 { left: 5%; top: 6px; --r: -4deg; animation: pop 0.6s 0.55s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 5s 1.2s ease-in-out infinite; }
	.f2 { left: 9%; top: 98px; --r: 3deg; animation: pop 0.6s 0.8s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 5.6s 1.5s ease-in-out infinite; }
	.f3 { right: 4%; top: 148px; --r: 9deg; filter: drop-shadow(0 16px 24px rgb(0 0 0 / 0.5)); animation: pop 0.6s 1.05s cubic-bezier(0.3, 1.4, 0.5, 1) both, bob 6s 1.7s ease-in-out infinite; }
	.spark { position: absolute; color: #ffcfb8; font-size: 16px; animation: twinkle 2.8s ease-in-out infinite; }
	.s1 { right: 14%; top: 60px; }
	.s2 { left: 12%; bottom: 20px; font-size: 11px; color: #ff9cc6; animation-delay: 0.9s; }
	.s3 { left: 50%; bottom: 60px; font-size: 12px; animation-delay: 1.7s; }

	/* ── 흐르는 칩 ── */
	.marquee { margin: 18px calc(-1 * var(--pad)) 0; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }
	.track { display: flex; gap: 8px; width: max-content; animation: slide 36s linear infinite; }
	.chip { flex: none; padding: 9px 14px; border-radius: 999px; background: rgb(30 30 30 / 0.82); border: 1px solid var(--edge); color: var(--ink-2); font-size: 13px; font-weight: 600; white-space: nowrap; }

	/* ── 구역 ── */
	.block { margin-top: 96px; }
	.kicker { margin: 0 0 8px; color: var(--pink); font-size: 11px; font-weight: 800; letter-spacing: 0.16em; }
	h2 { margin: 0; font-size: 28px; line-height: 1.25; font-weight: 800; letter-spacing: -0.045em; }
	.hint { margin: 8px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }

	/* 샘플 고르기 — 미끄러지는 알약 */
	.seg { position: relative; display: grid; grid-template-columns: 1fr 1fr; margin: 18px 0 12px; padding: 4px; border-radius: 999px; background: #1c1c1c; border: 1px solid var(--edge); }
	.seg::before { content: ''; position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 999px; background: var(--rib); box-shadow: 0 6px 18px rgb(236 47 123 / 0.35); transform: translateX(calc(var(--i) * 100%)); transition: transform 0.45s cubic-bezier(0.3, 1.3, 0.5, 1); }
	.seg button { position: relative; min-height: 42px; border-radius: 999px; color: var(--ink-2); font-size: 15px; font-weight: 600; transition: color 0.2s; }
	.seg button[aria-selected='true'] { color: #fff; }
	.seg button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

	.panel { overflow: hidden; border-radius: 28px; background: #1e1e1e; border: 1px solid var(--edge); box-shadow: 0 24px 60px rgb(0 0 0 / 0.45); }

	/* 대화방 — ChatView 의 머리글 · 말풍선 모양 그대로 */
	.room-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--edge); }
	.who { flex: 1; min-width: 0; }
	.who b { display: block; font-size: 15px; font-weight: 700; }
	.who small { color: var(--text-2); font-size: 12px; }
	.clock { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
	.room :global(.extend) { background: #262626; border-bottom-color: var(--edge); }
	.room-body { padding: 18px 16px 0; }
	.matched { display: flex; flex-direction: column; align-items: center; gap: 6px; padding-bottom: 4px; text-align: center; }
	.pair { display: flex; }
	.orb { display: grid; padding: 3px; border-radius: 50%; background: linear-gradient(135deg, #d33b27, #d6246e 50%, #8134af); box-shadow: 0 0 22px rgb(214 36 110 / 0.35); }
	.orb :global(.av) { box-shadow: 0 0 0 3px #1e1e1e; }
	.orb + .orb { margin-left: -12px; }
	.matched-title { margin: 6px 0 0; padding-bottom: 0.08em; font-family: 'Partial Sans KR', var(--sans); font-size: 26px; line-height: 1; background: linear-gradient(90deg, #ffb347, #ec5c95); -webkit-background-clip: text; background-clip: text; color: transparent; transform: rotate(-3deg); }
	.matched small { color: var(--text-2); font-size: 12px; }
	.matched small b { color: var(--text); font-weight: 600; }
	.sys { margin: 16px 0 12px; color: var(--text-2); font-size: 12px; text-align: center; }
	.msgs { display: flex; flex-direction: column; gap: 3px; min-height: 150px; }
	.row { display: flex; }
	.row.mine { justify-content: flex-end; margin-top: 6px; }
	.row.mine + .row:not(.mine) { margin-top: 6px; }
	.bubble { max-width: 78%; padding: 8px 13px; border-radius: 20px; background: var(--row); color: var(--text); font-size: 15px; line-height: 1.38; }
	.bubble.first { border-bottom-left-radius: 4px; }
	.bubble.last { border-top-left-radius: 4px; }
	.mine .bubble { color: #fff; background: linear-gradient(180deg, #d33b27 -60%, #d6246e 50%, #8134af 180%); }
	.dots { display: flex; gap: 4px; padding: 13px 15px; }
	.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-2); animation: dot 1s ease-in-out infinite; }
	.dots i:nth-child(2) { animation-delay: 0.15s; }
	.dots i:nth-child(3) { animation-delay: 0.3s; }
	.try { display: block; width: calc(100% - 32px); min-height: 48px; margin: 16px; color: var(--ink); font-size: 15px; font-weight: 600; border-radius: 16px; background: var(--glass-2); border: 1px solid var(--edge); transition: transform 0.2s, background 0.2s; }
	.try:active:not(:disabled) { transform: scale(0.97); background: rgb(255 255 255 / 0.14); }
	.try:disabled { opacity: 0.55; }

	/* 편지 — 책상 위 봉투 → 편지지 */
	.panel.paper { background: radial-gradient(120% 80% at 50% 0%, #2a2522, #1b1917); }
	.letter { display: flex; flex-direction: column; padding-top: 16px; }
	.desk { display: flex; justify-content: center; padding: 18px 16px 6px; perspective: 1200px; transition: padding-top 0.5s cubic-bezier(0.3, 0.9, 0.3, 1); }
	.desk.rising { padding-top: calc(18px + var(--rise, 140px)); }
	.sample-paper { padding: 0 16px; }
	.sample-paper :global(.letter-paper) { min-height: 0; }

	/* 기능 — 벤토 */
	.bento { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
	.card { display: flex; flex-direction: column; min-width: 0; padding: 16px; border-radius: 24px; background: #1c1c1c; border: 1px solid var(--edge); }
	.card.wide { grid-column: 1 / -1; background: linear-gradient(135deg, rgb(236 47 123 / 0.2), rgb(255 181 154 / 0.06) 70%), #1c1c1c; }
	.card h3 { margin: 14px 0 6px; font-size: 16px; line-height: 1.35; font-weight: 700; letter-spacing: -0.02em; }
	.card p { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
	.viz { display: flex; align-items: center; min-height: 66px; }
	.wire { position: relative; flex: 1; max-width: 120px; height: 2px; margin: 0 8px; background: repeating-linear-gradient(90deg, var(--ink-3) 0 4px, transparent 4px 8px); }
	.wire i { position: absolute; top: -3px; left: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--pink); box-shadow: 0 0 10px var(--pink); animation: travel 2.4s ease-in-out infinite; }
	.plus { margin-left: auto; padding: 6px 11px; border-radius: 999px; background: rgb(62 230 184 / 0.14); color: #6ff0cb; font-size: 12px; font-weight: 700; }
	.mail { justify-content: flex-start; }
	.mail :global(.env) { rotate: -5deg; }
	.steps { flex-wrap: wrap; align-content: center; gap: 5px; }
	.tag { padding: 4px 9px; border-radius: 999px; background: var(--glass-2); color: var(--ink-3); font-size: 11px; font-weight: 700; white-space: nowrap; }
	.tag.on { background: var(--rib); color: #fff; }

	/* 시작 단계 */
	.start { display: grid; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
	.start li { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 18px; background: #1c1c1c; border: 1px solid var(--edge); font-size: 15px; color: var(--ink-2); }
	.start b { font-size: 13px; font-weight: 800; background: var(--rib); -webkit-background-clip: text; background-clip: text; color: transparent; letter-spacing: 0.04em; }
	.start strong { color: var(--ink); font-weight: 700; }

	.privacy { margin-top: 56px; }
	.privacy :global(.privacy-summary) { background: #1c1c1c; border: 1px solid var(--edge); }

	footer { display: flex; flex-direction: column; align-items: center; margin-top: 120px; text-align: center; }
	.petal { width: 84px; height: 84px; border-radius: 22%; box-shadow: 0 18px 44px rgb(236 47 123 / 0.45); transform: rotate(-6deg); }
	.sign { margin: 22px 0 0; color: var(--ink-2); font-size: 18px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.4; }
	.sign .wordmark { display: inline-block; margin-top: 6px; font-size: 54px; line-height: 1; }
	footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 12px; margin: 24px 0 8px; }
	footer nav a { display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--ink-3); text-decoration: underline; }

	/* 하단 고정 시작 버튼 — 리본 버튼 */
	.cta { position: sticky; bottom: 0; z-index: 5; margin: 0 calc(-1 * var(--pad)); padding: 14px var(--pad) calc(10px + env(safe-area-inset-bottom)); background: linear-gradient(to top, #121212 55%, rgb(18 18 18 / 0)); text-align: center; }
	.go { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; overflow: hidden; border-radius: 999px; background: var(--rib); color: #fff; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; box-shadow: 0 10px 30px rgb(236 47 123 / 0.4); transition: transform 0.2s, filter 0.2s; }
	.go::after { content: ''; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / 0.35) 50%, transparent 65%); transform: translateX(-100%); animation: shine 3.6s 1.5s ease-in-out infinite; }
	.go svg { width: 20px; height: 20px; transition: transform 0.2s; }
	.go:active { transform: scale(0.97); filter: brightness(0.92); }
	@media (hover: hover) { .go:hover svg { transform: translateX(3px); } }
	.go:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
	.cta .hint { margin-top: 6px; }

	@keyframes rise { from { opacity: 0; transform: translateY(22px); } }
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

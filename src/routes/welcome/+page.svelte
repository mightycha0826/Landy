<script lang="ts">
	import PrivacySummary from '$lib/ui/PrivacySummary.svelte';
	import { surface } from '$lib/transitions';
	let sample = $state<'chat' | 'letter'>('chat');
	let replied = $state(false);
	let opened = $state(false);
	function moveSample(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault(); sample = sample === 'chat' ? 'letter' : 'chat';
		document.getElementById(`sample-${sample}-tab`)?.focus();
	}
</script>

<svelte:head><title>Landy · 우리 학교에서 시작하는 대화</title><meta name="description" content="학교 이메일로 인증하는 익명 대화와 편지. 설치 전에 샘플과 익명 범위를 둘러보세요." /></svelte:head>

<main class="welcome">
	<header><a class="wordmark" href="/welcome" aria-label="Landy 소개">Landy</a><a class="start-link" href="/install">시작하기</a></header>
	<section class="hero">
		<p class="eyebrow">충남삼성고 학생들의 대화</p>
		<h1>아직 말해 보지 못한<br />우리 학교 친구에게.</h1>
		<p class="lead">짧은 익명 대화로 서로를 알아가고,<br />직접 하기 어려웠던 말은 편지로 전해요.</p>
		<a class="btn" href="/install">설치하고 시작하기</a>
		<p class="hint muted">학교 이메일 인증 후 이용할 수 있어요.</p>
	</section>
	<section aria-labelledby="sample-title">
		<h2 id="sample-title">먼저 둘러보세요</h2>
		<p class="muted hint">가상의 샘플이에요. 실제 학생에게 전송되지 않아요.</p>
		<div class="sample-tabs" role="tablist" aria-label="샘플 선택">
			<button id="sample-chat-tab" role="tab" aria-selected={sample === 'chat'} aria-controls="sample-panel" tabindex={sample === 'chat' ? 0 : -1} onclick={() => (sample = 'chat')} onkeydown={moveSample}>익명 대화</button>
			<button id="sample-letter-tab" role="tab" aria-selected={sample === 'letter'} aria-controls="sample-panel" tabindex={sample === 'letter' ? 0 : -1} onclick={() => (sample = 'letter')} onkeydown={moveSample}>익명편지</button>
		</div>
		<div id="sample-panel" class="sample-panel" role="tabpanel" aria-labelledby={`sample-${sample}-tab`}>
			{#if sample === 'chat'}
				<div in:surface>
					<div class="sample-head"><span class="sample-avatar" aria-hidden="true">☀</span><div><b>햇살고래</b><small>가상의 대화 상대</small></div></div>
					<p class="sample-system">이름·학번 대신, 좋아하는 이야기부터</p>
					<div class="sample-bubble">급식 메뉴 중에 최애가 뭐예요?</div>
					{#if replied}<div class="sample-bubble mine" in:surface>저는 카레요! 그쪽은요?</div><div class="sample-bubble" in:surface>저도요. 카레 나오는 날은 기다려져요 :)</div>{/if}
					<button class="sample-reply" onclick={() => (replied = !replied)}>{replied ? '샘플 다시 보기' : '샘플 답장해 보기'}</button>
				</div>
			{:else}
				<div class="sample-letter" in:surface>
					{#if opened}<article class="sample-paper" in:surface><small>To. 샘플 친구</small><p>오늘 발표 정말 좋았어요.<br />준비한 마음이 느껴져서<br />응원하고 싶었어요.</p><small>From. 익명의 학생</small></article>
					{:else}<div class="sample-envelope" aria-hidden="true"><span>To. 샘플 친구</span><i>♥</i></div>{/if}
					<button class="sample-reply" onclick={() => (opened = !opened)}>{opened ? '봉투 다시 보기' : '샘플 편지 열어 보기'}</button>
				</div>
			{/if}
		</div>
	</section>
	<section class="how" aria-labelledby="how-title">
		<h2 id="how-title">내 속도로 가까워져요</h2>
		<div><span>01</span><p><b>짧게 시작하는 대화</b>둘 다 원할 때 시간을 연장해요. 불편하면 나가거나 차단할 수 있어요.</p></div>
		<div><span>02</span><p><b>이름으로 찾아 보내는 편지</b>발신자는 익명으로 말을 전해요. 받는 사람은 답장하거나 수신을 끌 수 있어요.</p></div>
		<div><span>03</span><p><b>공개는 동의한 만큼</b>채팅의 단계별 정보는 쌍방 동의 후 공개돼요. 글과 뱃지로 신원을 짐작할 수도 있어요.</p></div>
		<p class="muted hint">편지는 운영 설정과 참여 인원에 따라 잠겨 있을 수 있어요.</p>
	</section>
	<PrivacySummary expanded />
	<footer><a class="btn" href="/install">설치 안내 보기</a><nav aria-label="약관 및 정책"><a href="/legal/terms">이용약관</a><a href="/legal/privacy">개인정보 처리방침</a><a href="/legal/policy">운영정책</a></nav></footer>
</main>

<style>
	.welcome { max-width: 560px; margin: 0 auto; padding: max(12px, env(safe-area-inset-top)) 22px calc(28px + env(safe-area-inset-bottom)); }
	header { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
	.wordmark { font-size: 28px; color: var(--accent); }
	.start-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; font-size: 14px; font-weight: 700; }
	.hero { padding: 42px 0 30px; }
	.eyebrow { color: var(--accent); font-size: 13px; font-weight: 700; }
	h1 { margin: 14px 0; font-size: clamp(28px, 7.6vw, 42px); line-height: 1.25; letter-spacing: -0.05em; }
	.lead { margin: 0 0 24px; color: var(--text-2); font-size: 16px; line-height: 1.7; }
	.hint { font-size: 12px; line-height: 1.6; }
	h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.03em; }
	.sample-tabs { display: flex; padding: 4px; margin: 18px 0 12px; border-radius: 16px; background: var(--field); }
	.sample-tabs button { flex: 1; min-height: 44px; border-radius: 12px; font-weight: 700; color: var(--text-2); }
	.sample-tabs button[aria-selected='true'] { background: var(--cell); color: var(--text); box-shadow: var(--shadow-1); }
	.sample-panel { padding: 18px; border-radius: 24px; border: 1px solid var(--line); background: var(--cell); }
	.sample-head { display: flex; align-items: center; gap: 10px; font-size: 14px; }
	.sample-avatar { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--field); color: var(--accent); font-size: 24px; }
	.sample-head small { display: block; color: var(--text-2); font-size: 11px; margin-top: 3px; }
	.sample-system { text-align: center; margin: 22px 0; color: var(--text-2); font-size: 12px; }
	.sample-bubble { width: fit-content; max-width: 88%; padding: 12px 14px; margin-bottom: 10px; background: var(--field); border-radius: 18px 18px 18px 5px; font-size: 14px; line-height: 1.6; }
	.sample-bubble.mine { margin-left: auto; color: var(--on-accent); background: var(--accent-fill-deep); border-radius: 18px 18px 5px 18px; }
	.sample-reply { display: block; width: 100%; min-height: 44px; margin-top: 24px; color: var(--accent); font-size: 14px; font-weight: 700; border-radius: 12px; background: var(--field); }
	.sample-letter { padding: 8px; }
	.sample-envelope { position: relative; display: flex; flex-direction: column; justify-content: space-between; min-height: 180px; padding: 24px; overflow: hidden; border: 1px solid #dccfba; background: #f3e6cf; color: #514538; border-radius: 8px; }
	.sample-envelope::before { content: ''; position: absolute; left: 0; right: 0; top: -60px; height: 140px; border: 1px solid #dccfba; transform: rotate(-12deg); background: #f7ecd9; }
	.sample-envelope span, .sample-envelope i { position: relative; }
	.sample-envelope i { align-self: center; display: grid; place-items: center; width: 44px; height: 44px; background: #a54b4c; color: #fbe9d2; border-radius: 50%; font-style: normal; }
	.sample-paper { padding: 24px; background: #fff8e9; color: #514538; border-radius: 8px; box-shadow: var(--shadow-1); }
	.sample-paper p { line-height: 1.9; font-size: 17px; }
	.how { margin: 34px 0 24px; }
	.how > div { display: flex; gap: 16px; margin-top: 18px; }
	.how span { color: var(--accent); font-size: 13px; font-weight: 700; padding-top: 2px; }
	.how p { margin: 0; font-size: 14px; color: var(--text-2); line-height: 1.7; }
	.how b { display: block; color: var(--text); margin-bottom: 4px; }
	.how .hint { margin-top: 18px; }
	footer { margin-top: 26px; }
	footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 12px; margin-top: 14px; }
	footer nav a { display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--text-2); text-decoration: underline; }
</style>

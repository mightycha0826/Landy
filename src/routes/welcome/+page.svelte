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
	<header>
		<a class="brand" href="/welcome" aria-label="Landy 소개"><img class="appicon" src="/icon-192.png" alt="" width="32" height="32" /><span class="wordmark">Landy</span></a>
		<a class="start-link" href="/install">시작하기</a>
	</header>

	<section class="hero">
		<p class="eyebrow"><i aria-hidden="true"></i>충남삼성고 학생들의 대화</p>
		<h1>아직 말해 보지 못한<br />우리 학교 <em>친구에게.</em></h1>
		<p class="lead">짧은 익명 대화로 서로를 알아가고,<br />직접 하기 어려웠던 말은 편지로 전해요.</p>
	</section>

	<section aria-labelledby="sample-title">
		<div class="section"><h2 id="sample-title">먼저 둘러보세요</h2></div>
		<p class="hint muted">가상의 샘플이에요. 실제 학생에게 전송되지 않아요.</p>
		<div class="pt-seg sample-tabs" role="tablist" aria-label="샘플 선택" style:--n="2" style:--i={sample === 'chat' ? 0 : 1}>
			<button id="sample-chat-tab" role="tab" aria-selected={sample === 'chat'} aria-controls="sample-panel" tabindex={sample === 'chat' ? 0 : -1} onclick={() => (sample = 'chat')} onkeydown={moveSample}>익명 대화</button>
			<button id="sample-letter-tab" role="tab" aria-selected={sample === 'letter'} aria-controls="sample-panel" tabindex={sample === 'letter' ? 0 : -1} onclick={() => (sample = 'letter')} onkeydown={moveSample}>익명편지</button>
		</div>
		<div id="sample-panel" class="sample-panel" role="tabpanel" aria-labelledby={`sample-${sample}-tab`}>
			{#if sample === 'chat'}
				<div in:surface>
					<div class="sample-head"><span class="sample-avatar" aria-hidden="true">햇</span><div><b>햇살고래</b><small>가상의 대화 상대</small></div></div>
					<p class="sample-system"><span>이름·학번 대신, 좋아하는 이야기부터</span></p>
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
		<div class="section"><h2 id="how-title">내 속도로 가까워져요</h2></div>
		<div class="list-row">
			<span class="lr-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4.4c-4.4 0-7.9 3.2-7.9 7.2 0 2.2 1 4.1 2.7 5.4l-.5 2.5 2.7-1.3c.9.4 1.9.6 3 .6 4.4 0 7.9-3.2 7.9-7.2S16.4 4.4 12 4.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg></span>
			<span class="lr-mid"><b class="lr-name">짧게 시작하는 대화</b><span class="lr-sub">둘 다 원할 때 시간을 연장해요. 불편하면 나가거나 차단할 수 있어요.</span></span>
		</div>
		<div class="list-row">
			<span class="lr-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.8" y="6" width="16.4" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="m4.6 7.4 7.4 5.6 7.4-5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg></span>
			<span class="lr-mid"><b class="lr-name">이름으로 찾아 보내는 편지</b><span class="lr-sub">발신자는 익명으로 말을 전해요. 받는 사람은 답장하거나 수신을 끌 수 있어요.</span></span>
		</div>
		<div class="list-row">
			<span class="lr-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13v10h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg></span>
			<span class="lr-mid"><b class="lr-name">공개는 동의한 만큼</b><span class="lr-sub">채팅의 단계별 정보는 쌍방 동의 후 공개돼요. 글과 뱃지로 신원을 짐작할 수도 있어요.</span></span>
		</div>
		<p class="muted hint">편지는 운영 설정과 참여 인원에 따라 잠겨 있을 수 있어요.</p>
	</section>

	<PrivacySummary expanded />

	<footer>
		<nav aria-label="약관 및 정책"><a href="/legal/terms">이용약관</a><a href="/legal/privacy">개인정보 처리방침</a><a href="/legal/policy">운영정책</a></nav>
	</footer>

	<!-- 하단 고정 — 어디까지 내려 봐도 시작 버튼은 엄지 아래 -->
	<div class="cta">
		<a class="btn" href="/install">설치하고 시작하기</a>
		<p class="hint muted">학교 이메일 인증 후 이용할 수 있어요.</p>
	</div>
</main>

<style>
	.welcome { max-width: 560px; margin: 0 auto; padding: max(8px, env(safe-area-inset-top)) var(--pad) 0; }
	header { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
	.brand { display: flex; align-items: center; gap: 10px; }
	.brand .wordmark { font-size: 26px; line-height: 34px; }
	.start-link { display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; border-radius: 999px; background: var(--row); color: var(--text); font-size: 14px; font-weight: 600; }

	.hero { padding: 36px 0 12px; }
	.eyebrow { display: inline-flex; align-items: center; gap: 8px; margin: 0; padding: 6px 12px; border-radius: 999px; background: var(--row); color: var(--text-2); font-size: 13px; font-weight: 600; }
	.eyebrow i { width: 7px; height: 7px; border-radius: 50%; background: var(--point-mark); }
	h1 { margin: 18px 0 14px; font-size: clamp(30px, 8.4vw, 44px); line-height: 1.22; font-weight: 650; letter-spacing: -0.045em; }
	h1 em { font-style: normal; background: var(--primary-fill); -webkit-background-clip: text; background-clip: text; color: transparent; }
	.lead { margin: 0; color: var(--text-2); font-size: 16px; line-height: 1.7; }
	.hint { margin: 4px 0 0; font-size: 12px; line-height: 1.6; }

	.sample-tabs { margin: 14px 0 12px; }
	.sample-tabs > [aria-selected='true'] { color: var(--text); font-weight: 600; }
	.sample-panel { padding: 16px; border-radius: 28px; background: var(--row); }
	.sample-head { display: flex; align-items: center; gap: 12px; font-size: 15px; }
	.sample-avatar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--primary-fill); color: #fff; font-size: 17px; font-weight: 650; }
	.sample-head small { display: block; color: var(--text-2); font-size: 12px; margin-top: 2px; }
	.sample-system { display: flex; justify-content: center; margin: 18px 0; }
	.sample-system span { padding: 4px 12px; border-radius: 999px; background: var(--badge-bg); color: var(--text-2); font-size: 12px; }
	.sample-bubble { width: fit-content; max-width: 82%; padding: 10px 14px; margin-bottom: 8px; background: var(--badge-bg); border-radius: 20px 20px 20px 6px; font-size: 15px; line-height: 1.5; }
	.sample-bubble.mine { margin-left: auto; color: #fff; background: var(--primary-fill); border-radius: 20px 20px 6px 20px; }
	.sample-reply { display: block; width: 100%; min-height: 48px; margin-top: 18px; color: var(--primary-text); font-size: 15px; font-weight: 600; border-radius: var(--r-md); background: var(--badge-bg); }
	.sample-envelope { position: relative; display: flex; flex-direction: column; justify-content: space-between; min-height: 180px; padding: 24px; overflow: hidden; border: 1px solid #dccfba; background: #f3e6cf; color: #514538; border-radius: var(--r-md); }
	.sample-envelope::before { content: ''; position: absolute; left: 0; right: 0; top: -60px; height: 140px; border: 1px solid #dccfba; transform: rotate(-12deg); background: #f7ecd9; }
	.sample-envelope span, .sample-envelope i { position: relative; }
	.sample-envelope i { align-self: center; display: grid; place-items: center; width: 44px; height: 44px; background: var(--primary-fill); color: #fff; border-radius: 50%; font-style: normal; }
	.sample-paper { padding: 24px; background: #fff8e9; color: #514538; border-radius: var(--r-md); }
	.sample-paper p { line-height: 1.9; font-size: 17px; }

	.how { margin: 12px 0 24px; }
	.how .list-row { align-items: flex-start; }
	.how .lr-name { white-space: normal; }
	.how .lr-sub { white-space: normal; font-size: 14px; line-height: 21px; }
	.how .hint { margin-top: 8px; }

	footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 12px; margin: 16px 0 8px; }
	footer nav a { display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--text-2); text-decoration: underline; }

	.cta { position: sticky; bottom: 0; z-index: 5; margin: 0 calc(-1 * var(--pad)); padding: 12px var(--pad) calc(12px + env(safe-area-inset-bottom)); background: var(--surface); box-shadow: var(--shadow-dock); text-align: center; }
	.cta .btn { width: 100%; }
</style>

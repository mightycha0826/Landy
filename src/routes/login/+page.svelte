<script lang="ts">
	import {
		S,
		SCHOOL_DOMAIN,
		UI,
		errMsg,
		sendOtp,
		sendResetOtp,
		signInWithPassword,
		toast,
		verifyOtp
	} from '$lib/state.svelte';
	import OtpInput, { OTP_LEN } from '$lib/ui/OtpInput.svelte';

	/**
	 * 로그인 화면.
	 *  기본: 학교 이메일 앞부분 + 비밀번호
	 *  처음이에요: 학교 메일 인증 코드로 계정을 만든다 (온보딩에서 비밀번호를 정한다)
	 *  비밀번호를 잊었어요: 기존 계정에만 인증 코드 → 새 비밀번호 화면으로
	 * 인증 코드는 가입 한 번, 비밀번호 분실 때만 쓴다. 가입 인증이 곧 "그 학번의 주인" 확인이다.
	 * 도메인은 @cnsa.hs.kr 로 고정 — 입력칸은 앞부분만 받는다.
	 */
	type Mode = 'login' | 'signup' | 'reset';
	let mode: Mode = $state('login');
	let sent = $state(false);

	let localPart = $state('');
	let pw = $state('');
	let email = $state('');
	let code = $state('');
	let busy = $state(false);
	let resendAt = $state(0);
	// 코드 다시 받기까지 남은 초 — S.now(1초 틱)로 세어야 버튼이 저절로 다시 켜진다 (Date.now() 는 반응하지 않는다)
	const resendLeft = $derived(Math.max(0, Math.ceil((resendAt - S.now) / 1000)));

	// 학교 이메일의 앞부분만 받는다. 도메인은 고정 표시 — 오타를 구조적으로 없앤다.
	// (도메인 강제는 DB 트리거가 한다. 여기는 UX 용.)
	// 학생 앱이라 앞부분은 학번(5자리, 학년으로 시작)만 (Phase 44). 영어가 섞였으면 선생님 계정 — 학생 전용이라고 알린다
	const STUDENT_NO = /^[1-3][0-9]{4}$/;
	const typed = $derived(localPart.trim());
	const localOk = $derived(STUDENT_NO.test(typed));
	const teacher = $derived(/[a-zA-Z]/.test(typed));
	const localHint = $derived(
		!typed || localOk || teacher ? '' : /^[0-9]+$/.test(typed) ? '학번 5자리를 입력해 주세요 (예: 20101)' : '학번만 입력해 주세요 (예: 20101)'
	);
	const pwReady = $derived(localOk && pw.length >= 6);
	// 숫자만 · 자릿수는 OtpInput 이 지킨다 (Supabase 설정 Email OTP Length 와 같은 6)
	const codeOk = $derived(code.length === OTP_LEN);

	function go(m: Mode) {
		mode = m;
		sent = false;
		code = '';
		UI.afterLogin = null;
	}

	async function onPassword() {
		if (!pwReady || busy) return;
		busy = true;
		try {
			await signInWithPassword(localPart, pw);
		} catch (e) {
			toast(errMsg(e));
			pw = '';
		} finally {
			busy = false;
		}
	}

	async function onSend() {
		if (!localOk || busy) return;
		busy = true;
		try {
			email = mode === 'reset' ? await sendResetOtp(localPart) : await sendOtp(localPart);
			sent = true;
			resendAt = Date.now() + 60_000;
			toast('인증 코드 발송');
		} catch (e) {
			toast(errMsg(e));
		} finally {
			busy = false;
		}
	}

	async function onVerify() {
		if (!codeOk || busy) return;
		busy = true;
		try {
			UI.afterLogin = mode === 'reset' ? '/settings#password' : null;
			await verifyOtp(email, code);
			// 성공하면 루트 레이아웃의 가드가 이동시킨다 (처음이면 온보딩에서 비밀번호를 정한다)
		} catch (e) {
			UI.afterLogin = null;
			toast(errMsg(e));
			code = '';
		} finally {
			busy = false;
		}
	}
</script>

{#snippet emailField(onEnter?: () => void)}
	<div class="emailfield">
		<input
			class="local"
			bind:value={localPart}
			type="text"
			inputmode="email"
			autocomplete="username"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			placeholder="학교 이메일 앞부분"
			onkeydown={(e) => e.key === 'Enter' && onEnter?.()}
		/>
		<span class="domain">@{SCHOOL_DOMAIN}</span>
	</div>
	{#if teacher}
		<!-- 선생님 계정(영어 아이디) — 학생 전용 앱이라고 알린다 (Phase 44) -->
		<div class="teacher" role="alert">
			<strong>선생님이신가요?</strong>
			<span>랜디는 <b>학생들을 위한</b> 익명 대화 앱이에요. 학번으로 된 학생 계정으로만 가입 · 로그인할 수 있어요.</span>
		</div>
	{:else if localHint}
		<p class="local-hint" role="status">{localHint}</p>
	{/if}
{/snippet}

<div class="page login">
	<img class="appicon" src="/icon-192.png" alt="" width="56" height="56" />
	<div class="mark wordmark">Landy</div>
	<p class="muted policy-links"><a href="/legal/terms">이용약관</a><span aria-hidden="true">·</span><a href="/legal/privacy">개인정보 처리방침</a></p>

	{#if mode === 'login'}
		<section>
			{@render emailField()}
			<input
				class="field"
				bind:value={pw}
				type="password"
				autocomplete="current-password"
				placeholder="비밀번호"
				onkeydown={(e) => e.key === 'Enter' && onPassword()}
			/>
			<button aria-busy={busy} class="btn" onclick={onPassword} disabled={!pwReady || busy}>
				{busy ? '확인 중…' : '로그인'}
			</button>
		</section>

		<div class="links">
			<button class="btn-text" onclick={() => go('signup')}>처음이에요 · 가입하기</button>
			<button class="btn-text" onclick={() => go('reset')}>비밀번호를 잊었어요</button>
		</div>
	{:else if !sent}
		<section>
			<h2>{mode === 'signup' ? '처음 가입' : '비밀번호 찾기'}</h2>
			{@render emailField(onSend)}
			<button aria-busy={busy} class="btn" onclick={onSend} disabled={!localOk || busy}>
				{busy ? '보내는 중…' : '인증 코드 받기'}
			</button>
		</section>
		<button class="btn-text back" onclick={() => go('login')}>로그인으로 돌아가기</button>
	{:else}
		<p class="lead muted">
			<strong>{email}</strong> 으로<br />인증 코드 {OTP_LEN}자리를 보냈어요.
		</p>
		<p class="spam muted">
			안 보이면 <strong>스팸함</strong>을 확인해 주세요.
		</p>

		<OtpInput bind:value={code} onenter={onVerify} />

		<button aria-busy={busy} class="btn" onclick={onVerify} disabled={!codeOk || busy}>
			{busy ? '확인 중…' : mode === 'signup' ? '시작하기' : '확인'}
		</button>

		<div class="row">
			<button class="btn-text" onclick={() => (sent = false)}>이메일 다시 입력</button>
			<button class="btn-text" onclick={onSend} disabled={busy || resendLeft > 0}>
				코드 다시 받기{resendLeft > 0 ? ` (${resendLeft}초)` : ''}
			</button>
		</div>
		<button class="btn-text back" onclick={() => go('login')}>로그인으로 돌아가기</button>
	{/if}

</div>

<style>
	.policy-links { display: flex; align-items: center; justify-content: center; gap: 4px; flex-wrap: wrap; }
	.policy-links a { display: inline-flex; align-items: center; min-height: 44px; padding: 4px 6px; }
	/* 첫 화면 — 위쪽에 브랜드색 빛 두 덩어리가 천천히 떠다닌다 */
	.login {
		position: relative;
		justify-content: center;
		gap: 14px;
		padding-top: calc(24px + var(--safe-top));
		padding-bottom: 40px;
		isolation: isolate;
		overflow: hidden;
	}
	/* 앱 이름 "Landy"(Phase 57)는 짧아서 — 아이콘 · 이름을 가운데 한 덩어리로 크게 (Phase 58).
	   예전 긴 이름(10자)에 맞춘 왼쪽 정렬 · 36px 는 오른쪽이 휑하고 첫 화면이 가벼워 보였다 */
	.appicon {
		align-self: center;
		width: 64px;
		height: 64px;
		margin-bottom: 2px;
		box-shadow: var(--glow);
	}
	.mark {
		align-self: center;
		/* 한 굵기뿐이라 400 (가짜 굵게 없이). 폭 280 폰에서도 한 줄 */
		font-size: min(64px, 19vw);
		font-weight: 400;
		line-height: 1.05;
		letter-spacing: -0.01em;
		margin-bottom: calc(18px - 0.16em); /* y 꼬리까지 넓힌 칸(.wordmark)만큼 당겨 자리는 그대로 */
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.lead {
		margin: 0 0 2px;
		line-height: 1.6;
		font-size: 13px;
	}
	.lead strong {
		color: var(--text);
		font-weight: 600;
	}

	/* 두 글자 단추는 각자 한 줄 — 둘이 한 줄에 안 들어가는 좁은 폰이면 가운데로 두 줄 (Phase 46) */
	.links {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		column-gap: 12px;
	}
	.links .btn-text {
		white-space: nowrap;
	}
	@media (max-width: 330px) {
		.links {
			justify-content: center;
		}
	}
	.back {
		align-self: center;
	}

	.spam {
		margin: -4px 0 4px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--surface);
		box-shadow: var(--shadow-1);
		font-size: 13px;
		line-height: 1.6;
	}
	.spam strong {
		color: var(--text);
		font-weight: 600;
	}

	.emailfield {
		display: flex;
		align-items: center;
		height: 52px;
		border: 1.5px solid transparent;
		border-radius: var(--r-md);
		background: var(--field);
		overflow: hidden;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			background 0.15s;
	}
	.emailfield:focus-within {
		border-color: color-mix(in srgb, var(--accent) 70%, transparent);
		background: var(--surface);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.local {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0 16px;
		font-size: 16px;
		border: 0;
		background: none;
		outline: none;
	}
	.local::placeholder {
		color: var(--text-2);
	}
	.domain {
		padding-right: 12px;
		color: var(--text-2);
		font-size: 14px;
		white-space: nowrap;
	}

	/* 선생님 계정 안내 · 학번 형식 안내 (Phase 44) */
	.teacher {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--danger) 9%, var(--surface));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 30%, transparent);
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-2);
	}
	.teacher strong {
		color: var(--danger);
		font-size: 14px;
	}
	.teacher b {
		color: var(--text);
	}
	.local-hint {
		margin: -4px 4px 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--danger);
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

</style>

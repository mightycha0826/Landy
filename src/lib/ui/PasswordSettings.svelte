<script lang="ts">
	import { expand } from '$lib/transitions';
	import { onDestroy, onMount } from 'svelte';
	import { accountIsCurrent, accountToken } from '$lib/accountScope';
	import { S, errMsg, recentlyVerified, sendOtpToMe, setPassword, toast, verifyCurrentPassword, verifyOtpForMe } from '$lib/state.svelte';
	import Chevron from './Chevron.svelte';
	import PasswordFields from './PasswordFields.svelte';

	let step = $state<'idle' | 'current' | 'code' | 'new'>('idle');
	let busy = $state(false);
	let current = $state('');
	let code = $state('');
	let codeSentTo = $state('');
	let resendAt = $state(0);
	let password = $state('');
	let passwordOk = $state(false);
	const token = accountToken();
	let alive = true;
	let revision = 0;
	onDestroy(() => { alive = false; });
	onMount(() => { if (location.hash === '#password') start(); });

	function start() {
		revision++;
		current = code = password = '';
		step = !S.hasPassword || recentlyVerified() ? 'new' : 'current';
	}
	function cancel() {
		revision++;
		step = 'idle';
		current = code = password = '';
	}
	/** 인증 실패·취소·화면/계정 전환 후 응답은 다음 단계나 새 입력을 바꾸지 않는다. */
	async function run<T>(request: () => Promise<T>, done: (result: T) => void, failed?: () => void) {
		if (busy || !alive || !accountIsCurrent(token)) return;
		busy = true;
		const attempt = revision;
		const valid = () => alive && accountIsCurrent(token) && attempt === revision;
		try {
			const result = await request();
			if (valid()) done(result);
		} catch (error) {
			if (valid()) {
				const message = errMsg(error);
				toast(message.includes('비밀번호가 맞지') ? '비밀번호가 맞지 않아요' : message);
				failed?.();
			}
		} finally {
			busy = false;
		}
	}
	function checkCurrent() {
		if (current) void run(() => verifyCurrentPassword(current), () => { step = 'new'; }, () => { current = ''; });
	}
	function sendCode() {
		void run(sendOtpToMe, (email) => {
			codeSentTo = email;
			resendAt = Date.now() + 60_000;
			code = '';
			step = 'code';
			toast('인증 코드 발송');
		});
	}
	function checkCode() {
		if (/^[0-9]{6,8}$/.test(code.trim())) void run(() => verifyOtpForMe(code), () => { step = 'new'; }, () => { code = ''; });
	}
	function savePassword() {
		if (passwordOk) void run(() => setPassword(password, current || undefined), () => { toast('비밀번호 저장 완료'); cancel(); });
	}
</script>

<button class="g-row" onclick={() => step === 'idle' ? start() : cancel()} aria-expanded={step !== 'idle'}>
	<span>비밀번호</span>
	<span class="g-val">{S.hasPassword ? '바꾸기' : '만들기'}</span>
	<Chevron />
</button>
{#if step !== 'idle'}
	<div class="g-more" in:expand out:expand>
		{#if step === 'current'}
			<p class="step muted">먼저 지금 쓰는 비밀번호를 확인할게요.</p>
			<input class="field" type="password" autocomplete="current-password" placeholder="지금 비밀번호" bind:value={current} onkeydown={(e) => e.key === 'Enter' && checkCurrent()} />
			<button aria-busy={busy} class="btn" onclick={checkCurrent} disabled={!current || busy}>{busy ? '확인 중…' : '확인'}</button>
			<div class="pwfoot">
				<button class="btn-text" onclick={sendCode} disabled={busy}>비밀번호를 잊었다면 · 인증 코드 받기</button>
				<button class="cancel u-tap" onclick={cancel}>취소</button>
			</div>
		{:else if step === 'code'}
			<p class="step muted"><strong>{codeSentTo}</strong> 으로 보낸 인증 코드를 입력해 주세요. 안 보이면 스팸함을 확인해 주세요.</p>
			<input class="field codein num" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="인증 코드" bind:value={code} onkeydown={(e) => e.key === 'Enter' && checkCode()} />
			<button aria-busy={busy} class="btn" onclick={checkCode} disabled={!/^[0-9]{6,8}$/.test(code.trim()) || busy}>{busy ? '확인 중…' : '확인'}</button>
			<div class="pwfoot">
				<button class="btn-text" onclick={sendCode} disabled={busy || S.now < resendAt}>코드 다시 받기</button>
				<button class="cancel u-tap" onclick={cancel}>취소</button>
			</div>
		{:else}
			<p class="step muted">{S.hasPassword ? '새 비밀번호를 정해 주세요.' : '로그인에 쓸 비밀번호를 정해 주세요.'}</p>
			<PasswordFields bind:value={password} bind:valid={passwordOk} placeholder="새 비밀번호" />
			<button aria-busy={busy} class="btn" onclick={savePassword} disabled={!passwordOk || busy}>{busy ? '저장 중…' : '저장'}</button>
			<div class="pwfoot"><span></span><button class="cancel u-tap" onclick={cancel}>취소</button></div>
		{/if}
	</div>
{/if}

<style>
	.step { margin: 0; font-size: 13px; line-height: 1.6; }
	.step strong { color: var(--text); font-weight: 600; }
	.codein { text-align: center; font-size: 20px; font-weight: 600; letter-spacing: 0.25em; }
	.pwfoot { display: flex; justify-content: space-between; align-items: center; }
	.cancel { display: inline-flex; align-items: center; min-height: 44px; padding: 0 8px; font-size: 14px; color: var(--text-2); }
</style>

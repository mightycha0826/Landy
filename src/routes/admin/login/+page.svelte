<script lang="ts">
	/**
	 * 운영자 로그인 — 학교 이메일 + 비밀번호만.
	 * 운영진은 이미 계정이 있는 사람을 SQL(private.staff)로 지정하므로 가입·인증 코드 경로가 없다.
	 *
	 * Supabase 인증 뒤 토큰을 서버로 보내 운영진 여부를 다시 확인받는다 — 운영진이 아니면 들어오지 못한다.
	 * ★ 로그인은 저장하지 않는 임시 클라이언트로 한다. 학생 앱과 같은 브라우저 저장소를 쓰면
	 *   운영자 로그인이 이 기기의 학생 앱 로그인을 덮어쓰거나 지워 버린다(안드로이드는 앱과 브라우저가 저장소를 공유).
	 */
	import { createClient } from '@supabase/supabase-js';
	import { env } from '$env/dynamic/public';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { hasSupabase } from '$lib/supabase';
	import { SCHOOL_DOMAIN, errMsg, schoolEmail } from '$lib/state.svelte';

	const setup = page.url.searchParams.get('setup');

	let pwLocal = $state('');
	let pw = $state('');
	const pwReady = $derived(pwLocal.trim().length >= 2 && pw.length >= 6);

	let busy = $state(false);
	let msg = $state<string | null>(setup);

	async function login() {
		const auth = createClient(
			env.PUBLIC_SUPABASE_URL ?? '',
			env.PUBLIC_SUPABASE_ANON_KEY ?? env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
			{ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'simbun-admin-login' } }
		).auth;
		const email = schoolEmail(pwLocal);
		const { data, error } = await auth.signInWithPassword({ email, password: pw });
		if (error) throw error;
		const res = await fetch('/admin/session', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: data.session.access_token })
		});
		if (!res.ok) {
			const t = await res.json().catch(() => ({}));
			throw new Error(t.message ?? '운영진 확인에 실패했습니다');
		}
		void goto('/admin', { replaceState: true, invalidateAll: true });
	}

	async function run(fn: () => Promise<void>) {
		if (busy) return; // Enter 를 연달아 눌러도 로그인 요청은 하나
		busy = true;
		msg = null;
		try {
			await fn();
		} catch (e) {
			msg = errMsg(e);
		} finally {
			busy = false;
		}
	}

	const loginWithPassword = () => run(login);
</script>

<div class="box">
	<h1><b class="wordmark">Landy</b> <span>운영</span></h1>
	<p class="muted">운영진으로 등록된 학교 계정만 들어올 수 있어요.<br />모든 신원 열람과 조치는 기록됩니다.</p>

	{#if msg}<p class="err">{msg}</p>{/if}

	{#if !hasSupabase}
		<p class="err">PUBLIC_SUPABASE_URL 설정이 필요합니다.</p>
	{:else}
		<div class="row">
			<input class="field" bind:value={pwLocal} placeholder="학교 이메일 앞부분" autocapitalize="off" autocomplete="username" />
			<span class="muted dom">@{SCHOOL_DOMAIN}</span>
		</div>
		<input
			class="field"
			bind:value={pw}
			type="password"
			placeholder="비밀번호"
			autocomplete="current-password"
			onkeydown={(e) => e.key === 'Enter' && loginWithPassword()}
		/>
		<button class="btn" onclick={loginWithPassword} disabled={busy || !pwReady}>로그인</button>
	{/if}
</div>

<style>
	.box {
		max-width: 380px;
		margin: 12vh auto 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h1 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0;
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.04em;
	}
	/* 학생 앱과 같은 로고 (Phase 58) */
	h1 .wordmark {
		font-size: 36px;
		line-height: 1;
	}
	h1 span {
		color: var(--text-2);
	}
	p {
		margin: 0;
		font-size: 13px;
		line-height: 1.7;
	}
	.err {
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		color: var(--danger);
		font-size: 13px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dom {
		font-size: 14px;
		white-space: nowrap;
	}
</style>

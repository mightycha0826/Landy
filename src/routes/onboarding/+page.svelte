<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import PrivacySummary from '$lib/ui/PrivacySummary.svelte';
	import PasswordFields from '$lib/ui/PasswordFields.svelte';
	import { S, errMsg, saveMyName, saveOnboarding, setPassword, toast } from '$lib/state.svelte';

	let gender: 'm' | 'f' | null = $state(null);
	let want: 'm' | 'f' | 'any' | null = $state(null);
	let busy = $state(false);

	// 처음 인증 코드로 들어온 사람은 여기서 비밀번호를 정한다 → 다음부터 코드 없이 로그인
	const needPassword = $derived(S.hasPassword === false);
	let password = $state('');
	let passwordOk = $state(false);

	// 대화 상대의 선호는 성별과 독립적으로 직접 선택한다.
	function pickGender(g: 'm' | 'f') {
		gender = g;
	}

	// 이름 (Phase 23 이름 편지) — 학교 명단(학번)에서 자동. 명단에 없을 때만 한 번 적는다.
	// 이미 시작한 사람이 이름 때문에 다시 온 경우에는 이름만 묻는다.
	const onlyName = $derived(!!S.profile?.onboarded);
	const needName = $derived(S.me === null);
	let nameDraft = $state('');
	const nameOk = $derived(/^[가-힣A-Za-z]{2,20}$/.test(nameDraft.trim()));

	const ready = $derived(
		(!needName || nameOk) && (onlyName || (!!gender && !!want && (!needPassword || passwordOk)))
	);

	async function submit() {
		if (!ready || busy) return;
		busy = true;
		try {
			if (needName) await saveMyName(nameDraft.trim());
			if (onlyName) return; // 가드가 홈으로 보낸다
			if (needPassword) await setPassword(password);
			await saveOnboarding(gender!, want!);
		} catch (e) {
			toast(errMsg(e));
		} finally {
			busy = false;
		}
	}
</script>

<div class="topbar"><span class="title">시작하기</span></div>

<div class="page ob">
	{#if S.profile?.nickname}
		<section class="me">
			<Avatar name={S.profile.nickname} size={56} />
			<div>
				<p class="muted small">내 익명 이름</p>
				<p class="nick">{S.profile.nickname}</p>
			</div>
		</section>
	{/if}

	{#if S.me}
		<section>
			<h2>내 이름</h2>
			<p class="name">{S.me.name}{#if S.me.grade}<span class="muted"> · {S.me.grade}학년</span>{/if}</p>
		</section>
	{:else if needName}
		<section>
			<h2>내 이름</h2>
			<input class="field" bind:value={nameDraft} maxlength="20" placeholder="실명" autocomplete="name" aria-label="내 이름" />
			<p class="hint muted">실명을 적어 주세요. <strong>바꿀 수 없어요.</strong></p>
		</section>
	{/if}

	{#if needPassword && !onlyName}
		<section>
			<h2>비밀번호 만들기</h2>
			<PasswordFields bind:value={password} bind:valid={passwordOk} />
		</section>
	{/if}

	{#if !onlyName}
	<section>
		<h2>나는</h2>
		<div class="opts">
			<button class="opt" class:on={gender === 'm'} onclick={() => pickGender('m')}>남자</button>
			<button class="opt" class:on={gender === 'f'} onclick={() => pickGender('f')}>여자</button>
		</div>
	</section>

	<section>
		<h2>이런 사람과 이야기하고 싶어요</h2>
		<p class="hint muted">친구와 이야기하고 싶은 범위를 직접 골라 주세요. 나중에 프로필에서 바꿀 수 있어요.</p>
		<div class="opts">
			<button class="opt" class:on={want === 'm'} onclick={() => (want = 'm')}>남자</button>
			<button class="opt" class:on={want === 'f'} onclick={() => (want = 'f')}>여자</button>
			<button class="opt" class:on={want === 'any'} onclick={() => (want = 'any')}>상관없어요</button>
		</div>
	</section>
	{/if}

	<PrivacySummary expanded />
	<div class="rules">
		<h2>세 가지만 지켜 주세요</h2>
		<ul>
			<li>이름·학번·반·SNS 계정은 <strong>묻지도, 말하지도 않기</strong></li>
			<li>상대가 불편할 말은 하지 않기</li>
			<li>불쾌한 일이 있으면 <strong>바로 신고하기</strong></li>
		</ul>
	</div>

	<div class="foot">
		<button aria-busy={busy} class="btn" onclick={submit} disabled={!ready || busy}>
			{busy ? '저장 중…' : onlyName ? '저장' : '동의하고 시작하기'}
		</button>
	</div>
</div>

<style>
	.ob {
		gap: 26px;
		padding-top: 22px;
		padding-bottom: 24px;
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
	.opts {
		display: flex;
		gap: 8px;
	}
	.opt:active {
		transform: scale(0.97);
	}
	.opt {
		flex: 1;
		height: 48px;
		transition: transform 0.15s;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		font-size: 15px;
		font-weight: 500;
		background: var(--bg);
	}
	/* 선택은 흑백 반전 — 그라디언트는 주 버튼에만 */
	.opt.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
	}
	.hint {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
	}
	.hint strong {
		color: var(--text);
		font-weight: 600;
	}
	.name {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
	}

	.rules {
		padding: 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface);
	}
	.rules h2 {
		margin-bottom: 10px;
	}
	.rules ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: 14px;
		color: var(--text-2);
	}
	.rules strong {
		color: var(--text);
		font-weight: 600;
	}

	.foot {
		margin-top: auto;
	}

	.me {
		flex-direction: row;
		align-items: center;
		gap: 14px;
	}
	.me p {
		margin: 0;
	}
	.small {
		font-size: 12px;
	}
	.nick {
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
</style>

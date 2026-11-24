<script lang="ts">
	/**
	 * 닉네임 랜덤 변경권 (Phase 102) — 가입 선물 1장 · 처음 딴 뱃지 1장 · 금 뱃지마다 1장. 프로필의 이름 카드 아래에 있고, 한 장 쓰면 서버가 새 이름을 무작위로 정한다.
	 * 이미 만들어진 대화방에는 예전 이름이 그대로 보인다.
	 */
	import Avatar from './Avatar.svelte';
	import Sheet from './Sheet.svelte';
	import { rerollNickname } from '$lib/achievements';
	import { S, errMsg, toast } from '$lib/state.svelte';

	let { tickets, onused }: { tickets: number; onused: (left: number) => void } = $props();

	let open = $state(false);
	let busy = $state(false);
	let picked = $state<string | null>(null);
	/** 쓰고 남은 장수 — 창을 닫을 때 알린다 (0장이 되면 이 줄이 사라지므로 결과를 본 뒤에) */
	let left = $state(0);

	const close = () => {
		if (busy) return;
		open = false;
		if (picked) onused(left);
		picked = null;
	};
	async function use() {
		if (busy) return;
		busy = true;
		try {
			const r = await rerollNickname();
			if (r.status === 'ok' && r.nickname) {
				if (S.profile) S.profile.nickname = r.nickname;
				left = r.tickets ?? 0;
				picked = r.nickname;
			} else if (r.status === 'no_ticket') {
				onused(0);
				open = false;
				toast('남은 변경권이 없어요');
			} else toast(r.status === 'not_eligible' ? '지금은 닉네임을 바꿀 수 없어요' : '다시 시도해 주세요');
		} catch (e) {
			toast(errMsg(e));
		} finally {
			busy = false;
		}
	}
</script>

<div class="g-card ticket">
	<button class="g-row" onclick={() => (open = true)}>
		<span class="ico" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5h16v3a2 2 0 0 0 0 3v3H4v-3a2 2 0 0 0 0-3zM14.5 7.5v1.6M14.5 11.2v1.6M14.5 14.9v1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
		</span>
		<span class="label">닉네임 랜덤 변경권</span>
		<span class="count num">{tickets}장</span>
		<svg class="g-chev" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
</div>

{#if open}
	<Sheet onclose={close} label="닉네임 랜덤 변경권">
		<div class="body">
			{#if picked}
				<div class="reveal"><Avatar name={picked} size={72} /></div>
				<p class="kicker">새 닉네임</p>
				<h2>{picked}</h2>
				<p class="muted">남은 변경권 <span class="num">{left}장</span></p>
				<button class="btn" onclick={close}>확인</button>
			{:else}
				<span class="big" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5h16v3a2 2 0 0 0 0 3v3H4v-3a2 2 0 0 0 0-3zM14.5 7.5v1.6M14.5 11.2v1.6M14.5 14.9v1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</span>
				<h2>닉네임을 랜덤으로 바꿀까요?</h2>
				<p class="now">지금 이름 <strong>{S.profile?.nickname}</strong></p>
				<p class="muted">새 이름은 무작위로 정해지고 되돌릴 수 없어요. 이미 시작한 대화에는 지금 이름이 그대로 보여요.</p>
				<button class="btn" onclick={use} disabled={busy} aria-busy={busy}>{busy ? '바꾸는 중' : '변경권 1장 쓰기'}</button>
				<button class="later u-tap" onclick={close} disabled={busy}>취소</button>
			{/if}
		</div>
	</Sheet>
{/if}

<style>
	.ticket .g-row {
		gap: 12px;
		width: 100%;
	}
	.ico {
		display: grid;
		flex: none;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--accent-fill);
		color: #fff;
	}
	.ico svg {
		width: 19px;
		height: 19px;
	}
	.label {
		flex: 1;
		text-align: left;
	}
	.count {
		color: var(--text-2);
		font-weight: 650;
	}
	.body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 16px var(--pad) 8px;
		text-align: center;
	}
	.body .btn {
		align-self: stretch;
	}
	.big {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--accent-fill);
		color: #fff;
	}
	.big svg {
		width: 30px;
		height: 30px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.03em;
	}
	p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
	}
	.now {
		padding: 8px 14px;
		border-radius: 12px;
		background: var(--row);
		color: var(--text-2);
	}
	.now strong {
		margin-left: 4px;
		color: var(--text);
	}
	.kicker {
		font-size: 12px;
		font-weight: 650;
		color: var(--primary-icon);
	}
	.reveal {
		animation: pop 0.45s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
	}
	.later {
		height: 44px;
		padding: 0 16px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>

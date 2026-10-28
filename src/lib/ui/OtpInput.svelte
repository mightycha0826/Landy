<script lang="ts" module>
	/** 인증 코드 자릿수 — Supabase 대시보드 Auth > Email 의 "Email OTP Length" 와 같아야 한다 */
	export const OTP_LEN = 6;
</script>

<script lang="ts">
	/**
	 * 인증 코드 여섯 칸 (2026-10-06 — 전엔 8자리 한 줄 입력칸). 로그인 · 비밀번호 설정이 같이 쓴다.
	 * 진짜 입력칸은 하나 — 칸 위에 투명하게 덮여 있어 문자 자동 완성(one-time-code) · 붙여넣기 · 지우기가 그대로 된다.
	 * 보이는 칸은 그 값을 한 글자씩 그린 것. 숫자만 · OTP_LEN 자까지 받는다 (붙여넣은 "123 456" 도).
	 */
	let { value = $bindable(''), onenter }: { value: string; onenter?: () => void } = $props();
	let focused = $state(false);
	// 다음에 채울 칸 (다 찼으면 마지막 칸)
	const at = $derived(Math.min(value.length, OTP_LEN - 1));
	// 커서는 늘 끝에 — 가운데 칸을 눌러도 중간에 끼워 넣지 않게
	const toEnd = (e: Event) => {
		const el = e.currentTarget as HTMLInputElement;
		el.setSelectionRange(el.value.length, el.value.length);
	};
</script>

<label class="otp num">
	<input
		bind:value={() => value, (v) => (value = v.replace(/\D/g, '').slice(0, OTP_LEN))}
		type="text"
		inputmode="numeric"
		autocomplete="one-time-code"
		aria-label="인증 코드 {OTP_LEN}자리"
		onfocus={(e) => ((focused = true), toEnd(e))}
		onblur={() => (focused = false)}
		onclick={toEnd}
		onkeydown={(e) => e.key === 'Enter' && onenter?.()}
	/>
	{#each { length: OTP_LEN } as _, i (i)}
		<span class="cell" class:filled={i < value.length} class:on={focused && i === at} aria-hidden="true">{value[i] ?? ''}</span>
	{/each}
</label>

<style>
	.otp {
		position: relative;
		display: flex;
		justify-content: center;
		gap: clamp(6px, 2.2vw, 10px);
	}
	/* 진짜 입력칸 — 칸 전체를 덮는다 (어느 칸을 눌러도 키보드가 뜬다). 글자 · 커서는 숨기고 칸이 대신 보여 준다 */
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
		background: none;
		color: transparent;
		caret-color: transparent;
		font-size: 16px; /* 아이폰이 입력칸에 들어갈 때 화면을 키우지 않게 (G6.8) */
		outline: none;
	}
	.cell {
		flex: 1;
		display: grid;
		place-items: center;
		max-width: 54px;
		height: 60px;
		border: 1.5px solid transparent;
		border-radius: var(--r-md);
		background: var(--field);
		font-size: 26px;
		font-weight: 600;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			background 0.15s,
			transform 0.15s;
	}
	.cell.filled {
		background: var(--surface);
		box-shadow: var(--shadow-1);
	}
	/* 지금 채울 칸 — .field:focus 와 같은 테 */
	.cell.on {
		border-color: color-mix(in srgb, var(--accent) 70%, transparent);
		background: var(--surface);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent);
		transform: translateY(-2px);
	}
	/* 빈 칸의 커서 */
	.cell.on:not(.filled)::after {
		content: '';
		width: 2px;
		height: 24px;
		border-radius: 1px;
		background: var(--accent);
		animation: blink 1.1s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>

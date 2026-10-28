<script lang="ts">
	/**
	 * 처음 한 번 — 새 메시지 알림을 받을지 묻는 시트 (홈). 바깥을 눌러 닫지 않는다 (둘 중 하나를 골라야 다시 묻지 않는다).
	 * open = 지금 물어야 하는지 (홈이 다른 창 — 매너 평가 — 을 이 동안 미룬다). 사용법 안내 · 업적 축하가 있으면 그 뒤에.
	 */
	import Sheet from './Sheet.svelte';
	import { UI, toast } from '$lib/state.svelte';
	import { touring } from '$lib/tour.svelte';
	import { enablePush, pushState } from '$lib/push';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	// 브라우저 권한 창은 사용자가 버튼을 눌렀을 때만 띄울 수 있다(iOS 는 그 외엔 아예 불가).
	// 그래서 먼저 우리 화면으로 이유를 설명하고, "알림 받기"를 누르면 그때 권한을 묻는다.
	const ASKED = 'push-asked-v1';
	$effect(() => {
		let asked = false;
		try {
			asked = localStorage.getItem(ASKED) === '1';
		} catch {
			/* 저장소를 못 쓰는 환경 — 매번 묻지 않도록 그냥 넘어간다 */
			asked = true;
		}
		if (!asked && pushState() === 'default') open = true;
	});
	function doneAsking() {
		open = false;
		try {
			localStorage.setItem(ASKED, '1');
		} catch {
			/* 무시 */
		}
	}
	async function allowPush() {
		const r = await enablePush();
		doneAsking();
		if (r === 'granted') toast('알림 켜짐');
		else if (r === 'denied') toast('알림이 꺼져 있어요. 설정에서 다시 켤 수 있어요');
	}
</script>

{#if open && !UI.celebrating && !touring()}
	<Sheet label="알림 받기">
		<div class="ask">
			<div class="bell" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none">
					<path
						d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</div>
			<h2 id="push-title">새 메시지 알림을 받을까요?</h2>
			<button class="btn" onclick={allowPush}>알림 받기</button>
			<button class="later u-tap" onclick={doneAsking}>나중에</button>
		</div>
	</Sheet>
{/if}

<style>
	/* 알림 권한 안내 (Sheet 안) */
	.ask {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 16px var(--pad) 8px;
		text-align: center;
	}
	.ask h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.03em;
	}
	.bell {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--accent-fill);
		color: #fff;
	}
	.bell svg {
		width: 28px;
		height: 28px;
	}
	.later {
		height: 44px;
		padding: 0 16px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>

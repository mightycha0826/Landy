<script lang="ts">
	/**
	 * 랜덤채팅에서 보일 뱃지 (Phase 84) — 가진 뱃지마다 보이기 · 숨기기. CNSA 뱃지 안내와 설정이 같이 쓴다.
	 * 뱃지가 나를 짐작하게 할 수 있어서, 정하지 않았으면 CNSA 뱃지는 숨김 · Landy 뱃지는 보임 (서버 private.badge_chat_visible 과 같은 규칙).
	 * 누르면 바로 바뀌어 보이고 서버에 저장, 안 되면 되돌린다. 편지 찾기에서는 숨긴 뱃지도 보인다 (받는 사람이 이름으로 찾은 사이라).
	 */
	import Badge from './Badge.svelte';
	import { setBadgeChat, type MyAchievements } from '$lib/achievements';
	import { errMsg, toast } from '$lib/state.svelte';

	let { data, compact = false }: { data: MyAchievements; compact?: boolean } = $props();

	// 가진 뱃지 — CNSA 뱃지 먼저 (나를 짐작하게 할 수 있는 것)
	const owned = $derived(data.items.filter((a) => a.tier > 0).sort((a, b) => Number(b.category === 'cnsa') - Number(a.category === 'cnsa')));
	// svelte-ignore state_referenced_locally
	let vis = $state<Record<string, boolean>>({ ...(data.chat ?? {}) });
	const shown = (code: string, cat: string) => vis[code] ?? cat !== 'cnsa';
	let busy = $state<string | null>(null);

	async function toggle(code: string, cat: string) {
		if (busy) return;
		const next = !shown(code, cat);
		const prev = vis[code];
		vis = { ...vis, [code]: next };
		busy = code;
		try {
			const r = await setBadgeChat(code, next);
			if (r.status !== 'ok') throw new Error('가진 뱃지만 정할 수 있어요');
		} catch (e) {
			vis = { ...vis, [code]: prev ?? cat !== 'cnsa' };
			toast(errMsg(e));
		} finally {
			busy = null;
		}
	}
</script>

{#if owned.length}
	<ul class="list" class:compact>
		{#each owned as a (a.code)}
			<li>
				<label class="row">
					<Badge code={a.code} icon={a.icon} tier={a.tier} title={a.title} size={compact ? 30 : 34} />
					<span class="name">
						<b>{a.title}</b>
						{#if a.category === 'cnsa'}<small>CNSA 뱃지 · 나를 짐작하게 할 수 있어요</small>{/if}
					</span>
					<input
						class="switch"
						type="checkbox"
						role="switch"
						aria-label="{a.title} 랜덤채팅에 보이기"
						checked={shown(a.code, a.category)}
						disabled={busy === a.code}
						onchange={(e) => {
							(e.currentTarget as HTMLInputElement).checked = shown(a.code, a.category);
							void toggle(a.code, a.category);
						}}
					/>
				</label>
			</li>
		{/each}
	</ul>
{:else}
	<p class="none">아직 가진 뱃지가 없어요</p>
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		text-align: left;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 52px;
		padding: 6px 2px;
		border-bottom: 1px solid var(--line);
	}
	.compact .row {
		min-height: 46px;
		gap: 10px;
	}
	li:last-child .row {
		border-bottom: 0;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.name b {
		font-size: 14px;
		font-weight: 600;
	}
	.name small {
		font-size: 11px;
		color: var(--text-2);
	}
	.none {
		margin: 8px 0;
		font-size: 13px;
		color: var(--text-2);
	}
</style>

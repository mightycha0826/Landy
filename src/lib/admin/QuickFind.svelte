<script lang="ts">
	/**
	 * 빠른 찾기 (Phase 96) — Ctrl/⌘ + K 또는 메뉴 위 단추. 한 칸에 적으면 갈 수 있는 화면이 걸러지고,
	 * 사용자 화면을 볼 수 있는 역할이면 적은 말로 사용자 찾기(익명 이름 · ID 앞자리 · 이메일)로 바로 간다.
	 * 브라우저의 <dialog> 를 그대로 쓴다 — 초점 가두기 · Esc 닫기 · 뒤 화면 가리기를 브라우저가 한다.
	 * 여기서는 아무것도 서버에 묻지 않는다 (사용자 찾기는 사용자 화면이 한다 — 이메일 검색 기록도 거기서 남는다).
	 */
	import { goto } from '$app/navigation';

	let { pages, users, onclose }: { pages: { href: string; label: string; group: string }[]; /** 사용자 찾기를 보일지 */ users: boolean; onclose: () => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let q = $state('');
	let at = $state(0);
	$effect(() => dialog?.showModal());

	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const results = $derived.by(() => {
		const term = q.trim();
		const hit = pages.filter((p) => !term || p.label.includes(term) || p.group.includes(term));
		if (!term || !users) return hit;
		return [
			...hit,
			...(UUID.test(term) ? [{ href: `/admin/users/${term.toLowerCase()}`, label: '이 ID 의 사용자 열기', group: '사용자' }] : []),
			{ href: `/admin/users?q=${encodeURIComponent(term)}`, label: `사용자 찾기: “${term}”`, group: '사용자' }
		];
	});
	// 적는 말이 바뀌면 맨 위 줄부터
	$effect(() => {
		void q;
		at = 0;
	});

	function go(href: string) {
		dialog?.close();
		void goto(href);
	}
	function onkey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			at = (at + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
		} else if (e.key === 'Enter' && results[at]) {
			e.preventDefault();
			go(results[at].href);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} aria-label="화면 · 사용자 찾기" {onclose} onclick={(e) => e.target === dialog && dialog?.close()}>
	<div class="box">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={q}
			onkeydown={onkey}
			autofocus
			type="search"
			placeholder={users ? '화면 이름 · 익명 이름 · ID 앞자리' : '화면 이름'}
			aria-label="찾을 말"
			aria-controls="qf-list"
			autocomplete="off"
			spellcheck="false"
		/>
		<ul id="qf-list" role="listbox" aria-label="찾은 것">
			{#each results as r, i (r.href)}
				<li role="option" aria-selected={i === at}>
					<a href={r.href} class:on={i === at} onclick={(e) => { e.preventDefault(); go(r.href); }} onpointerenter={() => (at = i)}>
						<span>{r.label}</span><small>{r.group}</small>
					</a>
				</li>
			{:else}
				<li class="none">맞는 화면이 없어요</li>
			{/each}
		</ul>
		<p class="keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> 고르기 · <kbd>Enter</kbd> 열기 · <kbd>Esc</kbd> 닫기</p>
	</div>
</dialog>

<style>
	dialog {
		width: min(520px, calc(100vw - 32px));
		margin: 12vh auto auto;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--bg);
		color: var(--text);
		box-shadow: 0 20px 60px rgb(0 0 0 / 0.25);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.35);
	}
	input {
		width: 100%;
		padding: 14px 16px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 16px;
		outline: none;
	}
	ul {
		max-height: 50vh;
		margin: 0;
		padding: 6px;
		overflow-y: auto;
		list-style: none;
	}
	a {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 10px;
		border-radius: 8px;
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
	}
	a.on {
		background: var(--field);
	}
	a span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	small,
	.none,
	.keys {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-2);
	}
	small {
		flex: none;
	}
	.none {
		padding: 14px 10px;
	}
	.keys {
		margin: 0;
		padding: 8px 16px 10px;
		border-top: 1px solid var(--line);
	}
	kbd {
		padding: 1px 5px;
		margin-right: 2px;
		border: 1px solid var(--line);
		border-radius: 5px;
		font: inherit;
		font-size: 11px;
	}
</style>

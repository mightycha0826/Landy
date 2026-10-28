<script lang="ts">
	/**
	 * 상대 프로필 시트 — 아바타 · 이름 · 접속 여부 · 소개 · MBTI · 관심사. 같은 방 멤버에게만 서버가 준다.
	 * 대표 업적은 교복 깃의 배지 (Phase 60). 상대 성별은 받지 않으므로 늘 넥타이.
	 * 배지를 누르면 어떻게 얻는지 (Phase 44, BadgeSheet — 이 시트 위에 뜬다).
	 */
	import Avatar from '$lib/ui/Avatar.svelte';
	import MannerTemp from '$lib/ui/MannerTemp.svelte';
	import Uniform from '$lib/ui/Uniform.svelte';
	import { openBadge } from '$lib/badgeSheet.svelte';
	import type { PartnerProfile } from './types';

	let { alias, profile, loading }: { alias: string | null; profile: PartnerProfile | null; loading: boolean } = $props();
</script>

<div class="profile">
	{#if alias}
		<Avatar name={alias} size={72} online={!!profile?.online} />
		<h3>{alias}</h3>
		<p class="status muted">
			{#if profile}{profile.online ? '접속 중' : '오프라인'}{:else}&nbsp;{/if}
		</p>
	{/if}
	{#if profile}
		<div class="temp"><MannerTemp temp={profile.manner_temp} /></div>
		<div class="badges">
			<Uniform badges={profile.badges ?? []} onpick={openBadge} />
		</div>
		{#if profile.bio}<p class="bio selectable">{profile.bio}</p>{/if}
		{#if profile.mbti || profile.interests.length}
			<div class="tags">
				{#if profile.mbti}<span class="tag mbti">{profile.mbti}</span>{/if}
				{#each profile.interests as t (t)}<span class="tag">{t}</span>{/each}
			</div>
		{/if}
		{#if !profile.bio && !profile.mbti && !profile.interests.length}
			<p class="muted small">아직 소개를 적지 않음</p>
		{/if}
	{:else if loading}
		<!-- 매너 온도 · 소개 · 관심사 자리를 먼저 잡는다 — 시트가 아래에서 붙어 있어 내용이 늘면 윗단이 튀어 오르므로 -->
		<p class="sr-only">불러오는 중…</p>
		<div class="sk" aria-hidden="true">
			<i class="skeleton temp-sk"></i>
			<i class="skeleton line"></i>
			<i class="skeleton line short"></i>
			<span class="tags">{#each [48, 64, 56] as w (w)}<i class="skeleton pill" style:width="{w}px"></i>{/each}</span>
		</div>
	{:else}
		<p class="muted small">프로필을 불러오지 못함</p>
	{/if}
</div>

<style>
	.temp {
		display: flex;
		justify-content: center;
		width: 100%;
		margin: 6px 0 4px;
	}
	/* 교복 (Phase 60) — 시트에선 조금 작게 */
	.badges {
		width: 100%;
		max-width: 300px;
		margin: 6px 0 4px;
	}
	.profile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px var(--pad) 18px;
		text-align: center;
	}
	h3 {
		margin: 6px 0 0;
		font-size: 18px;
		font-weight: 600;
	}
	.status {
		margin: 0;
		font-size: 12px;
	}
	.bio {
		margin: 8px 0 0;
		font-size: 14px;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.small {
		margin: 8px 0 0;
		font-size: 13px;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin-top: 8px;
	}
	.tag {
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--field);
		font-size: 13px;
	}
	.sk {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
	}
	/* MannerTemp 막대 묶음 (글자 줄 + 막대 + 설명) 높이 */
	.temp-sk {
		width: 100%;
		max-width: 280px;
		height: 63px;
		margin: 6px 0 4px;
		border-radius: var(--r-sm);
	}
	.line {
		width: 78%;
		height: 13px;
		margin-top: 12px;
	}
	.line.short {
		width: 52%;
		margin-top: 9px;
	}
	.pill {
		height: 27px;
		border-radius: 999px;
	}
	.tag.mbti {
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
	}
</style>

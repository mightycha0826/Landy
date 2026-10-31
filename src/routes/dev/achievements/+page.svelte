<script lang="ts">
	/**
	 * 개발 전용 — 업적 화면 미리보기 (Phase 31). Supabase 없이 가짜 데이터로.
	 *   /dev/achievements            업적 전체
	 *   /dev/achievements?celebrate  새 업적 축하 시트 (&one = 하나만)
	 *   /dev/achievements?uniform    교복 (Phase 60) — 넥타이 · 리본 × 배지 0~3개, 상대 프로필 시트 크기
	 *                                (배지 3개짜리는 꾹 눌러 칸을 옮길 수 있다 — Phase 69)
	 *   /dev/achievements?ribbon     업적 전체를 리본 교복으로
	 *   /dev/achievements?five       대표 칸 5개 (Phase 84 — 금 뱃지 5개) · ?uniform 에는 5칸 교복도
	 * 배포 빌드에서는 dev/+layout.ts 가 404 로 막는다.
	 */
	import { page } from '$app/state';
	import AchievementsView from '$lib/ui/AchievementsView.svelte';
	import AchievementCelebrate from '$lib/ui/AchievementCelebrate.svelte';
	import Uniform from '$lib/ui/Uniform.svelte';
	import { placedFeatured, type Achievement, type BadgeLite, type Category, type MyAchievements, type Tier } from '$lib/achievements';

	const A = (
		code: string,
		title: string,
		icon: string,
		category: Category,
		tiers: [number, number, number],
		value: number,
		tier: Tier,
		opts: Partial<Achievement> = {}
	): Achievement => ({
		code,
		title,
		icon,
		category,
		tiers,
		value,
		tier,
		description: opts.description ?? title,
		unit: opts.unit ?? '번',
		lower_better: opts.lower_better ?? false,
		earned_at: tier ? new Date().toISOString() : null,
		new: opts.new ?? false,
		granted: opts.granted ?? false
	});
	const items: Achievement[] = [
		A('warm', '따뜻한 사람', '🌡️', 'manner', [42, 45, 50], 45.2, 2, { unit: '도', description: '매너 온도', new: true }),
		A('good', '호평 수집가', '👍', 'manner', [10, 50, 200], 12, 1, { description: '"좋았어요" 평가 받기' }),
		A('kind', '친절왕', '🤝', 'manner', [10, 50, 200], 4, 0, { description: '"친절해요" 받기' }),
		A('fun', '이야기꾼', '🎉', 'manner', [10, 50, 200], 210, 3, { description: '"대화가 재밌어요" 받기' }),
		A('chats', '대화 여행자', '💬', 'chat', [5, 25, 100], 31, 2, { description: '끝까지 이어간 대화' }),
		A('extend', '연장의 달인', '⏳', 'chat', [5, 20, 50], 7, 1, { description: '둘 다 원해서 연장한 횟수' }),
		A('pin', '고정 친구', '📌', 'chat', [1, 3, 10], 1, 1, { unit: '명', description: '둘 다 고정한 채팅', new: true }),
		A('owl', '밤 올빼미', '🦉', 'chat', [5, 20, 50], 2, 0, { description: '밤 10시~12시에 시작한 대화' }),
		A('letter_got', '인기 편지함', '💌', 'letter', [5, 20, 50], 3, 0, { unit: '통', description: '받은 편지' }),
		A('deco', '꾸미기 장인', '🎨', 'letter', [3, 10, 30], 11, 2, { unit: '통', description: '글자를 꾸며 쓴 편지' }),
		// 운영진이 주는 특별 업적 (Phase 44) — 무지갯빛 · 등급 대신 "특별"
		A('beta', '베타 테스터', '🧪', 'special', [1, 1, 1], 0, 3, { unit: '', description: '출시 전 베타 테스트에 함께한 사람', granted: true }),
		A('streak', '개근상', '📅', 'special', [3, 7, 30], 5, 1, { unit: '일', description: '며칠 연속으로 접속' }),
		A('pioneer', '개척자', '🚩', 'special', [1000, 300, 100], 42, 3, { unit: '번째', description: '가입한 순서', lower_better: true }),
		// CNSA 뱃지 (Phase 70 · 71 · 90) — 실제 학교 · 동아리 핀 모양
		A('cnsa_student', 'CNSA 뱃지', '🏫', 'cnsa', [1, 1, 1], 0, 3, { unit: '', description: '충남삼성고 학생임을 증명하는 뱃지', granted: true }),
		A('msmp_gold', 'MSMP 우수 금뱃지', '🥇', 'cnsa', [1, 1, 1], 0, 3, { unit: '', description: 'MSMP 우수자에게 수여하는 뱃지', granted: true }),
		A('club_beatus', 'Beatus', '💻', 'cnsa', [1, 1, 1], 0, 0, { unit: '', description: 'IT 동아리 Beatus의 뱃지', granted: true }),
		A('club_geukjakso', '극작소', '🎬', 'cnsa', [1, 1, 1], 0, 3, { unit: '', description: '연극 동아리 극작소 부원', granted: true }),
		A('club_library', '도서부', '📚', 'cnsa', [1, 1, 1], 0, 3, { unit: '', description: '도서부 부원', granted: true }),
		A('cert_1500m', '1500m 인증제', '🏃', 'cnsa', [1, 1, 1], 0, 3, { unit: '', description: '1500m 인증제를 통과한 학생에게 주는 뱃지', granted: true }),
		A('pumgyeok', '품격위원', '🎖️', 'cnsa', [1, 1, 1], 0, 3, { unit: '', description: '품격위원으로 활동하는 학생에게 주는 뱃지', granted: true })
	];
	const feat = (c: string): BadgeLite => {
		const a = items.find((x) => x.code === c)!;
		return { code: a.code, title: a.title, icon: a.icon, tier: a.tier };
	};
	let data = $state<MyAchievements>({
		items,
		featured: page.url.searchParams.has('club') ? [feat('club_geukjakso'), feat('fun'), feat('warm')] : [feat('fun'), feat('pioneer'), feat('warm')],
		chosen: [],
		slots: page.url.searchParams.has('five') ? 5 : 3,
		golds: page.url.searchParams.has('five') ? 5 : 2
	});
	const FIVE = ['fun', 'pioneer', 'warm', 'beta', 'cnsa_student'].map((c) => feat(c));
	const celebrate = page.url.searchParams.has('celebrate');
	const uniform = page.url.searchParams.has('uniform');
	let picked = $state('');
	const fresh = page.url.searchParams.has('one') ? [feat('pin')] : [feat('warm'), feat('pin'), feat('fun')];

	async function feature(codes: string[]) {
		(window as unknown as { __featured: unknown }).__featured = codes;
		data = { ...data, chosen: codes, featured: codes.map(feat) };
		return true;
	}

</script>

{#if import.meta.env.DEV}
	<div class="topbar"><span class="title">업적 (미리보기)</span></div>
	{#if uniform}
		<div class="page ach">
			<p class="picked" aria-live="polite">{picked}</p>
			{#each [3, 2, 0] as n (n)}
				{#each ['tie', 'ribbon'] as const as neck (neck)}
					<section class="u" data-neck={neck} data-n={n}>
						<Uniform
							{neck}
							badges={data.featured.slice(0, n)}
							emptyHref="/dev/achievements"
							allHref={n === 3 ? '/dev/achievements' : undefined}
							onpick={(b) => (picked = b.title)}
							onplace={n === 3 ? (code, slot) => void feature(placedFeatured(data, code, slot)) : undefined}
						/>
					</section>
				{/each}
			{/each}
			<!-- 5칸 (Phase 84) — 깃 셋 + 가슴 주머니 위 둘 -->
			{#each ['tie', 'ribbon'] as const as neck (neck)}
				<section class="u" data-neck={neck} data-n="5">
					<Uniform {neck} badges={FIVE} slots={5} onpick={(b) => (picked = b.title)} />
				</section>
			{/each}
			<!-- 상대 프로필 시트 크기 — 빈 칸 없이 -->
			<section class="u sheet-size" data-neck="partner"><Uniform badges={data.featured.slice(0, 2)} onpick={(b) => (picked = b.title)} /></section>
		</div>
	{:else}
		<div class="page ach">
			<AchievementsView {data} onfeature={feature} neck={page.url.searchParams.has('ribbon') ? 'ribbon' : 'tie'} />
		</div>
	{/if}
	{#if celebrate}<AchievementCelebrate preview={fresh} />{/if}
{/if}

<style>
	.ach {
		gap: 14px;
		padding-top: 12px;
	}
	.picked {
		min-height: 1.4em;
		margin: 0;
	}
	.sheet-size {
		width: 100%;
		max-width: 300px;
		align-self: center;
	}
</style>

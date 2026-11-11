import { parseVerdict, type ModItem, type Verdict } from './moderation.ts';

type ModerationWork = {
	/** AI를 사용할 수 없으면 null. 다른 실패는 호출자가 던져서 작업을 중단한다. */
	review(item: ModItem): Promise<string | null>;
	save(id: number, verdict: Verdict): Promise<unknown>;
	release(ids: number[]): Promise<unknown>;
};

/** DB에서 가져온 순서대로 검토한다. 읽을 수 없는 답은 DB의 재시도 정책에 맡긴다. */
export async function moderateBatch(items: ModItem[], work: ModerationWork) {
	let checked = 0;
	let flagged = 0;
	for (const [index, item] of items.entries()) {
		try {
			const raw = await work.review(item);
			if (raw === null) {
				// AI 중단 시 현재 글과 나머지만 돌려놓는다 (이미 처리한 글은 건드리지 않는다).
				await work.release(items.slice(index).map((next) => next.id));
				break;
			}
			const verdict = parseVerdict(raw);
			if (!verdict) continue;
			await work.save(item.id, verdict);
			checked++;
			if (verdict.flag) flagged++;
		} catch (error) {
			// 원문은 로그에 남기지 않는다. 처리되지 않은 작업은 DB 재시도 상태로 돌린다.
			console.error('[moderation] task failed', { id: item.id, type: error instanceof Error ? error.name : 'unknown' });
			await work.release(items.slice(index).map((next) => next.id)).catch(() => {
				console.error('[moderation] release failed', { id: item.id });
			});
			throw error;
		}
	}
	return { checked, flagged };
}

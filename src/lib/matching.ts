import type { Seeker } from './seeker.svelte';

/** 학생 앱 레이아웃의 수명 동안 공유한다. 계정 간 전역 인스턴스를 만들지 않는다. */
export const MATCHING_CONTEXT = Symbol('matching');
export type Matching = Seeker;

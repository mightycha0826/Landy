import { slide } from 'svelte/transition';
import type { TransitionConfig } from 'svelte/transition';
import { arrive, depart, MOTION, motionDuration, settle } from './motion';

/** Keep document layout stable; use separate in:/out: directives for the shorter exit. */
export function surface(node: Element, { y = 8, scale = 0.97, duration = MOTION.settle, delay = 0 }: {
	y?: number; scale?: number; duration?: number; delay?: number;
} = {}, { direction }: { direction: 'in' | 'out' | 'both' }): TransitionConfig {
	const out = direction === 'out';
	const opacity = Number(getComputedStyle(node).opacity);
	return {
		duration: motionDuration(out ? MOTION.exit : duration),
		delay: out ? 0 : motionDuration(delay),
		easing: out ? depart : settle,
		css: (t) => `${out ? 'pointer-events: none;' : ''} opacity: ${opacity * Math.min(1, Math.max(0, t))}; transform: translateY(${(1 - t) * y}px) scale(${scale + (1 - scale) * t})`
	};
}

/** Height changes are reserved for small UI such as a reply preview. */
export function expand(node: Element, _: undefined, { direction }: { direction: 'in' | 'out' | 'both' }): TransitionConfig {
	return slide(node, { duration: motionDuration(direction === 'out' ? MOTION.exit : MOTION.enter), easing: arrive });
}

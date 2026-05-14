import { useEffect, useRef, useState } from 'react';

type UseActiveSectionOptions = {
    rootMargin?: string;
    threshold?: number | number[];
};

export default function useActiveSection(
    containerRef?: React.RefObject<HTMLElement | null>,
    options: UseActiveSectionOptions = {},
) {
    const { rootMargin = '0px 0px -40% 0px', threshold = [0.25, 0.5, 0.75] } =
        options;
    const [activeId, setActiveId] = useState<string | null>(null);

    const nodesRef = useRef<Element[]>([]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const root = containerRef?.current ?? null;
        const container = root ?? document;

        const selector = '[data-section-id]';
        const nodes = Array.from(
            (container as HTMLElement).querySelectorAll(selector),
        );

        nodesRef.current = nodes;

        if (nodes.length === 0) {
            setActiveId(null);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort(
                        (a, b) =>
                            (b.intersectionRatio ?? 0) -
                            (a.intersectionRatio ?? 0),
                    );

                if (visible.length > 0) {
                    const id =
                        visible[0].target.getAttribute('data-section-id');
                    if (id) setActiveId(id);
                } else {
                    const sortedByTop = entries.sort(
                        (a, b) =>
                            (a.boundingClientRect.top ?? 0) -
                            (b.boundingClientRect.top ?? 0),
                    );
                    const first = sortedByTop[0];
                    const id =
                        first?.target?.getAttribute('data-section-id') ?? null;
                    setActiveId(id);
                }
            },
            {
                root: root ?? null,
                rootMargin,
                threshold,
            },
        );

        nodes.forEach((n) => observer.observe(n));

        return () => observer.disconnect();
    }, [containerRef, rootMargin, threshold]);

    const scrollToSection = (id: string) => {
        if (typeof window === 'undefined') return;

        const root = containerRef?.current ?? document;
        const target = (root as HTMLElement).querySelector<HTMLElement>(
            `[data-section-id="${id}"]`,
        ) as HTMLElement | null;
        if (!target) return;

        const containerEl = containerRef?.current;
        if (containerEl) {
            // compute relative top within container
            const top = target.offsetTop;
            containerEl.scrollTo({ top: top - 12, behavior: 'smooth' });
            // move focus for a11y
            try {
                target.focus({ preventScroll: true });
            } catch (e) {}
        } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            try {
                target.focus({ preventScroll: true });
            } catch (e) {}
        }
    };

    return {
        activeId,
        scrollToSection,
    } as const;
}

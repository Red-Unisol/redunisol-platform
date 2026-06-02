import { useEffect, useRef, useState } from 'react';

type UseActiveSectionOptions = {
    rootMargin?: string;
    threshold?: number | number[];
};

/** Returns true when `el` has its own scrollable overflow axis. */
function isScrollable(el: HTMLElement): boolean {
    const { overflowY } = window.getComputedStyle(el);
    const scrollable = overflowY === 'auto' || overflowY === 'scroll';
    return scrollable && el.scrollHeight > el.clientHeight;
}

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

        const containerEl = containerRef?.current ?? null;

        // Use the container as IntersectionObserver root only when it actually
        // scrolls on its own (desktop split layout). On mobile the page scrolls,
        // so we must observe against the viewport (root: null).
        const observerRoot =
            containerEl && isScrollable(containerEl) ? containerEl : null;

        const searchRoot = observerRoot ?? document;
        const nodes = Array.from(
            (searchRoot as HTMLElement).querySelectorAll('[data-section-id]'),
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
                root: observerRoot,
                rootMargin,
                threshold,
            },
        );

        nodes.forEach((n) => observer.observe(n));

        return () => observer.disconnect();
    }, [containerRef, rootMargin, threshold]);

    const scrollToSection = (id: string) => {
        if (typeof window === 'undefined') return;

        // Search in the container when available, otherwise in the whole document.
        const searchRoot = containerRef?.current ?? document;
        const target = (searchRoot as HTMLElement).querySelector<HTMLElement>(
            `[data-section-id="${id}"]`,
        );
        if (!target) return;

        const containerEl = containerRef?.current;

        if (containerEl && isScrollable(containerEl)) {
            // Desktop: container has its own scroll — scroll within it.
            containerEl.scrollTo({
                top: target.offsetTop - 12,
                behavior: 'smooth',
            });
        } else {
            // Mobile / no-scroll container: scroll the window to the element.
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        try {
            target.focus({ preventScroll: true });
        } catch (_) {
            // focus() can throw on non-focusable elements — safe to ignore.
        }
    };

    return {
        activeId,
        scrollToSection,
    } as const;
}

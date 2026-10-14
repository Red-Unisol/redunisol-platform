import { usePage } from '@inertiajs/react';
import { WhatsappLogo } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

interface SharedProps {
    siteData?: {
        settings?: Record<string, string>;
    };
    [key: string]: unknown;
}

interface WhatsAppButtonProps {
    phone?: string | null;
    message?: string | null;
    positionClass?: string;
    showOn?: 'all' | 'mobile' | 'desktop';
    variant?: 'floating' | 'inline';
}

export default function WhatsAppButton({
    phone: phoneProp = null,
    message: messageProp = null,
    showOn = 'all',
    variant = 'floating',
}: WhatsAppButtonProps) {
    const { props, url } = usePage<SharedProps>();
    const { siteData } = props;
    const settings = siteData?.settings ?? {};
    const [formVisibility, setFormVisibility] = useState({
        url: '',
        visible: false,
    });
    const formVisible = formVisibility.url === url && formVisibility.visible;

    useEffect(() => {
        if (variant !== 'floating') return;

        const forms = document.querySelectorAll('[data-loan-form]');
        const visibility = new Map<Element, boolean>();
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                visibility.set(entry.target, entry.isIntersecting);
            }
            setFormVisibility({
                url,
                visible: [...visibility.values()].some(Boolean),
            });
        });

        for (const form of forms) observer.observe(form);

        return () => observer.disconnect();
    }, [variant, url]);

    const rawPhone = (phoneProp ?? settings['whatsapp_phone'] ?? '').trim();
    const rawMessage =
        (messageProp ?? settings['whatsapp_message'] ?? '').trim() ||
        'Hola, quisiera recibir información sobre los préstamos.'; //revisar

    const phoneDigits = rawPhone.replace(/\D+/g, '');

    if (!phoneDigits) {
        return null;
    }

    const encodedMessage = encodeURIComponent(rawMessage);
    const waUrl = `https://wa.me/${phoneDigits}?text=${encodedMessage}`;

    if (variant === 'inline') {
        return (
            <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="¿Necesitás ayuda? Escribinos por WhatsApp"
                className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg text-center text-xs font-medium text-[#1e2d3d] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
            >
                <WhatsappLogo
                    size={20}
                    weight="fill"
                    className="shrink-0 text-[#25D366]"
                />
                <span>¿Necesitás ayuda? Escribinos</span>
            </a>
        );
    }

    const visibilityClass =
        showOn === 'all'
            ? ''
            : showOn === 'mobile'
              ? 'sm:hidden'
              : showOn === 'desktop'
                ? 'hidden sm:flex'
                : '';

    return (
        <div
            className={`fixed right-4 bottom-4 z-50 ${visibilityClass} ${formVisible ? 'max-md:hidden' : ''}`}
            style={{ inset: 'auto', bottom: '2rem', right: '2rem' }}
        >
            <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contactar vía WhatsApp"
                className="flex h-16 w-16 items-center justify-center rounded-full border border-[#25D366] bg-white shadow-lg transition-transform hover:scale-105 focus:ring-2 focus:ring-[#25d366] focus:ring-offset-2 focus:outline-none"
            >
                <WhatsappLogo
                    size={32}
                    weight="fill"
                    className="text-[#25D366]"
                />
            </a>
        </div>
    );
}

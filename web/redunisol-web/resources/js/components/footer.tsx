import {
    FacebookLogo,
    InstagramLogo,
    LinkedinLogo,
    YoutubeLogo,
} from '@phosphor-icons/react';

const socialLinks = [
    {
        label: 'Facebook',
        href: 'https://www.facebook.com/redunisol',
        icon: FacebookLogo,
    },
    {
        label: 'LinkedIn',
        href: 'https://www.linkedin.com/company/redunisol/',
        icon: LinkedinLogo,
    },
    {
        label: 'Instagram',
        href: 'https://www.instagram.com/redunisol_prestamos/',
        icon: InstagramLogo,
    },
    {
        label: 'YouTube',
        href: 'https://www.youtube.com/@redunisol5007',
        icon: YoutubeLogo,
    },
];

export default function Footer() {
    return (
        <footer className="bg-white px-8 py-12">
            <div className="m-auto flex max-w-200 items-center justify-between">
                <p className="text-sm text-gray-800">
                    © 2026 By{' '}
                    <a
                        href="https://solva.ar/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 underline-offset-2 hover:underline"
                    >
                        Solva
                    </a>
                </p>

                <div className="flex items-center gap-3">
                    {socialLinks.map(({ label, href, icon: Icon }) => (
                        <a
                            key={label}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={label}
                            className="text-gray-800 transition-opacity hover:opacity-60"
                        >
                            <Icon size={16} weight="bold" />
                        </a>
                    ))}
                </div>
            </div>
        </footer>
    );
}

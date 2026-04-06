import {
    InfoIcon,
    MoneyIcon,
    QuestionIcon,
    UserCheckIcon,
} from '@phosphor-icons/react';

export const tabs = [
    {
        label: 'Solicitá hoy',
        icon: <UserCheckIcon size={24} />,
        key: 'solicita',
    },
    {
        label: 'Créditos',
        icon: <MoneyIcon size={24} />,
        key: 'creditos',
    },
    {
        label: 'Sobre nosotros',
        icon: <InfoIcon size={24} />,
        key: 'about',
    },
    {
        label: 'FAQs',
        icon: <QuestionIcon size={24} />,
        key: 'faqs',
    },
];

export default function NavTabs({ activeTab, setActiveTab }) {
    return (
        <nav className="flex w-full items-center justify-between bg-white px-8 py-4">
            {/* Logo */}
            <div className="flex items-center gap-2">
                <img src="/images/logo.svg" alt="UNISOL" className="h-8" />
                <span className="text-2xl font-bold text-[#6BAF92]">
                    UNISOL
                </span>
            </div>
            {/* Tabs */}
            <div className="flex items-center gap-4">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`text-normal flex items-center gap-2 rounded-xl px-2 py-2 font-semibold transition ${
                            activeTab === tab.key
                                ? 'bg-[#cbd5e1] text-[#1F2A37]'
                                : 'bg-transparent text-[#1F2A37] opacity-70 hover:opacity-100'
                        }`}
                    >
                        {tab.icon}
                        {activeTab === tab.key && <span>{tab.label}</span>}
                    </button>
                ))}
            </div>
        </nav>
    );
}

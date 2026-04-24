import { motion } from 'framer-motion';
import {
    ClockIcon,
    EnvelopeIcon,
    MapPinIcon,
    PhoneIcon,
} from '@phosphor-icons/react';

export interface ContactSectionData {
    title: string;
    description?: string;
    email?: string;
    phone?: string;
    address?: string;
    hours?: string;
}

interface ContactItemProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    href?: string;
}

function ContactItem({ icon, label, value, href }: ContactItemProps) {
    const content = (
        <div className="flex items-start gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-5">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f4ef] text-[#6BAF92]">
                {icon}
            </div>
            <div>
                <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-gray-800">{value}</p>
            </div>
        </div>
    );

    if (href) {
        return <a href={href}>{content}</a>;
    }
    return content;
}

export default function ContactSection({ data }: { data: ContactSectionData }) {
    return (
        <section className="w-full py-20">
            <div className="mx-auto max-w-3xl px-6">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-10 text-center"
                >
                    <h1 className="text-3xl font-bold text-gray-900">{data.title}</h1>
                    {data.description && (
                        <p className="mt-3 text-base text-gray-600">{data.description}</p>
                    )}
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="grid gap-4 sm:grid-cols-2"
                >
                    {data.email && (
                        <ContactItem
                            icon={<EnvelopeIcon size={20} />}
                            label="Email"
                            value={data.email}
                            href={`mailto:${data.email}`}
                        />
                    )}
                    {data.phone && (
                        <ContactItem
                            icon={<PhoneIcon size={20} />}
                            label="Teléfono"
                            value={data.phone}
                            href={`tel:${data.phone}`}
                        />
                    )}
                    {data.address && (
                        <ContactItem
                            icon={<MapPinIcon size={20} />}
                            label="Dirección"
                            value={data.address}
                        />
                    )}
                    {data.hours && (
                        <ContactItem
                            icon={<ClockIcon size={20} />}
                            label="Horarios"
                            value={data.hours}
                        />
                    )}
                </motion.div>
            </div>
        </section>
    );
}

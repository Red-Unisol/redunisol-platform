import Hero from '@/components/hero';

export default function Page({ sections }) {
    return (
        <>
            {sections?.map((section, index) => {
                switch (section.type) {
                    case 'hero':
                        return <Hero key={index} data={section.data} />;

                    default:
                        return null;
                }
            })}
        </>
    );
}

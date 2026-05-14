import { defaultSectionLabel } from '@/components/navbar';

export default function LandingFooterLinks({
  sections,
  onNavigate,
}: {
  sections: { id: string; type: string; data?: any }[];
  onNavigate?: (id: string) => void;
}) {
  return (
    <div className="bg-white px-8 py-8">
      <div className="mx-auto max-w-200 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            Reguladores Autorizados
          </h3>

          <div className="flex flex-wrap items-center gap-3">
            {/* Placeholder logos/links - replace with real images if available */}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-block rounded bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700"
            >
              AFIP
            </a>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-block rounded bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700"
            >
              Banco Central
            </a>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-block rounded bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700"
            >
              ENACOM
            </a>
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Secciones</h4>

          <ul className="flex flex-wrap gap-2">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onNavigate ? onNavigate(s.id) : undefined}
                  className="text-sm text-gray-600 underline-offset-2 hover:underline"
                >
                  {defaultSectionLabel(s.type, s.data)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

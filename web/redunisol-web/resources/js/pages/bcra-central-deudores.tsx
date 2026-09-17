import { Head } from '@inertiajs/react';
import { ExternalLink, FileArchive, LockKeyhole, ServerCog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';
import { type BreadcrumbItem } from '@/types';

interface BcraCentralDeudoresProps {
    panelUrl: string;
}

const breadcrumbs: BreadcrumbItem[] = [
    {
        title: 'Dashboard',
        href: '/dashboard',
    },
    {
        title: 'BCRA Central Deudores',
        href: '/herramientas/bcra-central-deudores',
    },
];

export default function BcraCentralDeudores({
    panelUrl,
}: BcraCentralDeudoresProps) {
    const configuredPanelUrl = panelUrl || 'http://127.0.0.1:8080';

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="BCRA Central Deudores" />
            <main className="flex flex-1 flex-col gap-4 p-4">
                <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <FileArchive className="size-4" />
                            Herramienta interna
                        </div>
                        <h1 className="text-2xl font-semibold tracking-normal">
                            BCRA Central de Deudores PNFC
                        </h1>
                        <p className="max-w-3xl text-sm text-muted-foreground">
                            Acceso operativo al panel que genera la presentacion mensual y el archivo final
                            <span className="font-medium text-foreground"> informacion.zip</span>.
                        </p>
                    </div>
                    <Button asChild size="lg">
                        <a
                            href={configuredPanelUrl}
                            rel="noreferrer"
                            target="_blank"
                        >
                            Abrir panel BCRA
                            <ExternalLink className="size-4" />
                        </a>
                    </Button>
                </section>

                <section className="grid gap-4 lg:grid-cols-3">
                    <Card>
                        <CardHeader>
                            <CardTitle>Panel operativo</CardTitle>
                            <CardDescription>Servicio Python validado</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                                {configuredPanelUrl}
                            </p>
                            <p className="text-muted-foreground">
                                La web no recalcula la presentacion: abre el panel BCRA para conservar la
                                logica regulatoria ya probada.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Archivo final</CardTitle>
                            <CardDescription>Contenido de presentacion</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="rounded-md border px-3 py-2 font-medium">informacion.zip</div>
                            <ul className="space-y-1 text-muted-foreground">
                                <li>detalle.xml</li>
                                <li>YYYYMMDD/IMPORTES.TXT</li>
                                <li>YYYYMMDD/PROVEEDORES.TXT</li>
                                <li>YYYYMMDD/TASA.TXT</li>
                            </ul>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Acceso</CardTitle>
                            <CardDescription>Protegido por la web interna</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-foreground">
                                <LockKeyhole className="size-4" />
                                Requiere sesion Laravel
                            </div>
                            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-foreground">
                                <ServerCog className="size-4" />
                                URL tomada de BCRA_PANEL_URL
                            </div>
                        </CardContent>
                    </Card>
                </section>

                <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground shadow-sm">
                    <h2 className="mb-2 text-base font-semibold text-foreground">Operacion</h2>
                    <p>
                        Para operar una presentacion, iniciar el servicio Python de BCRA en el host interno y
                        abrirlo desde este modulo. Las bases SQLite, corridas, TXT, ZIP y configuraciones
                        reales quedan como estado operativo fuera de Git.
                    </p>
                </section>
            </main>
        </AppLayout>
    );
}

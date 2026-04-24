<?php

namespace Database\Seeders;

use App\Models\Page;
use Illuminate\Database\Seeder;

class LegalPagesSeeder extends Seeder
{
    public function run(): void
    {
        $pages = [
            [
                'title'            => 'Sobre Nosotros',
                'slug'             => '/sobre-nosotros',
                'meta_title'       => 'Sobre Nosotros | Red Unisol',
                'meta_description' => 'Conocé la historia y misión de Red Unisol, la red de mutuales que brinda ayudas económicas en Argentina.',
                'keyword'          => 'sobre nosotros red unisol mutual',
                'index'            => true,
                'sections'         => [
                    [
                        'type' => 'legal_text',
                        'data' => [
                            'title'   => 'Sobre Red Unisol',
                            'content' => '<p>Red Unisol es el resultado de un trabajo conjunto de <strong>Asociación Mutual Celesol de Servicios Integrales y Educativos</strong> y la <strong>Asociación Mutual Fiat Concord</strong>, que han mancomunado sus visiones y esfuerzos a los efectos de conformar una agrupación de mutuales que conlleve una estructura de servicios mutuales a los socios de ambas entidades y a los socios de las entidades con las cuales se mantiene convenios.</p><h2>Nuestras Mutuales</h2><p>La red está compuesta por mutuales con amplia trayectoria en toda Argentina, brindando servicios de crédito, farmacia, educación, sepelio y turismo a sus asociados.</p><h2>Contacto</h2><p>Podés escribirnos a <strong>info@redunisol.com.ar</strong> para más información.</p>',
                        ],
                    ],
                    [
                        'type' => 'about',
                        'data' => [
                            'title'       => 'Acerca de Red Unisol',
                            'description' => 'Red Unisol es el resultado de un trabajo conjunto de Asociación Mutual Celesol de Servicios Integrales y Educativos y la Asociación Mutual Fiat Concord.',
                            'extra'       => '+12 años | +50.000 créditos otorgados',
                            'mutuales'    => [],
                        ],
                    ],
                    [
                        'type' => 'regulatory',
                        'data' => ['title' => 'Respaldados por'],
                    ],
                ],
            ],
            [
                'title'            => 'Contacto',
                'slug'             => '/contacto',
                'meta_title'       => 'Contacto | Red Unisol',
                'meta_description' => 'Contactate con Red Unisol. Estamos para ayudarte con tu solicitud de crédito.',
                'keyword'          => 'contacto red unisol',
                'index'            => true,
                'sections'         => [
                    [
                        'type' => 'contact',
                        'data' => [
                            'title'       => 'Contacto',
                            'description' => 'Estamos para ayudarte. Escribinos o llamanos y te responderemos a la brevedad.',
                            'email'       => 'info@redunisol.com.ar',
                            'phone'       => '',
                            'address'     => 'Córdoba, Argentina',
                            'hours'       => 'Lunes a Viernes de 9:00 a 18:00 hs.',
                        ],
                    ],
                ],
            ],
            [
                'title'            => 'Políticas de Privacidad',
                'slug'             => '/politicas-de-privacidad',
                'meta_title'       => 'Políticas de Privacidad | Red Unisol',
                'meta_description' => 'Conocé cómo Red Unisol protege tus datos personales según la Ley 25.326.',
                'keyword'          => 'política privacidad datos personales red unisol',
                'index'            => true,
                'sections'         => [
                    [
                        'type' => 'legal_text',
                        'data' => [
                            'title'   => 'Políticas de Privacidad',
                            'content' => '<p>En <strong>Red Unisol</strong> nos comprometemos a proteger tu privacidad de acuerdo con la <strong>Ley N° 25.326 de Protección de Datos Personales</strong> de la República Argentina.</p><h2>Datos que recopilamos</h2><p>Recopilamos los datos que nos proporcionás al solicitar un crédito: nombre completo, CUIL, email, teléfono y documentación complementaria requerida para la evaluación crediticia.</p><h2>Uso de los datos</h2><p>Los datos son utilizados exclusivamente para evaluar y otorgar créditos, contactarte en relación a tu solicitud, y cumplir con las obligaciones regulatorias ante el BCRA y el INAES.</p><h2>Compartición de datos</h2><p>No vendemos ni cedemos tus datos personales a terceros. Podemos compartirlos con las mutuales afiliadas a Red Unisol a los efectos de procesar tu solicitud.</p><h2>Seguridad</h2><p>Implementamos medidas técnicas y organizativas adecuadas para proteger tus datos contra acceso no autorizado, pérdida o destrucción.</p><h2>Tus derechos</h2><p>Podés ejercer los derechos de acceso, rectificación, cancelación y oposición sobre tus datos contactándonos a <strong>info@redunisol.com.ar</strong>. La <strong>DIRECCIÓN NACIONAL DE PROTECCIÓN DE DATOS PERSONALES</strong>, órgano de control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.</p>',
                        ],
                    ],
                ],
            ],
            [
                'title'            => 'Gestión de Datos',
                'slug'             => '/gestion-de-datos',
                'meta_title'       => 'Gestión de Datos | Red Unisol',
                'meta_description' => 'Información sobre cómo gestionamos tus datos personales en Red Unisol.',
                'keyword'          => 'gestión datos personales red unisol baja datos',
                'index'            => true,
                'sections'         => [
                    [
                        'type' => 'legal_text',
                        'data' => [
                            'title'   => 'Gestión de Datos Personales',
                            'content' => '<p>De conformidad con la <strong>Ley N° 25.326 de Protección de Datos Personales</strong>, tenés derecho a solicitar la baja, modificación o acceso a tus datos personales en cualquier momento.</p><h2>Cómo ejercer tus derechos</h2><p>Para solicitar la eliminación o rectificación de tus datos, escribí a <strong>info@redunisol.com.ar</strong> indicando:</p><ul><li>Tu nombre completo</li><li>CUIL / DNI</li><li>El tipo de solicitud (acceso, rectificación, eliminación u oposición)</li><li>Descripción de lo que necesitás</li></ul><h2>Plazos de respuesta</h2><p>Responderemos tu solicitud en un plazo máximo de <strong>5 días hábiles</strong>. En caso de requerir más tiempo, te informaremos por email.</p><h2>Retención de datos</h2><p>Conservamos tus datos durante el tiempo necesario para cumplir con la finalidad para la que fueron recopilados y con las obligaciones legales aplicables.</p><h2>Contacto DNPDP</h2><p>Si considerás que no hemos atendido tu solicitud adecuadamente, podés comunicarte con la <strong>Dirección Nacional de Protección de Datos Personales</strong> en <a href="https://www.argentina.gob.ar/aaip/datospersonales">www.argentina.gob.ar/aaip/datospersonales</a>.</p>',
                        ],
                    ],
                ],
            ],
        ];

        foreach ($pages as $pageData) {
            Page::updateOrCreate(
                ['slug' => $pageData['slug']],
                $pageData
            );
        }
    }
}

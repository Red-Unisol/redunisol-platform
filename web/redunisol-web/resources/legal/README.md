# Documentos legales de la plataforma

Las páginas `/terminos` y `/privacidad` reutilizan Navbar, Footer, colores y tipografía del sitio. Presentan una cabecera, un índice lateral en escritorio y un índice desplegable en móvil. El contenido se sirve desde estos HTML. No necesitan una página del CMS, un seeder ni una migración.

El 22/11/2026 el usuario aprobó la publicación y pidió retirar la condición de borrador. Se desactivó esa marca y se retiraron las notas internas «Para cerrar el borrador» de ambos HTML, conservando sus ocho secciones legales. No se inventó una fecha de vigencia ni se añadieron datos legales no proporcionados. Se conserva la política existente `noindex, nofollow` y la exclusión del sitemap; este cambio no modifica SEO.

El HTML parte del texto de los PDF, omitiendo encabezados/pies repetidos y numeración de páginas; título y subtítulo se muestran en la cabecera. El 21/11/2026, por pedido del usuario, se agregó al punto 5 de los términos una aclaración de que Red Unisol no garantiza el pago de las cuotas ni adquiere la condición de garante, fiadora o codeudora por gestionar la solicitud, conservando sus obligaciones propias. Esta adición y la retirada de las notas de borrador están en el HTML; los PDF originales quedan como referencia histórica, sin opciones de apertura o descarga en la interfaz ni URL de PDF en las propiedades de la página.

Para una revisión futura, actualizar el HTML a partir del documento aprobado, revisar el contenido y comprobar las dos páginas en escritorio y móvil. Los metadatos están en `config/legal_documents.php`. El índice se genera con los encabezados h2 del documento sin alterar su contenido. Cualquier cambio posterior de indexación debe tratarse explícitamente.

Los enlaces antiguos `/politicas-de-privacidad` y `/terminos-y-condiciones` redirigen a las páginas correspondientes. Las rutas legales tienen prioridad sobre redirecciones históricas o del CMS que antes enviaban a otras páginas.

En `/finalizar`, `/finalizar.php` y `/finalizar-nvo`, el acceso «Términos y condiciones de la plataforma» abre una ventana de lectura sin salir de la página. Usa `LegalDocumentService`, la misma fuente que `/terminos`, y recibe el contenido con la respuesta inicial. No abre PDFs ni documentos contractuales de la operación, ni agrega una aceptación obligatoria.

La antigua configuración `finalizar_terms_url` y la variable `FINALIZAR_TERMS_URL` ya no se consumen en Finalizar. Se retiró el campo del panel administrativo, sin borrar valores históricos de la base. El archivo `public/terminos-y-condiciones.pdf` se conserva; no se reemplaza ni se utiliza para este modal. Tampoco se modifican los consentimientos ni su almacenamiento.

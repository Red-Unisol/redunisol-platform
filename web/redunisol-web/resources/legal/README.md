# Documentos legales de la plataforma

Las páginas `/terminos` y `/privacidad` reutilizan Navbar, Footer, colores y tipografía del sitio. Presentan una cabecera, un índice lateral en escritorio y un índice desplegable en móvil. El contenido se sirve desde estos HTML. No necesitan una página del CMS, un seeder ni una migración.

Los dos archivos suministrados se titulan **BORRADOR PARA REVISIÓN** e incluyen notas «Para cerrar el borrador». Se conservaron sin modificaciones sustantivas, incluida esa condición. No se les asignó una fecha de vigencia ni se los presentó como documentos aprobados. Las páginas llevan `noindex, nofollow` y se excluyen del sitemap mientras se revisan.

El HTML conserva el texto del PDF, omitiendo únicamente encabezados/pies repetidos y la numeración de páginas; título, subtítulo y condición de borrador se muestran en la cabecera. Los PDF originales se conservan como referencia en `public/legal/`, sin opciones de apertura o descarga en la interfaz ni URL de PDF en las propiedades de la página.

Para una revisión futura, actualizar el HTML a partir del documento aprobado, revisar el contenido y comprobar las dos páginas en escritorio y móvil. Los metadatos están en `config/legal_documents.php`. El índice se genera con los encabezados h2 del documento sin alterar su contenido. Para publicar versiones finales hay que revisar también la condición de borrador y las reglas de indexación; no basta reemplazar el archivo.

Los enlaces antiguos `/politicas-de-privacidad` y `/terminos-y-condiciones` redirigen a las páginas correspondientes. Las rutas legales tienen prioridad sobre redirecciones históricas o del CMS que antes enviaban a otras páginas.

No se reemplaza `public/terminos-y-condiciones.pdf`: ese archivo ya se utiliza en el circuito de finalización del préstamo, distinto de los términos de uso de la plataforma. Tampoco se modifican los consentimientos ni su almacenamiento.

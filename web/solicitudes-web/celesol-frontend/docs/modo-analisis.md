# Modo análisis en el detalle

Al entrar a Evaluación se activa Modo análisis: se pliegan el título grande, los datos rápidos del titular y las acciones generales. Se mantiene un encabezado compacto con el titular, el estado y el regreso al listado. El menú lateral continúa cerrándose con el mecanismo existente.

El botón Modo análisis permanece visible junto a las pestañas. Desactivarlo muestra el encabezado completo y las acciones; volver a activarlo recupera espacio y cierra el menú lateral. Al salir de Evaluación se presenta el detalle habitual y al volver se activa nuevamente el modo compacto.

El plegado se realiza por CSS sin desmontar los componentes del encabezado. La única instancia de Evaluación se mantiene en el mismo lugar: no se recarga el snapshot, no se guarda automáticamente y no cambia la hoja ni se descartan ediciones. Guardar evaluación, controles de recibos y pestañas siguen visibles. El aviso de salida con cambios sin guardar y la identificación de acceso como otro usuario se conservan.

Comprobaciones: build y lint del frontend. Navegador con AppLayout y Univer reales, API simulada y libro de 11 hojas: entrada compacta, alternancia con clic y teclado, ganancia de 184 píxeles en una pantalla de 1440×950, conservación de la instancia, hoja CAJA y valor sin guardar, una sola consulta de evaluación y botón accesible con ancho de 800 píxeles. No se modificaron solicitudes reales.

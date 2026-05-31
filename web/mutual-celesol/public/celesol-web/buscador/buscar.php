<?php
// Evitamos que PHP muestre errores en pantalla que arruinen la comunicación con la web
error_reporting(0);
header('Content-Type: application/json; charset=utf-8');

$busqueda_original = isset($_GET['q']) ? trim($_GET['q']) : '';
$resultados = [];

if (strlen($busqueda_original) >= 3) {
    
    // Limpiamos dobles espacios y separamos en palabras
    $busqueda_limpia = preg_replace('/\s+/', ' ', $busqueda_original);
    $palabras_buscadas = explode(" ", $busqueda_limpia);
    
    $archivos = glob('datos/*.csv'); 
    
    foreach ($archivos as $archivo) {
        if (($gestor = fopen($archivo, "r")) !== FALSE) {
            
            // 1. DETECCIÓN AUTOMÁTICA DEL SEPARADOR (, o ;)
            $primera_linea = fgets($gestor);
            $separador = (strpos($primera_linea, ';') !== false) ? ';' : ',';
            
            // Volvemos al inicio del archivo tras leer la primera línea
            rewind($gestor);
            
            // 2. DETECCIÓN AUTOMÁTICA DE LA COLUMNA
            $cabeceras_crudas = fgetcsv($gestor, 0, $separador);
            // Limpiamos las cabeceras para quitar caracteres invisibles que deja Excel
            $cabeceras = array_map(function($val) {
                return trim(preg_replace('/[\x00-\x1F\x80-\xFF]/', '', $val)); 
            }, $cabeceras_crudas);
            
            // Buscamos en qué posición (índice) está APELLIDO_NOMBRE
            $indice_nombre = 2; // Por defecto asumimos la 3
            foreach ($cabeceras as $index => $titulo) {
                if (stripos($titulo, 'APELLIDO') !== false || stripos($titulo, 'NOMBRE') !== false) {
                    $indice_nombre = $index;
                    break;
                }
            }

            // 3. LECTURA Y BÚSQUEDA
            while (($fila = fgetcsv($gestor, 0, $separador)) !== FALSE) {
                if (isset($fila[$indice_nombre])) {
                    $nombre_en_archivo = $fila[$indice_nombre];
                    
                    // Verificamos que todas las palabras buscadas estén en el nombre
                    $coincide = true;
                    foreach ($palabras_buscadas as $palabra) {
                        if (stripos($nombre_en_archivo, trim($palabra)) === false) {
                            $coincide = false;
                            break; 
                        }
                    }
                    
                    if ($coincide && count($cabeceras_crudas) == count($fila)) {
                        // 4. CORRECCIÓN DE ACENTOS (Para que no falle json_encode)
                        $fila_utf8 = array_map(function($texto) {
                            // Convertimos de Windows-1252/ISO a UTF-8 si es necesario
                            return mb_convert_encoding($texto, 'UTF-8', 'UTF-8, ISO-8859-1, Windows-1252');
                        }, $fila);
                        
                        $registro = array_combine($cabeceras_crudas, $fila_utf8);
                        $resultados[] = $registro;
                    }
                    
                    if (count($resultados) >= 100) break 2; 
                }
            }
            fclose($gestor);
        }
    }
}

// Enviamos los datos. Si hay un error de JSON, mostramos cuál fue en el log.
echo json_encode($resultados, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_IGNORE);
?>
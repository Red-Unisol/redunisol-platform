# Pegado de importes argentinos en Evaluación

La calculadora reconoce importes pegados desde afuera de Univer con puntos de miles y coma decimal. Los ejemplos `2.046.287,77`, `12.100,00`, `140.234,8` y `4.457,80` quedan como números, aptos para sumas y fórmulas. También admite signos, el prefijo $ o ARS y miles sin decimales (`1.000`).

La conversión se limita al pegado externo en la instancia de la calculadora. No recorre ni modifica evaluaciones guardadas, fórmulas, copias internas, texto deliberado con apóstrofo ni celdas con formato Texto (@). Los formatos no reconocidos conservan el comportamiento habitual de Univer. El parser no interpreta fechas, porcentajes, agrupaciones inválidas ni importes fuera del rango numérico seguro.

Se usan el hook de clipboard y el listener previo a la mutación de la versión instalada (Univer 0.25.1). Se modifica el valor del mismo pegado antes de ejecutar la escritura, conservando el historial nativo de deshacer y rehacer. No se ejecuta una segunda escritura ni se remonta la planilla. El listener y su alcance temporal se liberan al cerrar la instancia.

Una lista o tabla de texto que contiene solamente importes reconocidos y celdas vacías se transforma en una tabla de celdas, respetando filas y tabulaciones. No se reinterpretan párrafos de texto mixto como tablas. Las tablas HTML existentes conservan su circuito habitual.

Comprobaciones: pruebas del parser y de listas; build y lint del frontend; prueba en Chromium con Univer real de los cuatro valores individuales, tabla HTML, lista de cuatro filas, suma resultante (2203080.37), miles sin decimales, formato Texto y deshacer/rehacer sobre una celda que tenía texto numérico anterior. Se utilizó una planilla de prueba local; no se modificaron solicitudes reales.

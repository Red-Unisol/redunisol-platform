# Tope Caja Masivo

Consulta el tope de descuento en Caja de Jubilaciones para una lista de CUILs y
devuelve una planilla con los resultados.

Es la version masiva de lo que el flow `tope_descuento_caja` hace de a un CUIL
por vez desde el panel de herramientas.

> Estado: en construccion. La estructura esta armada y la logica se agrega por
> pasos. Ver "Estado de avance" al final.

## Por que vive en `apps/` y no en Kestra

Se ejecuta a mano, como maximo una vez al mes, y una corrida completa demora un
par de horas. No hay evento que la dispare ni nadie esperando la respuesta, asi
que el webhook, el trigger y el YAML de un flow serian ceremonia sin uso. Ese es
el criterio que el README raiz fija para `apps/`: cosas que no deben modelarse
como flows.

Se ejecuta **en el VPS**, que es de donde salen hoy las llamadas a CIDI y Caja.

## Como funciona

Entra un Excel con CUILs, sale un Excel con el tope de descuento de cada uno.

El proceso es secuencial y lento a proposito: consulta de a un CUIL, espera, y
sigue. No hay ninguna razon para apurar a un organismo publico cuando la corrida
puede demorar lo que haga falta.

La sesion contra CIDI y Caja se abre **una sola vez** y se reusa para toda la
tanda. Autenticar en cada CUIL duplicaria los pedidos, y justo contra los
endpoints de login.

## Que pasa si se corta

Nada grave. Cada resultado se escribe en un CSV apenas se obtiene, asi que un
corte pierde como mucho el CUIL en curso. Al volver a lanzar la corrida, los
CUILs que ya tienen resultado se saltean y sigue por donde iba.

El Excel final se arma al terminar, a partir de ese CSV.

## Estructura

```text
src/tope_caja_masivo/
  config.py       de donde salen las credenciales
  caja.py         sesion CIDI + Caja y consulta de un CUIL
  planilla.py     lee el Excel de entrada, arma el Excel de resultados
  registro.py     el CSV de trabajo: appendear y saber que ya se hizo
  runner.py       el bucle: recorre, pausa, reanuda, corta
  __main__.py     python -m tope_caja_masivo
tests/            pruebas de lo que no necesita red
corridas/         estado de cada corrida (fuera de git)
```

El layout `src/` y el venv propio siguen la convencion del resto de `apps/`.

`planilla.py` y `registro.py` parecen lo mismo pero no lo son: el primero maneja
el formato en el que llegan y se entregan los datos, el segundo el estado de
trabajo mientras la corrida avanza. Esa separacion es la que permite reanudar.

Una corrida deja:

```text
corridas/2026-09-01/
  entrada.xlsx      la planilla recibida
  resultados.csv    se va llenando fila por fila
  corrida.log       que paso y cuando
  resultados.xlsx   se genera al final
```

`corridas/` esta fuera de git: son CUILs de personas reales.

## Instalacion

```bash
cd apps/tope-caja-masivo
python -m venv .venv
. .venv/bin/activate          # en Windows: .venv\Scripts\activate
pip install -e .
```

## Uso

```bash
# la corrida completa
python -m tope_caja_masivo planilla.xlsx

# probar con los primeros 10 antes de largar todo
python -m tope_caja_masivo planilla.xlsx --limite 10

# elegir el directorio de la corrida (por defecto corridas/<fecha de hoy>)
python -m tope_caja_masivo planilla.xlsx --corrida corridas/2026-09-01
```

Opciones: `--pausa` (3 s por defecto), `--limite`, `--max-fallos` (8).

Para consultar un CUIL suelto y ver cuanto tarda cada llamada:

```bash
python -m tope_caja_masivo.caja 20123456783
```

Correr los tests:

```bash
python -m pytest tests/
```

## Si se corta

Volver a lanzar **el mismo comando**. No hay que indicarle por donde iba.

- los CUILs con respuesta definitiva (`completed`, `not_found`, `invalid_cuil`)
  se saltean
- los que quedaron en `technical_error` se reintentan
- la sesion se reabre sola, y cuesta unos 2 segundos

La corrida tambien frena sola, dejando todo guardado, si Caja responde 429 o si
se acumulan 8 fallos tecnicos seguidos. En los dos casos el remedio es el mismo:
volver a lanzarla mas tarde.

## Configuracion

Esta app **no tiene credenciales propias**. Usa las mismas que el flow de Kestra,
cuya fuente de verdad es el env cifrado del repo. Si cambia una clave de CIDI se
cambia ahi, con el tooling de siempre, y esta app la toma de ahi. No hay una
segunda copia que mantener sincronizada.

`config.py` las busca en este orden:

1. variable de entorno ya definida, para pisar un valor puntual en una prueba
2. `kestra/platform/infra/kestra-runtime.env`, el descifrado que ya vive en el repo
3. `kestra-runtime.env.enc` mas `.local-secrets/runtime-env.key`, descifrando en
   memoria, sin dejar texto plano en disco

El tercero es el que permite correr en una maquina donde nadie descifro el
archivo antes. El descifrado lo hace `kestra/tools/manage_encrypted_env.py`, no
una copia del formato criptografico.

Claves que consume, con su nombre en el env de Kestra:

| en la app | en Kestra |
|---|---|
| `CIDI_BASE_URL` | `ENV_CIDI_BASE_URL` |
| `CIDI_CLIENT_ID` | `ENV_CIDI_CLIENT_ID` |
| `CIDI_CLIENT_SECRET` | `SECRET_CIDI_CLIENT_SECRET` |
| `CIDI_USER` | `SECRET_CIDI_USER` |
| `CIDI_PASS` | `SECRET_CIDI_PASS` |
| `CAJA_BASE_URL` | `ENV_CAJA_BASE_URL` |
| `CAJA_ENCRYPT_PASS` | `SECRET_CAJA_ENCRYPT_PASS` |
| `CAJA_ID_TIPO_USUARIO` | `ENV_CAJA_ID_TIPO_USUARIO` |

## Tiempos medidos

Contra el ambiente real:

| etapa | tiempo |
|---|---|
| login CIDI | ~0,8 a 1,1 s |
| seed token de Caja | ~1,0 a 1,2 s |
| canje de permisos | ~0,1 a 0,8 s |
| **apertura de sesion (una vez por corrida)** | **~1,9 a 2,8 s** |
| obtener-datos-persona | ~70 ms |
| obtener-haber-disponible | ~65 ms |
| **consulta de un CUIL** | **~135 ms** |

La consulta es barata; lo caro es el login. Por eso la sesion se abre una vez y
se reusa: repetirla en cada CUIL agregaria casi una hora sobre 1500 consultas,
y toda contra los endpoints de autenticacion.

Proyeccion para 1500 CUILs segun la pausa elegida:

| pausa | duracion |
|---|---|
| 1 s | ~28 min |
| 2 s | ~53 min |
| **3 s (elegida)** | **~79 min** |

Se eligio 3 segundos por prudencia frente al organismo, no por necesidad
tecnica. Verificado en una tanda de 5 consultas seguidas: una sola apertura de
sesion, latencias de 109 a 243 ms sin degradacion, resultados coincidentes con
lo que el flow productivo habia registrado para esas mismas personas.

Casos borde ya observados en datos reales, todos validos: `disponible` en 0,00 y
`disponible` negativo.

## Lo que dicen las ejecuciones historicas

Sobre las 360 ejecuciones del flow `tope_descuento_caja` en Kestra:

**Formato del CUIL: sin guiones.** 359 de 360 se enviaron como 11 digitos
planos, incluidas las 286 exitosas. Queda resuelto por evidencia.

**`tope_descuento` es un porcentaje, no un monto.** En 286 consultas exitosas
solo aparecen dos valores, 20.0 y 50.0, mientras `disponible` va de 0,41 a
831.686. Es el porcentaje maximo de descuento sobre el haber.

**Proporciones esperables**, utiles como umbral de alarma:

| estado | historico | esperado en 1500 |
|---|---|---|
| completed | 79 % | ~1.190 |
| not_found | 19 % | ~285 |
| technical_error | 2 % | ~25 |

Si la corrida se aleja mucho de esa proporcion, conviene frenar: es mas probable
que se haya roto algo a que el padron haya cambiado.

**Hay saldos negativos** (se vio -408.516,51). No filtrarlos por error.

## Estado de avance

- [x] Estructura del proyecto
- [x] Credenciales tomadas del env de Kestra, sin copia propia
- [x] Cliente de Caja: login, sesion reutilizable y consulta
- [x] Autenticacion validada de punta a punta contra el ambiente real
- [x] Parseo validado: mismo resultado que el flow productivo para el mismo CUIL
- [x] Formato del CUIL resuelto: sin guiones
- [x] Tanda de 5 CUILs con sesion reutilizada y pausa de 3 s
- [x] Runner completo: lectura, reanudacion, corte y Excel de salida
- [x] Reanudacion probada cortando y relanzando una corrida real
- [ ] Probar con la planilla real cuando llegue
- [ ] Ensayo con ~100
- [ ] Corrida de los 1500

## Pendiente de definir

Como presentar `tope_descuento` en la planilla final. Es un porcentaje, asi que
va como tal y no como moneda. Queda por decidir si conviene agregar ademas una
columna con el monto resultante.

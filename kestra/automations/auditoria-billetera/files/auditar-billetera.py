import os
import requests
from datetime import datetime
import urllib3

# Silenciamos la advertencia de SSL para imitar NODE_TLS_REJECT_UNAUTHORIZED = '0'
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Kestra inyectará estas variables de entorno
API_BASE_URL = os.environ.get("API_BASE_URL")
BITRIX_WEBHOOK_URL = os.environ.get("BITRIX_WEBHOOK_URL")
CHAT_ID_IT = os.environ.get("CHAT_ID_IT")

def obtener_ultima_ejecucion(id_tarea):
    url = f"{API_BASE_URL}/api/Empresa/EvaluateList"
    payload = {
        "cmd": f"[ID] = {id_tarea}",
        "tipo": "ClasesBase.TareaProgramada",
        "campos": "UltimaEjecucion;ToStr([UltimaEjecucion])",
        "max": 1
    }
    
    try:
        # verify=False ignora la validación SSL
        respuesta = requests.post(url, json=payload, verify=False)
        respuesta.raise_for_status()
        datos = respuesta.json()
        
        if datos and len(datos) > 0 and len(datos[0]) > 1:
            fecha_corta_str = datos[0][0] # Ej: "2026-06-22"
            fecha_exacta_texto = datos[0][1] # Ej: "22/6/2026 16:31:11"
            
            if "T" not in fecha_corta_str:
                fecha_corta_str += "T00:00:00"
                
            # Convertimos el string a un objeto de fecha de Python
            objeto_fecha = datetime.fromisoformat(fecha_corta_str)
            return objeto_fecha, fecha_exacta_texto
            
        return None, None
    except Exception as e:
        print(f"Error consultando la tarea {id_tarea}: {e}")
        raise e

def enviar_reporte_bitrix(mensaje, titulo):
    print("Enviando reporte a Bitrix24...")
    payload = {
        "CHAT_ID": CHAT_ID_IT,
        "MESSAGE": f"{titulo} - Billetera Virtual* \n\n{mensaje}"
    }
    try:
        respuesta = requests.post(BITRIX_WEBHOOK_URL, json=payload)
        respuesta.raise_for_status()
        print("✅ ¡Mensaje enviado a Bitrix24 con éxito!")
    except Exception as e:
        print(f"❌ Fallo al intentar conectar con Bitrix24: {e}")

def auditar_tareas():
    print("Iniciando auditoría de tareas programadas...")
    
    # Obtenemos la fecha de hoy a las 00:00:00
    hoy = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    
    tareas = [
        {"id": 49, "nombre": "Remuneración Billetera (ID: 49)"},
        {"id": 50, "nombre": "Sincronización Billetera (ID: 50)"}
    ]
    
    mensajes_reporte = []
    hay_errores = False
    
    for tarea in tareas:
        try:
            fecha_ejecucion, fecha_texto = obtener_ultima_ejecucion(tarea["id"])
            
            if not fecha_ejecucion:
                mensajes_reporte.append(f"⚠️ No se pudo obtener la fecha de {tarea['nombre']}.")
                hay_errores = True
                continue
                
            # Comparamos solo la fecha (ignorando horas)
            fecha_ejecucion_limpia = fecha_ejecucion.replace(hour=0, minute=0, second=0, microsecond=0)
            
            if fecha_ejecucion_limpia < hoy:
                mensajes_reporte.append(f"❌ *{tarea['nombre']}* NO se ejecutó hoy. Última vez: {fecha_texto}.")
                hay_errores = True
            else:
                mensaje_exito = f"✅ {tarea['nombre']} ejecutada correctamente al día de hoy."
                print(mensaje_exito)
                # Agregamos el éxito a la lista de mensajes que se enviarán a Bitrix24
                mensajes_reporte.append(mensaje_exito)
                
        except Exception as e:
            mensajes_reporte.append(f"⚠️ Fallo crítico al intentar auditar {tarea['nombre']}.")
            hay_errores = True

    # Si hay mensajes (ya sean de error o de éxito), disparamos el webhook
    if mensajes_reporte:
        mensaje_final = "\n".join(mensajes_reporte)
        titulo = "🚨 *ALERTA DE SISTEMA" if hay_errores else "✅ *REPORTE DE ÉXITO"
        enviar_reporte_bitrix(mensaje_final, titulo)
    else:
        print("Auditoría finalizada. No se recolectaron datos para enviar.")

if __name__ == "__main__":
    auditar_tareas()
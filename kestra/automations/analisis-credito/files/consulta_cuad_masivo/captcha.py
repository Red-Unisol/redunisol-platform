"""Lectura local del captcha de CUAD con ddddocr.

El captcha es un BMP de 86x21 con solo dos colores y 6 digitos que se pisan.
Se lee de 3 formas distintas y solo se acepta si las 3 coinciden: medido el
2026-10-06, asi entra ~58% de los logins. Cuando no coinciden no se gasta un
intento de login, se pide otro captcha (bajar uno no cuesta nada).
"""

import io

import ddddocr
from PIL import Image, ImageFilter

LARGO = 6


def _variantes(im):
    # Fondo (248,255,255) -> L~253; digitos (49,115,62) -> L~89.
    bn = im.convert("L").point(lambda p: 255 if p > 170 else 0)
    grande = bn.resize((bn.width * 3, bn.height * 3), Image.BICUBIC).filter(ImageFilter.SMOOTH)
    return [im, bn, grande]


def _a_png(im):
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


class LectorCaptcha:
    """Un lector por hilo: no se comparte la sesion de onnxruntime."""

    def __init__(self):
        self._ocr = ddddocr.DdddOcr(show_ad=False)

    def leer(self, contenido):
        """Devuelve los 6 digitos, o None si la lectura no es confiable."""
        im = Image.open(io.BytesIO(contenido)).convert("RGB")
        lecturas = {self._decodificar(v) for v in _variantes(im)}
        if len(lecturas) == 1:
            lectura = lecturas.pop()
            if len(lectura) == LARGO:
                return lectura
        return None

    def _decodificar(self, im):
        """Decode CTC restringido a digitos.

        set_ranges de ddddocr 1.6.1 no funciona (devuelve texto vacio), asi que
        se toman las probabilidades crudas y en cada paso se elige el mejor
        entre blanco y 0-9, colapsando repetidos.
        """
        r = self._ocr.classification(_a_png(im), probability=True)
        charset = r["charset"]
        permitidos = [i for i, c in enumerate(charset) if c == "" or (len(c) == 1 and c.isdigit())]
        texto, previo = [], None
        for paso in r["probabilities"]:
            paso = paso[0] if paso and isinstance(paso[0], list) else paso
            mejor = max(permitidos, key=lambda i: paso[i])
            if mejor != previo and charset[mejor]:
                texto.append(charset[mejor])
            previo = mejor
        return "".join(texto)

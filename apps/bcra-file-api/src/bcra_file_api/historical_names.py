"""Denominations verified in BCRA's semiannual non-bank entity register.

The page number is the PDF page, including the cover. Monthly masters take
precedence when they provide a more recent denomination for the same code.
"""

REPORT_PERIOD = '202412'
REPORT_URL = 'https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/EntidadesNo/enf022024.pdf'
# SHA-256 of the official PDF: 80660d3f3087ee2adc37efc571ea25cde85f145927dbe423bf015538d73a38a8
REPORT_ENTITIES = {
    '10081': (308, 'F DE ADM CARTERA JUDICIAL Y/O MOROSA DE CREDITOS'),
    '10452': (314, 'F.F. CÉDULAS HIPOTECARIAS ARGENTINAS SERIE IX 2009-1'),
    '10453': (315, 'F.F. CÉDULAS HIPOTECARIAS ARGENTINAS SERIE X 2009-2'),
    '10472': (316, 'F.F. CÉDULAS HIPOTECARIAS ARGENTINAS-SERIE XI-2009-3'),
    '10511': (313, 'F.F. CÉDULAS HIPOTECARIAS ARG SERIE XII 2010-1'),
    '10531': (330, 'FF CÉDULAS HIPOTECARIAS ARGENTINAS SERIE XIII 2010-2'),
    '10549': (331, 'FF CÉDULAS HIPOTECARIAS ARGENTINAS SERIE XIV 2011-1'),
    '10916': (332, 'FF CFA CRÉDITOS I'),
    '10917': (333, 'FF CFA CRÉDITOS II'),
    '10918': (334, 'FF CFA CRÉDITOS III'),
}

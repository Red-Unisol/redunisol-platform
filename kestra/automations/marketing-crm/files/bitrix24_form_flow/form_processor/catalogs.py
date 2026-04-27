from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata


@dataclass(frozen=True)
class CatalogItem:
    key: str
    label: str
    bitrix_id: str


class Catalog:
    def __init__(self, entries: list[tuple[str, str]]):
        self._items_by_key: dict[str, CatalogItem] = {}
        self._items_by_bitrix_id: dict[str, CatalogItem] = {}

        for label, bitrix_id in entries:
            key = slugify(label)
            item = CatalogItem(key=key, label=label, bitrix_id=str(bitrix_id))
            if key in self._items_by_key:
                raise ValueError(f'La clave "{key}" ya existe en el catalogo.')
            self._items_by_key[key] = item
            self._items_by_bitrix_id[item.bitrix_id] = item

    def resolve(self, raw_value: object, field_name: str) -> CatalogItem:
        if raw_value is None:
            raise ValueError(f'El campo "{field_name}" es obligatorio.')

        value = str(raw_value).strip()
        if not value:
            raise ValueError(f'El campo "{field_name}" es obligatorio.')

        semantic_key = slugify(value)
        if semantic_key in self._items_by_key:
            return self._items_by_key[semantic_key]

        if value in self._items_by_bitrix_id:
            return self._items_by_bitrix_id[value]

        raise ValueError(f'El campo "{field_name}" tiene un valor no soportado: "{raw_value}".')


def slugify(value: object) -> str:
    normalized = unicodedata.normalize("NFD", str(value))
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized)
    return normalized.strip("_").lower()


PROVINCIAS = Catalog(
    [
        ("Cordoba", "209"),
        ("Rio Negro", "211"),
        ("Neuquen", "213"),
        ("Catamarca", "215"),
        ("Chubut", "217"),
        ("Jujuy", "219"),
        ("Buenos Aires", "221"),
        ("Chaco", "255"),
        ("Corrientes", "257"),
        ("Entre Rios", "259"),
        ("Formosa", "261"),
        ("La Pampa", "263"),
        ("La Rioja", "265"),
        ("Mendoza", "267"),
        ("Misiones", "269"),
        ("Salta", "271"),
        ("San Juan", "273"),
        ("San Luis", "275"),
        ("Santa Cruz", "277"),
        ("Santa Fe", "279"),
        ("Santiago del Estero", "281"),
        ("Tierra del Fuego", "283"),
        ("Tucuman", "285"),
        ("No contesta", "431"),
    ]
)

SITUACIONES_LABORALES = Catalog(
    [
        ("Empleado Publico Provincial", "1239"),
        ("Empleado Publico Nacional", "1271"),
        ("Empleado Publico Municipal", "1273"),
        ("Empleado Privado", "1241"),
        ("Policia", "1269"),
        ("Jubilado Provincial", "2565"),
        ("Jubilado Nacional", "2567"),
        ("Jubilado Municipal", "3129"),
        ("Autonomo Independiente", "1277"),
        ("Monotributista", "3131"),
        ("Pensionado", "2569"),
        ("Beneficiario de Plan Social", "1279"),
        ("Docente", "3745"),
    ]
)

ORIGENES_LEAD = Catalog(
    [
        ("Google", "2423"),
        ("Facebook", "2425"),
        ("Instagram", "2427"),
        ("WhatsApp", "2451"),
        ("E Mail", "2647"),
        ("YouTube", "3921"),
    ]
)

BANCOS = Catalog(
    [
        ("Banco de la Provincia de Cordoba S.A.", "437"),
        ("Banco de la Nacion Argentina", "439"),
        ("Banco de la Pampa Sociedad de Economia", "441"),
        ("Banco Provincia del Neuquen Sociedad Anonima", "443"),
        ("Banco Patagonia S.A.", "445"),
        ("BBVA Banco Frances S.A.", "447"),
        ("Banco Santander Rio S.A.", "449"),
        ("Banco del Chubut S.A.", "451"),
        ("HSBC Bank Argentina S.A.", "453"),
        ("Banco Itau Argentina S.A.", "455"),
        ("Banco Macro S.A.", "457"),
        ("Banco de Galicia y Buenos Aires S.A.U.", "459"),
        ("Banco de la Provincia de Buenos Aires", "461"),
        ("Industrial and Commercial Bank of China", "463"),
        ("Citibank N.A.", "465"),
        ("Banco BBVA Argentina S.A.", "467"),
        ("Banco Supervielle S.A.", "469"),
        ("Banco de la Ciudad de Buenos Aires", "471"),
        ("Banco Hipotecario S.A.", "473"),
        ("Banco de San Juan S.A.", "475"),
        ("Banco Municipal de Rosario", "477"),
        ("Banco de Santa Cruz S.A.", "479"),
        ("Banco de Corrientes S.A.", "481"),
        ("Bank of China Limited Sucursal Buenos Aires", "483"),
        ("Brubank S.A.U.", "485"),
        ("Bibank S.A.", "487"),
        ("Open Bank Argentina S.A.", "489"),
        ("JPMorgan Chase Bank National Association", "491"),
        ("Banco Credicoop Cooperativo Limitado", "493"),
        ("Banco de Valores S.A.", "495"),
        ("Banco Roela S.A.", "497"),
        ("Banco Mariva S.A.", "499"),
        ("BNP Paribas", "501"),
        ("Banco Provincia de Tierra del Fuego", "503"),
        ("Banco de la Republica Oriental del Uruguay", "505"),
        ("Banco Saenz S.A.", "507"),
        ("Banco Meridian S.A.", "509"),
        ("Banco Comafi Sociedad Anonima", "511"),
        ("Banco de Inversion y Comercio Exterior S.A.", "513"),
        ("Banco Piano S.A.", "515"),
        ("Banco Julio Sociedad Anonima", "517"),
        ("Banco Rioja Sociedad Anonima Unipersonal", "519"),
        ("Banco del Sol S.A.", "521"),
        ("Nuevo Banco del Chaco S.A.", "523"),
        ("Banco Voii S.A.", "525"),
        ("Banco de Formosa S.A.", "527"),
        ("Banco CMF S.A.", "529"),
        ("Banco de Santiago del Estero S.A.", "531"),
        ("Banco Industrial S.A.", "533"),
        ("Nuevo Banco de Santa Fe Sociedad Anonima", "535"),
        ("Banco Cetelem Argentina S.A.", "537"),
        ("Banco de Servicios Financieros S.A.", "539"),
        ("Banco de Servicios y Transacciones S.A.", "541"),
        ("RCI Banque S.A.", "543"),
        ("BACS Banco de Credito y Securitizacion S.A.", "545"),
        ("Banco Masventas S.A.", "547"),
        ("Wilobank S.A.U.", "549"),
        ("Nuevo Banco de Entre Rios S.A.", "551"),
        ("Banco Columbia S.A.", "553"),
        ("Banco Bica S.A.", "555"),
        ("Banco de Comercio S.A.", "557"),
        ("Banco Sucredito Regional S.A.U.", "559"),
        ("Banco Dino S.A.", "561"),
        ("Compania Financiera Argentina S.A.", "563"),
        ("Volkswagen Financial Services Compania Financiera S.A.", "565"),
        ("Iudu Compania Financiera S.A.", "567"),
        ("FCA Compania Financiera S.A.", "569"),
        ("GPAT Compania Financiera S.A.U.", "571"),
        ("Mercedes Benz Compania Financiera Argentina S.A.", "573"),
        ("Rombo Compania Financiera S.A.", "575"),
        ("John Deere Credit Compania Financiera S.A.", "577"),
        ("PSA Finance Argentina Compania Financiera S.A.", "579"),
        ("Toyota Compania Financiera de Argentina S.A.", "581"),
        ("Naranja Digital Compania Financiera S.A.", "583"),
        ("Montemar Compania Financiera S.A.", "585"),
        ("Reba Compania Financiera S.A.", "587"),
        ("Credito Regional Compania Financiera S.A.", "589"),
        ("Banco Coinag S.A.", "591"),
    ]
)

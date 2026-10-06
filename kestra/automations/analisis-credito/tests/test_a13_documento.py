from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "files"))
from arca_padron_a13 import documento as d


class DocumentoTests(unittest.TestCase):
    def setUp(self):
        self.config = d.service.ArcaConfig("20123456786", b"", b"", 10, None)
        self.ta = {"token": "test", "sign": "test", "expirationTime": "2099-01-01T00:00:00Z"}

    def person(self, key="20123456786", kind="CUIL", state="ACTIVO", name="Nombre distinto"):
        return {"persona": {"idPersona": key, "tipoClave": kind, "estadoClave": state,
                            "numeroDocumento": "12345678", "nombre": name}}

    def resolve(self, persons, ids=None):
        with patch.object(d.service, "get_ta", return_value=(self.ta, "cache", False, "")), \
             patch.object(d, "call_ids_by_documento", return_value=ids if ids is not None else [p["persona"]["idPersona"] for p in persons]), \
             patch.object(d.service, "call_get_persona", side_effect=persons):
            return d.resolve_documento("12345678", self.config)

    def test_cdi_and_cuit_with_different_names_selects_only_cuit(self):
        r = self.resolve([self.person(kind="CDI", name="Uno"), self.person("27123456780", "CUIT", name="Otro")])
        self.assertEqual((r["ok"], r["status"], r["cuil"]), (True, "single", "27123456780"))

    def test_single_cuil(self):
        self.assertEqual(self.resolve([self.person()])["cuil"], "20123456786")

    def test_multiple_active_keys_never_selects_first(self):
        r = self.resolve([self.person(), self.person("27123456780", "CUIT")])
        self.assertEqual((r["status"], r["cuil"]), ("multiple", ""))

    def test_empty_cdi_and_inactive_have_no_candidate(self):
        for persons in ([], [self.person(kind="CDI")], [self.person(state="INACTIVO")]):
            with self.subTest(persons=persons):
                self.assertEqual(self.resolve(persons)["status"], "none")

    def test_inactive_excluded_from_multiple(self):
        r = self.resolve([self.person(state="INACTIVO"), self.person("27123456780")])
        self.assertEqual(r["cuil"], "27123456780")

    def test_partial_failure_cannot_become_unique_match(self):
        r = self.resolve([self.person(), TimeoutError()], ids=["20123456786", "27123456780"])
        self.assertFalse(r["ok"])
        self.assertEqual(r["cuil"], "")

    def test_inconsistent_document_or_id_is_failure(self):
        for field in ("numeroDocumento", "idPersona"):
            person = self.person(); person["persona"][field] = "99999999"
            self.assertFalse(self.resolve([person], ids=["20123456786"])["ok"])

    def test_invalid_dni_does_not_call_provider(self):
        with patch.object(d.service, "get_ta") as get:
            self.assertEqual(d.resolve_documento("x12345678", self.config)["status"], "invalid_request")
        get.assert_not_called()

    def test_official_soap_request_and_deduplicated_response(self):
        raw = '<Envelope><idPersonaListReturn><idPersona>20123456786</idPersona><idPersona>20123456786</idPersona></idPersonaListReturn></Envelope>'
        with patch.object(d.service, "http_post_xml", return_value=raw) as post:
            self.assertEqual(d.call_ids_by_documento("12345678", self.config, self.ta), ["20123456786"])
        self.assertIn('<a13:getIdPersonaListByDocumento>', post.call_args.args[1])
        self.assertIn('<documento>12345678</documento>', post.call_args.args[1])

    def test_fault_is_not_an_empty_result(self):
        with patch.object(d.service, "http_post_xml", return_value='<Envelope><Fault/></Envelope>'):
            with self.assertRaises(d.service.TechnicalError):
                d.call_ids_by_documento("12345678", self.config, self.ta)

    def test_refreshed_ticket_is_available_for_cache_even_on_lookup_failure(self):
        with patch.object(d.service, "get_ta", return_value=(self.ta, "wsaa", True, "PT5M")), \
             patch.object(d, "call_ids_by_documento", side_effect=TimeoutError()):
            r = d.resolve_documento("12345678", self.config)
        self.assertTrue(r["ta_cache_should_persist"])
        self.assertFalse(r["ok"])

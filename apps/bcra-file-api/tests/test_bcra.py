from __future__ import annotations

from dataclasses import replace
from contextlib import contextmanager
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

from bcra_file_api.config import Config
from bcra_file_api.formats import BASE_WIDTHS, FormatError, base_record, rect_record
from bcra_file_api.refresh import RefreshManager
from bcra_file_api.source import Asset, SourceClient, SourceError, content_version, parse_catalog
from bcra_file_api.store import import_snapshot, lookup, timestamp

CUIL = "20123456786"
OTHER = "27123456780"
PERIOD = "202608"


def base(identification=CUIL, entity="00007", situation=1, amount="100,0", period=PERIOD,
         refinancing=1, legal=0, technical=0, recategorization=0):
    fields = [entity, period, "11", identification, "000", str(situation)]
    fields += [amount, "0,0", "20,0", "3,5"] + ["0,0"] * 7
    fields += ["0", "0", str(refinancing), str(recategorization), str(legal), str(technical), "12"]
    return "".join(value.rjust(width) for value, width in zip(fields, BASE_WIDTHS)) + "\r\n"


def rect(identification=CUIL, situation=4, amount="77,5", period=PERIOD, entity="00007"):
    fields = [entity, period, "11", identification, "NOMBRE SINTETICO", str(situation), amount]
    widths = [5, 6, 2, 11, 55, 2, 12]
    return "".join(value.ljust(width) if index == 4 else value.rjust(width)
                   for index, (value, width) in enumerate(zip(fields, widths))) + "\r\n"


class FakeArchive:
    def __init__(self, members):
        self.members = members

    @contextmanager
    def lines(self, basename):
        if basename not in self.members:
            raise SourceError("Missing fixture member")
        yield enumerate(self.members[basename].splitlines(keepends=True), 1)


def archives(rows=None, full="", partial=""):
    return {
        "DEUDORES": FakeArchive({
            "deudores.txt": rows if rows is not None else base() + base(OTHER, situation=5),
            "maeent.txt": "00007" + "BANCO SINTETICO".ljust(70) + "\r\n",
        }),
        "INFRET": FakeArchive({"inf_ret.txt": full}),
        "INFRETPA": FakeArchive({"inf_retparc.txt": partial}),
    }


def manifest(version="first"):
    return {"period": PERIOD, "version": version, "checked_at": timestamp(), "files": []}


def catalog_html(period=PERIOD, password="hidden-test-password"):
    links = []
    for index, kind in enumerate(("DEUDORES", "INFRET", "INFRETPA")):
        name = period + kind + ".7Z"
        links.append(
            '<a onclick="Confirmacion(\'https://mft.bcra.gob.ar/apilink.aspx?arg01=\''
            "+'" + str(index) + "'+'&amp;arg05=0/'+'" + name + "','" + name + "')\">file</a>"
        )
    return '<form id="form-id"><input name="password" value="' + password + '">' + "".join(links) + "</form>"


class FormatTests(unittest.TestCase):
    def test_fixed_record_includes_normal_situations_and_all_financing_components(self):
        record = base_record(base())
        self.assertEqual(record[:6], (CUIL, "00007", PERIOD, 1, 1235, 12))

    def test_semicolon_uses_explicit_amounts_and_fixed_width_implicit_decimal(self):
        fields = [base().rstrip("\r\n")[sum(BASE_WIDTHS[:i]):sum(BASE_WIDTHS[:i + 1])].strip()
                  for i in range(len(BASE_WIDTHS))]
        self.assertEqual(base_record(";".join(fields))[4], 1235)
        fields[6] = "100"
        self.assertEqual(base_record(";".join(fields))[4], 1235)
        fixed = base(amount="1000")
        self.assertEqual(base_record(fixed)[4], 1235)

    def test_invalid_layout_or_amount_is_not_silently_skipped(self):
        for line in ("bad", base(amount="NaN"), base(amount="-1,0"), base(period="202613")):
            with self.subTest(line_length=len(line)), self.assertRaises(FormatError):
                base_record(line)

    def test_semicolon_inside_fixed_width_rectification_name_is_not_a_separator(self):
        record = rect_record(rect().replace("NOMBRE SINTETICO", "NOMBRE;SINTETICO"))
        self.assertEqual(record[5], "NOMBRE;SINTETICO")
        self.assertEqual(record[4], 775)

    def test_non_fiscal_identifications_are_excluded(self):
        value = base()
        value = value[:11] + "96" + value[13:]
        self.assertIsNone(base_record(value))


class CatalogTests(unittest.TestCase):
    def test_catalog_requests_fresh_session_instead_of_cached_html(self):
        client = SourceClient(Config(Path("unused"), "x" * 32))
        response = io.BytesIO(catalog_html().encode())
        with patch.object(client.opener, "open", return_value=response) as request:
            assets = client.catalog()
        self.assertEqual(len(assets), 3)
        self.assertEqual(request.call_args.args[0].get_header("Cache-control"), "no-cache")
        self.assertEqual(request.call_args.args[0].get_header("Pragma"), "no-cache")

    def test_current_official_concatenated_links_and_hidden_form_are_parsed(self):
        assets = parse_catalog(catalog_html("202607") + catalog_html())
        self.assertEqual([asset.kind for asset in assets], ["DEUDORES", "INFRET", "INFRETPA"])
        self.assertTrue(all(asset.period == PERIOD for asset in assets))
        self.assertEqual(assets[0].form["password"], "hidden-test-password")
        self.assertNotIn("hidden-test-password", repr(assets[0]))
        self.assertNotIn("arg01", repr(assets[0]))

    def test_missing_corrections_login_or_unexpected_host_fail_closed(self):
        cases = [
            "<html>Login</html>",
            catalog_html().replace("202608INFRETPA", "unrecognized"),
            catalog_html().replace("mft.bcra.gob.ar", "example.invalid"),
        ]
        for html in cases:
            with self.subTest(html_length=len(html)), self.assertRaises(SourceError):
                parse_catalog(html)


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = Config(self.root, "x" * 32, terms_accepted=True, min_rows=1)
        self.asset = Asset("202608DEUDORES.7Z", "DEUDORES", PERIOD,
                           "https://mft.bcra.gob.ar/apilink.aspx", {"password": "private-fixture"})
        self.target = self.root / self.asset.name
        self.catalog_mock = self.enterContext(patch.object(SourceClient, "catalog", return_value=[self.asset]))

    def tearDown(self):
        self.temporary.cleanup()

    def response(self, body, length=None):
        response = io.BytesIO(body)
        response.headers = {"Content-Length": str(len(body) if length is None else length)}
        return response

    def test_download_uses_post_and_checks_archive_signature_and_hash(self):
        client = SourceClient(self.config)
        client.acknowledge_terms = lambda asset: None
        payload = b"7z\xbc\xaf\x27\x1cfixture"
        with patch.object(client.opener, "open", return_value=self.response(payload)) as call:
            result = client.download(self.asset, self.target)
        self.assertEqual(call.call_args.args[0].get_method(), "POST")
        self.assertIn(b"password=private-fixture", call.call_args.args[0].data)
        self.assertEqual(self.target.read_bytes(), payload)
        self.assertEqual(result["bytes"], len(payload))
        self.assertNotIn("private", json.dumps(result))
        self.catalog_mock.assert_called_once_with()

    def test_download_renews_stale_form_and_link_before_requesting_exact_file(self):
        client = SourceClient(self.config)
        fresh = replace(self.asset, url="https://mft.bcra.gob.ar/renewed-link",
                        form={"sessionid": "fresh-private-session"})
        self.catalog_mock.return_value = [fresh]
        payload = b"7z\xbc\xaf\x27\x1cfixture"
        with patch.object(client, "acknowledge_terms", return_value="accepted") as terms, \
                patch.object(client.opener, "open", return_value=self.response(payload)) as request:
            result = client.download(self.asset, self.target)
        terms.assert_called_once_with(fresh)
        self.assertEqual(request.call_args.args[0].full_url, fresh.url)
        self.assertEqual(request.call_args.args[0].data, b"sessionid=fresh-private-session")
        self.assertNotIn("fresh-private-session", json.dumps(result))
        self.assertNotIn("renewed-link", json.dumps(result))

    def test_html_response_retries_with_new_catalog_form_and_terms(self):
        client = SourceClient(self.config)
        first = replace(self.asset, form={"sessionid": "first-private-session"})
        second = replace(self.asset, form={"sessionid": "second-private-session"})
        self.catalog_mock.side_effect = [[first], [second]]
        payload = b"7z\xbc\xaf\x27\x1cfixture"
        with patch.object(client, "acknowledge_terms", return_value="accepted") as terms, \
                patch.object(client.opener, "open", side_effect=[
                    self.response(b"<html>Session expired; secret-url</html>"), self.response(payload),
                ]) as request, patch("bcra_file_api.source.time.sleep"):
            result = client.download(self.asset, self.target)
        self.assertEqual([call.args[0] for call in terms.call_args_list], [first, second])
        self.assertEqual([call.args[0].data for call in request.call_args_list],
                         [b"sessionid=first-private-session", b"sessionid=second-private-session"])
        self.assertEqual(self.target.read_bytes(), payload)
        self.assertEqual(result["bytes"], len(payload))
        self.assertNotIn("private-session", json.dumps(result))

    def test_repeated_html_is_bounded_and_does_not_expose_response_or_session(self):
        client = SourceClient(self.config)
        with patch.object(client, "acknowledge_terms", return_value="accepted"), \
                patch.object(client.opener, "open", side_effect=[
                    self.response(b"<html>secret-session-and-url</html>") for _ in range(3)
                ]) as request, patch("bcra_file_api.source.time.sleep"), \
                self.assertRaisesRegex(SourceError, "after renewing the catalog session") as error:
            client.download(self.asset, self.target)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(self.catalog_mock.call_count, 3)
        self.assertNotIn("secret", str(error.exception))
        self.assertNotIn("private-fixture", str(error.exception))
        self.assertFalse(self.target.exists())

    def test_http_authentication_failure_renews_session_before_retry(self):
        payload = b"7z\xbc\xaf\x27\x1cfixture"
        for code in [401, 403]:
            with self.subTest(code=code):
                client = SourceClient(self.config)
                self.catalog_mock.reset_mock()
                with patch.object(client, "acknowledge_terms", return_value="accepted"), \
                        patch.object(client.opener, "open", side_effect=[
                            HTTPError("https://private-session.invalid", code, "secret", {}, io.BytesIO()),
                            self.response(payload),
                        ]), patch("bcra_file_api.source.time.sleep"):
                    client.download(self.asset, self.target)
                self.assertEqual(self.catalog_mock.call_count, 2)
                self.assertEqual(self.target.read_bytes(), payload)

    def test_catalog_rollover_never_substitutes_another_month_or_padron(self):
        client = SourceClient(self.config)
        padron = Asset("20261030PADRON.7Z", "PADRON", "20261030", "unused")
        variants = [(self.asset, replace(self.asset, name="202609DEUDORES.7Z", period="202609")),
                    (self.asset, replace(self.asset, period="202609")),
                    (self.asset, padron),
                    (padron, replace(padron, name="20261104PADRON.7Z", period="20261104"))]
        for requested, fresh in variants:
            with self.subTest(kind=fresh.kind, period=fresh.period):
                self.catalog_mock.return_value = [fresh]
                with patch.object(client.opener, "open") as request, \
                        self.assertRaisesRegex(SourceError, "no longer in the current catalog"):
                    client.download(requested, self.target)
                request.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_repeated_http_denial_stops_after_three_attempts_without_leaking_url(self):
        client = SourceClient(self.config)
        with patch.object(client, "acknowledge_terms", return_value="accepted"), \
                patch.object(client.opener, "open", side_effect=[
                    HTTPError("https://secret-session.invalid", 403, "secret", {}, io.BytesIO())
                    for _ in range(3)
                ]) as request, patch("bcra_file_api.source.time.sleep"), \
                self.assertRaisesRegex(SourceError, "MFT denied") as error:
            client.download(self.asset, self.target)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(self.catalog_mock.call_count, 3)
        self.assertNotIn("secret", str(error.exception))
        self.assertFalse(self.target.exists())

    def test_expired_nightly_budget_prevents_download_and_retry(self):
        client = SourceClient(self.config, deadline=0)
        with patch.object(client, "acknowledge_terms", return_value="accepted"), \
                patch.object(client.opener, "open") as request, \
                patch("bcra_file_api.source.time.sleep") as sleep, \
                self.assertRaisesRegex(SourceError, "nightly window"):
            client.download(self.asset, self.target)
        request.assert_not_called()
        sleep.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_explicit_terms_denial_is_not_retried(self):
        client = SourceClient(self.config)
        with patch.object(client.opener, "open", return_value=self.response(b'{"result":false}')) as request, \
                self.assertRaisesRegex(SourceError, "did not acknowledge"):
            client.download(self.asset, self.target)
        self.assertEqual(request.call_count, 1)
        self.catalog_mock.assert_called_once_with()
        self.assertFalse(self.target.exists())

    def test_html_200_truncation_and_oversize_are_rejected(self):
        for body, length, limit in [
            (b"<html>Login</html>", None, 1000),
            (b"7z\xbc\xaf\x27\x1cfixture", 200, 1000),
            (b"7z\xbc\xaf\x27\x1cfixture", None, 7),
        ]:
            client = SourceClient(replace(self.config, max_download_bytes=limit))
            client.acknowledge_terms = lambda asset: None
            responses = [self.response(body, length) for _ in range(3)]
            with patch.object(client.opener, "open", side_effect=responses), \
                    patch("bcra_file_api.source.time.sleep"):
                with self.assertRaises(SourceError):
                    client.download(self.asset, self.target)
            self.assertFalse(self.target.exists())

    def test_operator_acceptance_follows_official_logging_step(self):
        client = SourceClient(self.config)
        with patch.object(client.opener, "open", return_value=self.response(b'{"result":true}')) as call:
            client.acknowledge_terms(self.asset)
        request = call.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/Deudores/Log_Archivo"))
        self.assertIn(b"Name=202608DEUDORES.7Z", request.data)
        with patch.object(client.opener, "open", return_value=self.response(b'{"result":false}')):
            with self.assertRaises(SourceError):
                client.acknowledge_terms(self.asset)

    def test_null_logging_response_is_recorded_but_download_still_requires_real_7z(self):
        client = SourceClient(self.config)
        with patch.object(client.opener, "open", return_value=self.response(b'{"result":null}')):
            self.assertEqual(client.acknowledge_terms(self.asset), "null_response")
        with patch.object(client.opener, "open", side_effect=[
            self.response(b'{"result":null}'), self.response(b"<html>Login</html>")
        ] * 3), patch("bcra_file_api.source.time.sleep"):
            with self.assertRaises(SourceError):
                client.download(self.asset, self.target)
        self.assertFalse(self.target.exists())

    def test_no_download_without_operator_acceptance(self):
        client = SourceClient(replace(self.config, terms_accepted=False))
        with patch.object(client.opener, "open") as call, self.assertRaises(SourceError):
            client.download(self.asset, self.target)
        call.assert_not_called()
        self.catalog_mock.assert_not_called()


class StoreTests(unittest.TestCase):
    def test_official_not_applicable_flags_are_not_reported_as_true(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "snapshot.sqlite"
            import_snapshot(path, archives(rows=base(refinancing=9, legal=9, technical=9)), manifest(), 1)
            entity = lookup(path, CUIL)["results"]["periodos"][0]["entidades"][0]
            for key in ("refinanciaciones", "situacionJuridica", "irrecDisposicionTecnica"):
                self.assertIsNone(entity[key])
            self.assertFalse(entity["recategorizacionOblig"])

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "snapshot.sqlite"

    def tearDown(self):
        self.temporary.cleanup()

    def test_lookup_and_absent_identifier_keep_dataset_version(self):
        import_snapshot(self.path, archives(), manifest(), 1)
        response = lookup(self.path, CUIL)
        self.assertEqual(response["status"], 200)
        entity = response["results"]["periodos"][0]["entidades"][0]
        self.assertEqual(entity["monto"], 123.5)
        self.assertEqual(entity["situacion"], 1)
        self.assertEqual(entity["entidad"], "BANCO SINTETICO")
        self.assertIsNone(response["results"]["denominacion"])
        missing = lookup(self.path, "20999999999")
        self.assertEqual(missing["status"], 404)
        self.assertEqual(missing["meta"]["version"], "first")

    def test_full_then_partial_rectifications_and_deletions(self):
        values = archives(
            full=rect(situation=3, amount="88,0"),
            partial=rect(situation=4) + rect(OTHER, situation=0, amount="0,0"),
        )
        result = import_snapshot(self.path, values, manifest(), 1)
        self.assertEqual(result["deletions"], 1)
        response = lookup(self.path, CUIL)
        entity = response["results"]["periodos"][0]["entidades"][0]
        self.assertEqual((entity["situacion"], entity["monto"]), (4, 77.5))
        self.assertIsNone(entity["diasAtrasoPago"])
        self.assertIsNone(entity["refinanciaciones"])
        self.assertEqual(response["results"]["denominacion"], "NOMBRE SINTETICO")
        self.assertEqual(lookup(self.path, OTHER)["status"], 404)

    def test_file_months_keep_their_period_and_only_loaded_months_are_rectified(self):
        values = archives(rows=base() + base(period="202607"),
                          full=rect(period="202607") + rect(period="202606"))
        result = import_snapshot(self.path, values, manifest(), 1)
        periods = lookup(self.path, CUIL)["results"]["periodos"]
        self.assertEqual(result["data_periods"], ["202608", "202607"])
        self.assertEqual([p["periodo"] for p in periods], ["202608", "202607"])
        self.assertEqual([p["entidades"][0]["monto"] for p in periods], [123.5, 77.5])
        self.path.unlink()
        with self.assertRaises(SourceError):
            import_snapshot(self.path, archives(rows=base(period="202609")), manifest(), 1)

    def test_unrecognized_source_flag_is_retained_without_boolean_interpretation(self):
        result = import_snapshot(self.path, archives(rows=base(recategorization=3)), manifest(), 1)
        entity = lookup(self.path, CUIL)["results"]["periodos"][0]["entidades"][0]
        self.assertIsNone(entity["recategorizacionOblig"])
        self.assertEqual(entity["codigosBanderasFuente"]["recategorizacionOblig"], 3)
        self.assertEqual(result["unrecognized_flag_rows"], 1)
        self.assertTrue(result["warnings"])

    def test_old_period_corrections_do_not_change_current_month(self):
        import_snapshot(self.path, archives(full=rect(period="202607")), manifest(), 1)
        entity = lookup(self.path, CUIL)["results"]["periodos"][0]["entidades"][0]
        self.assertEqual(entity["situacion"], 1)
        self.assertEqual(entity["diasAtrasoPago"], 12)

    def test_duplicate_incomplete_or_unknown_entity_cannot_be_published(self):
        for values in [
            archives(rows=base() + base()),
            archives(rows=""),
            archives(rows=base(entity="00008")),
        ]:
            self.path.unlink(missing_ok=True)
            with self.assertRaises(SourceError):
                import_snapshot(self.path, values, manifest(), 1)


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.manager = RefreshManager(Config(self.root, "x" * 32, terms_accepted=True, min_rows=1))
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        self.assets = [Asset(PERIOD + kind + ".7Z", kind, PERIOD, "unused")
                       for kind in ("DEUDORES", "INFRET", "INFRETPA")]

    def tearDown(self):
        self.temporary.cleanup()

    def download(self, asset, path):
        path.write_bytes(b"fixture")
        return {"name": asset.name, "kind": asset.kind, "sha256": asset.kind, "bytes": 7}

    def fake_archive(self, path, executable, **kwargs):
        return archives()[next(kind for kind in ("DEUDORES", "INFRET", "INFRETPA")
                               if path.name == PERIOD + kind + ".7Z")]

    def run_refresh(self, importer=None):
        with patch("bcra_file_api.refresh.SourceClient") as source, \
             patch("bcra_file_api.refresh.Archive", side_effect=self.fake_archive):
            source.return_value.catalog.return_value = self.assets
            source.return_value.download.side_effect = self.download
            if importer:
                with patch("bcra_file_api.refresh.import_snapshot", side_effect=importer):
                    return self.manager._refresh()
            return self.manager._refresh()

    def test_failed_import_preserves_previous_database(self):
        original = self.manager.database.read_bytes()
        with self.assertRaises(SourceError):
            self.run_refresh(importer=SourceError("bad fixture"))
        self.assertEqual(self.manager.database.read_bytes(), original)
        self.assertEqual(lookup(self.manager.database, CUIL)["meta"]["version"], "first")

    def test_successful_swap_and_unchanged_content_skip_reimport(self):
        result = self.run_refresh()
        self.assertEqual(result["action"], "updated")
        self.assertNotEqual(lookup(self.manager.database, CUIL)["meta"]["version"], "first")
        self.assertEqual(len(list((self.root / "archives").rglob("*.7Z"))), 3)
        second = self.run_refresh(importer=AssertionError("unchanged data must not be imported"))
        self.assertEqual(second["action"], "unchanged")

    def test_catalog_regression_preserves_active_publication(self):
        self.assets = [replace(asset, period="202607") for asset in self.assets]
        with self.assertRaisesRegex(SourceError, "regressed"):
            self.run_refresh()

    def test_version_includes_corrections_content(self):
        first = [{"kind": "DEUDORES", "sha256": "a"}, {"kind": "INFRET", "sha256": "b"}]
        self.assertNotEqual(content_version(first), content_version([first[0], {"kind": "INFRET", "sha256": "c"}]))

    def test_restart_records_interrupted_refresh_without_losing_dataset(self):
        self.manager.state = {"status": "running", "job_id": "old"}
        self.manager._persist()
        restarted = RefreshManager(self.manager.config)
        self.assertEqual(restarted.job("old")["status"], "failed")
        self.assertTrue(restarted.status()["ready"])


if __name__ == "__main__":
    unittest.main()

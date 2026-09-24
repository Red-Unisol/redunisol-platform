"""Local routing contract checks; these do not claim to emulate Bitrix delivery."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DOMAIN = Path(__file__).resolve().parents[1]
SOURCES = DOMAIN / "bitrix/rejection-notifications"
BUILDER = DOMAIN.parents[1] / "tools/build_bitrix_rejection_notifications.php"
MESSAGES = {"CrmSendEmailActivity", "ImOpenLinesMessageActivity", "CrmSendWhatsAppMessageActivity"}


def walk(node):
    yield node
    for child in node.get("Children", []):
        yield from walk(child)


def matches(conditions, document):
    for condition in conditions:
        value = document.get(condition["field"], "")
        expected = condition["value"]
        operator = condition["operator"]
        if operator == "=" and str(value) != str(expected):
            return False
        if operator == ">" and int(value) <= int(expected):
            return False
        if operator not in {"=", ">"}:
            raise AssertionError(operator)
    return True


def dispatch(node, document, emitted):
    if node.get("Activated", "Y") == "N":
        return
    kind, properties = node["Type"], node.get("Properties", {})
    if kind == "IfElseActivity":
        for branch in node["Children"]:
            bp = branch["Properties"]
            if bp.get("truecondition") or matches(bp.get("mixedcondition", []), document):
                dispatch(branch, document, emitted)
                break
    elif kind == "SetFieldActivity":
        document.update(properties["FieldValue"])
    elif kind in MESSAGES:
        # Reserve must precede any attempted external communication.
        assert document["UF_CRM_REJ_NOTICE"] == "IN_PROGRESS"
        emitted.append((kind, properties))
    else:
        for child in node.get("Children", []):
            dispatch(child, document, emitted)


@unittest.skipUnless(shutil.which("php"), "PHP is required for the BPT builder")
class RejectionNotificationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        output = Path(cls.temp.name) / "notifications.bpt"
        subprocess.run(["php", str(BUILDER), str(SOURCES), str(output), "400000"], check=True, capture_output=True)
        cls.export = json.loads(Path(str(output) + ".json").read_text(encoding="utf-8"))
        cls.root = cls.export["TEMPLATE"][0]
        cls.manifest = json.loads((SOURCES / "manifest.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def document(self, reason):
        return {"ID": "400001", "STATUS_ID": "UC_1P8I07", "UF_CRM_REJECTION_REASON": reason}

    def test_every_reason_preserves_original_messages_and_settings(self):
        for item in self.manifest["sources"]:
            with self.subTest(reason=item["reason_label"]):
                source = json.loads((SOURCES / "sources" / f'{item["template_id"]}.json').read_text(encoding="utf-8"))
                document = self.document(item["reason_xml_id"])
                document["UF_CRM_1714071903"] = "0b8c70305bf0f7b2a0823319ad31a3ea"
                expected = [(n["Type"], n["Properties"]) for n in walk(source["template"])
                            if n["Type"] in MESSAGES and n.get("Activated", "Y") != "N"
                            and n["Name"] != "A51141_68911_32034_46491"]
                emitted = []
                dispatch(self.root, document, emitted)
                if item["template_id"] == 407:
                    self.assertEqual(emitted[:1], expected)
                    self.assertEqual(emitted[1][0], "ImOpenLinesMessageActivity")
                    self.assertIn("no contamos con propuestas vigentes", emitted[1][1]["MessageText"])
                    self.assertEqual(len(emitted), 2)
                else:
                    self.assertEqual(emitted, expected)
                self.assertEqual(document["UF_CRM_REJ_NOTICE"], "PROCESSED")
                repeated = []
                dispatch(self.root, document, repeated)
                self.assertEqual(repeated, [])

    def test_historical_cutoff_and_nonempty_states_never_send(self):
        reason = self.manifest["sources"][0]["reason_xml_id"]
        cases = [{"ID": "399999"}, {"ID": "400000"}, {"STATUS_ID": "NEW"}]
        cases += [{"UF_CRM_REJ_NOTICE": value} for value in ["HISTORICAL", "IN_PROGRESS", "PROCESSED", "UNKNOWN"]]
        for case in cases:
            with self.subTest(case=case):
                document = self.document(reason) | case
                before = copy.deepcopy(document)
                emitted = []
                dispatch(self.root, document, emitted)
                self.assertEqual(emitted, [])
                self.assertEqual(document, before)

    def test_unknown_and_empty_reason_do_not_send_or_mark_processed(self):
        for reason in ["", "unmapped", "POLICIA_FEDERAL_CABA_INICIAL"]:
            document = self.document(reason)
            emitted = []
            dispatch(self.root, document, emitted)
            self.assertEqual(emitted, [])
            self.assertNotIn("UF_CRM_REJ_NOTICE", document)

    def test_autonomo_chat_uses_reason_instead_of_deleted_employment_option(self):
        item = next(i for i in self.manifest["sources"] if i["reason_label"] == "AUTONOMO")
        document = self.document(item["reason_xml_id"])
        emitted = []
        dispatch(self.root, document, emitted)
        self.assertEqual([kind for kind, _ in emitted], ["ImOpenLinesMessageActivity", "CrmSendEmailActivity"])
        old_option = "0b8c70305bf0f7b2a0823319ad31a3ea"
        self.assertNotIn(old_option, self.export["DOCUMENT_FIELDS"]["UF_CRM_1714071903"]["Options"])
        self.assertNotIn(old_option, json.dumps(self.root))

    def test_unique_names_and_only_notice_state_mutations(self):
        nodes = list(walk(self.root))
        names = [n["Name"] for n in nodes]
        self.assertEqual(len(names), len(set(names)))
        for node in nodes:
            self.assertNotIn(node["Type"], {"CrmChangeStatusActivity", "CrmCreateEntityActivity", "HttpRequestActivity"})
            if node["Type"] == "SetFieldActivity":
                self.assertEqual(list(node["Properties"]["FieldValue"]), ["UF_CRM_REJ_NOTICE"])

    def test_source_schema_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            source_dir = Path(temp) / "sources"
            shutil.copytree(SOURCES, source_dir)
            manifest = copy.deepcopy(self.manifest)
            manifest["sources"][0]["reason_xml_id"] = "bad-id"
            (source_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            output = Path(temp) / "bad.bpt"
            result = subprocess.run(["php", str(BUILDER), str(source_dir), str(output), "400000"], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

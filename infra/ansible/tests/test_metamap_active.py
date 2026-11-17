import importlib.util
from pathlib import Path
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/"roles/metamap_server/files/metamap-active.py"
spec=importlib.util.spec_from_file_location("metamap_active",SCRIPT)
active=importlib.util.module_from_spec(spec)
spec.loader.exec_module(active)

class ActiveOriginTests(unittest.TestCase):
    def fixture(self):
        return '''TLS and shadow receiver preserved
    Header always set X-Redunisol-Origin-Config "'''+'a'*64+'''"
    # A non-3xx status emits 503 without a Location header or redirect.
    RedirectMatch 503 "^/metamap-platform(?:/|$)"
    ErrorDocument 503 "disabled"
    <LocationMatch "^/metamap-platform(?:/|$)">
        Header always set Cache-Control "no-store"
    </LocationMatch>
end
'''
    def test_only_prepared_backend_block_changes(self):
        result=active.active_apache(self.fixture())
        self.assertIn('TLS and shadow receiver preserved',result)
        self.assertIn('127.0.0.1:18083/',result)
        self.assertNotIn('RedirectMatch 503',result)
        self.assertIn('nocanon',result)
        self.assertEqual(result,active.active_apache(result))
    def test_unknown_configuration_refused(self):
        with self.assertRaises(ValueError):
            active.active_apache('unrelated Apache application')
    def test_duplicate_backend_refused(self):
        with self.assertRaises(ValueError):
            active.active_apache(self.fixture()+self.fixture())

if __name__=="__main__":
    unittest.main()

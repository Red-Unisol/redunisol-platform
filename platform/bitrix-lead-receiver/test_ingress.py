from pathlib import Path
import unittest

from enable_ingress import prepare_vhost


class IngressTests(unittest.TestCase):
    def test_https_preserves_redirect_certificates_and_other_proxy(self):
        source = (Path(__file__).parent/'fixtures/apache-https.conf').read_text()
        new, base = prepare_vhost(source)
        self.assertEqual(base, 'https://kestra.redunisol.com.ar')
        include = '    IncludeOptional /opt/bitrix-lead-receiver/apache-route.enabled.conf\n\n'
        self.assertEqual(new.replace(include, ''), source)
        self.assertNotIn('IncludeOptional', new.split('</VirtualHost>')[0])
        self.assertLess(new.index('IncludeOptional'), new.index('    ProxyPass "/"'))
        self.assertEqual(prepare_vhost(new), (new, base))

    def test_http_only_remains_supported(self):
        source = '<VirtualHost *:80>\n ServerName kestra.redunisol.com.ar\n    ProxyPass "/" "http://127.0.0.1:8080/"\n</VirtualHost>\n'
        self.assertEqual(prepare_vhost(source)[1], 'http://127.0.0.1')

    def test_ambiguous_or_missing_proxy_fails_before_mutation(self):
        source = (Path(__file__).parent/'fixtures/apache-https.conf').read_text()
        for invalid in (source+source, source.replace('http://127.0.0.1:8080/', 'http://other:8080/')):
            with self.assertRaises(RuntimeError):
                prepare_vhost(invalid)

    def test_include_after_catchall_is_rejected(self):
        source = (Path(__file__).parent/'fixtures/apache-https.conf').read_text()
        source = source.replace('    ProxyPassReverse "/"', '    IncludeOptional /opt/bitrix-lead-receiver/apache-route.enabled.conf\n    ProxyPassReverse "/"')
        with self.assertRaises(RuntimeError):
            prepare_vhost(source)


if __name__ == '__main__':
    unittest.main()

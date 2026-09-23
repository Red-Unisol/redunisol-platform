from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import ssl

from enable_ingress import prepare_vhost, probe_ingress, OriginHTTPSConnection


class IngressTests(unittest.TestCase):
    def test_tls_uses_loopback_and_validates_domain(self):
        context = ssl.create_default_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        connection = OriginHTTPSConnection('kestra.redunisol.com.ar', 443, timeout=5, context=context)
        with patch('enable_ingress.socket.create_connection') as connect, patch.object(context, 'wrap_socket') as wrap:
            connection.connect()
            connect.assert_called_once_with(('127.0.0.1', 443), 5)
            wrap.assert_called_once_with(connect.return_value, server_hostname='kestra.redunisol.com.ar')
        connection.close()

    def test_probe_retries_non_json_then_accepts_receiver_rejection(self):
        response = MagicMock(status=403)
        response.read.side_effect = [b'error code: 1010', b'{"error":"forbidden"}']
        with patch('enable_ingress.OriginHTTPSConnection') as connect, patch('enable_ingress.time.sleep') as sleep:
            connect.return_value.getresponse.return_value = response
            probe_ingress('https://kestra.redunisol.com.ar', '/test')
            self.assertEqual(connect.call_count, 2)
            self.assertEqual(connect.return_value.close.call_count, 2)
            sleep.assert_called_once_with(1)

    def test_arbitrary_forbidden_or_success_never_passes_probe(self):
        for status, body in ((403,b'not receiver'), (200,b'{"error":"forbidden"}')):
            response = MagicMock(status=status)
            response.read.return_value = body
            with patch('enable_ingress.OriginHTTPSConnection') as connect, patch('enable_ingress.time.sleep'):
                connect.return_value.getresponse.return_value = response
                with self.assertRaises(RuntimeError):
                    probe_ingress('https://kestra.redunisol.com.ar', '/test')
                self.assertEqual(connect.call_count, 10)

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

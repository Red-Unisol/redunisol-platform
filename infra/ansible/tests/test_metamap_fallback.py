import importlib.util
import io
from pathlib import Path
import unittest
import httpx
SCRIPT=Path(__file__).resolve().parents[1]/"roles/metamap_server/files/metamap-fallback.py"
spec=importlib.util.spec_from_file_location("metamap_fallback",SCRIPT)
fallback=importlib.util.module_from_spec(spec);spec.loader.exec_module(fallback)
class Upstream(io.BytesIO):
    def __init__(self,body,status=200,headers=None):
        super().__init__(body);self.status=status;self.headers=headers or {}
class FallbackTests(unittest.IsolatedAsyncioTestCase):
    async def request(self,opener,path,method="GET",headers=None,content=None):
        app=fallback.create_app(opener)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url="http://localhost") as client:
            return await client.request(method,path,headers=headers,content=content)
    async def test_binary_range_auth_and_query_preserved(self):
        def opener(request):
            self.assertEqual(request.full_url,fallback.ORIGIN+"/updates/transferencias/2.3.1/transferencias-celesol.exe?x=1")
            headers={k.lower():v for k,v in request.header_items()}
            self.assertEqual(headers["range"],"bytes=0-15");self.assertEqual(headers["x-client-secret"],"fixture")
            self.assertIsNone(request.data)
            return Upstream(b"MZ\0",206,{"Content-Range":"bytes 0-2/3","Content-Length":"3"})
        response=await self.request(opener,"/updates/transferencias/2.3.1/transferencias-celesol.exe?x=1",headers={"Range":"bytes=0-15","X-Client-Secret":"fixture"})
        self.assertEqual(response.status_code,206);self.assertEqual(response.content,b"MZ\0");self.assertEqual(response.headers["Content-Range"],"bytes 0-2/3")
    async def test_webhook_raw_bytes_and_signature_preserved(self):
        raw=b'{"fixture":"bytes"}\r\n'
        def opener(request):
            self.assertEqual(request.data,raw);self.assertEqual(request.get_header("X-signature"),"fixture-signature");self.assertEqual(request.method,"POST")
            return Upstream(b"{}")
        self.assertEqual((await self.request(opener,"/api/v1/metamap/webhooks",method="POST",headers={"x-signature":"fixture-signature","content-type":"application/json"},content=raw)).status_code,200)
    async def test_redirects_not_followed(self):
        self.assertIsNone(fallback.NoRedirect().redirect_request(None,None,302,"",{},"https://untrusted.invalid"))
        self.assertEqual((await self.request(lambda unused:Upstream(b"",302,{"Location":"https://untrusted.invalid/"}),"/health")).status_code,302)
    async def test_oversized_request_never_reaches_origin(self):
        def opener(unused):raise AssertionError("must not contact origin")
        self.assertEqual((await self.request(opener,"/api/v1/transfer-trace-events",method="POST",content=b"x"*(fallback.MAX_BODY+1))).status_code,413)
if __name__=="__main__":unittest.main()

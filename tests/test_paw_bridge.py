import importlib.util
import json
from pathlib import Path
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('paw_bridge', Path(__file__).resolve().parents[1] / 'scripts' / 'paw-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class StubState(bridge.PawState):
    def health(self):
        return {**super().health(), 'sdk_installed': True}

    def run(self, text):
        self.function = True
        return 'Only owners can merge.'


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.state = StubState()
        self.server = bridge.create_server(port=0, token='test-key', state=self.state)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def call(self, path, method='GET', data=None, origin=bridge.DEFAULT_ORIGIN, key='test-key'):
        headers = {'Origin': origin, 'X-API-Key': key, 'Content-Type': 'application/json'}
        request = Request(self.url + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            return response.status, dict(response.headers), json.loads(body) if body else None

    def test_health_does_not_load_model_verify_runs_probe(self):
        status, _, data = self.call('/health')
        self.assertEqual(status, 200)
        self.assertFalse(data['model_ready'])
        self.assertFalse(data['verified'])
        status, _, data = self.call('/verify', 'POST', {})
        self.assertEqual(status, 200)
        self.assertTrue(data['verified'])
        self.assertTrue(data['model_ready'])
        status, _, data = self.call('/infer', 'POST', {'program_id': bridge.PROGRAM_ID, 'input': 'Only owners can merge.'})
        self.assertEqual(data['output'], 'Only owners can merge.')

    def test_origin_key_and_preflight(self):
        self.assertEqual(self.call('/health', origin='https://untrusted.example')[0], 403)
        self.assertEqual(self.call('/health', key='wrong')[0], 401)
        status, headers, _ = self.call('/infer', 'OPTIONS', key='')
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Origin'], bridge.DEFAULT_ORIGIN)

    def test_invalid_input_and_concurrency(self):
        self.assertEqual(self.call('/infer', 'POST', {'program_id': 'other', 'input': 'hello'})[0], 422)
        self.assertEqual(self.call('/infer', 'POST', {'program_id': bridge.PROGRAM_ID, 'input': 'a' * 1201})[0], 422)
        self.assertEqual(self.call('/verify', 'POST', [1])[0], 400)
        self.state.lock.acquire()
        try:
            self.assertEqual(self.call('/verify', 'POST', {})[0], 409)
        finally:
            self.state.lock.release()


if __name__ == '__main__':
    unittest.main()

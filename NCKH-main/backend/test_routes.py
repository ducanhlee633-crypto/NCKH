import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from supabase_client import get_supabase


class AuthRoutesTest(unittest.TestCase):
    def test_missing_service_key_reports_configuration_error(self):
        get_supabase.cache_clear()
        settings = SimpleNamespace(supabase_service_role_key=None, supabase_anon_key='anon-only')
        try:
            with patch('supabase_client.get_settings', return_value=settings), patch('supabase_client.create_client') as create_client:
                client = TestClient(app)
                credentials = {'username': 'test_user', 'password': 'test-password-123'}
                for url, payload in [('/api/users', {**credentials, 'name': 'Test'}), ('/api/auth/login', credentials)]:
                    response = client.post(url, json=payload)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()['detail'], 'Supabase backend is not configured: set SUPABASE_SERVICE_ROLE_KEY')
                create_client.assert_not_called()
        finally:
            get_supabase.cache_clear()

    def test_register_login_and_protected_user_through_main(self):
        rows = []
        query = MagicMock()
        query.table.return_value = query
        query.select.return_value = query
        query.eq.return_value = query
        query.limit.return_value = query

        def insert(values):
            rows.append({**values, 'id': str(uuid4()), 'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z'})
            return query

        query.insert.side_effect = insert
        query.execute.side_effect = lambda: SimpleNamespace(data=rows)
        with patch('routers.user.get_supabase', return_value=query), patch('auth._jwt_settings', return_value=('test-secret-at-least-32-characters-long', 'HS256', 60)):
            client = TestClient(app)
            self.assertEqual(client.get('/api/health').json(), {'status': 'ok'})
            credentials = {'username': 'test_user', 'password': 'test-password-123'}
            created = client.post('/api/users', json={**credentials, 'name': 'Test User'})
            self.assertEqual(created.status_code, 201)
            self.assertNotIn('password_hash', created.json())
            logged_in = client.post('/api/auth/login', json=credentials)
            self.assertEqual(logged_in.status_code, 200)
            user_url = '/api/users/' + created.json()['id']
            self.assertEqual(client.get(user_url).status_code, 401)
            headers = {'Authorization': 'Bearer ' + logged_in.json()['access_token']}
            self.assertEqual(client.get(user_url, headers=headers).status_code, 200)
            self.assertEqual(client.post('/api/auth/login', json={**credentials, 'password': 'wrong-password'}).status_code, 401)
            self.assertEqual(client.post('/api/users', json={}).status_code, 422)


if __name__ == '__main__':
    unittest.main()

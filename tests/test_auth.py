import os
import tempfile
import unittest


_TEMP_DIR = tempfile.TemporaryDirectory()
os.environ["VAS_DB_PATH"] = os.path.join(_TEMP_DIR.name, "auth-test.db")

from fastapi.testclient import TestClient

from auth import hash_password, iso_utc
from db import get_db, init_db
import main

app = main.app
main.UPLOADS_DIR = main.Path(_TEMP_DIR.name) / "uploads"
main.UPLOADS_DIR.mkdir()


class AuthenticationFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db()
        conn.execute(
            "INSERT INTO users "
            "(username, role, last_name, active, password_hash, must_change_password, "
            "password_changed_at) VALUES (?,?,?,?,?,0,?)",
            (
                "sysadmin", "admin", "Администратор", 1,
                hash_password("Strong-Server-Password-2026!"), iso_utc(),
            ),
        )
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        _TEMP_DIR.cleanup()

    def test_temporary_password_and_forced_change(self):
        with TestClient(app) as admin:
            response = admin.post(
                "/api/session",
                json={"username": "sysadmin", "password": "Strong-Server-Password-2026!"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("password_hash", response.json()["user"])

            response = admin.post(
                "/api/users",
                json={
                    "username": "test.employee",
                    "role": "employee",
                    "last_name": "Тестовый",
                    "first_patronymic": "Сотрудник",
                    "position": "Научный сотрудник",
                    "unit": "НИО-5",
                    "rank": "",
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            temporary_password = response.json()["temporary_password"]
            user_id = response.json()["id"]
            private_file = main.UPLOADS_DIR / "private-test.docx"
            private_file.write_bytes(b"test")
            conn = get_db()
            conn.execute(
                "INSERT INTO software "
                "(user_id, title, certificate_number, docx_filename) VALUES (?,?,?,?)",
                (user_id, "Тестовое ПО", "RU-TEST", private_file.name),
            )
            conn.commit()
            conn.close()

            with TestClient(app) as employee:
                response = employee.post(
                    "/api/session",
                    json={"username": "test.employee", "password": temporary_password},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["user"]["must_change_password"], 1)

                response = employee.get("/api/profile")
                self.assertEqual(response.status_code, 403, response.text)

                response = employee.post(
                    "/api/account/password",
                    json={
                        "current_password": temporary_password,
                        "new_password": "Employee-Secure-Password-2026!",
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["user"]["must_change_password"], 0)
                self.assertEqual(employee.get("/api/profile").status_code, 200)
                self.assertEqual(
                    employee.get(f"/api/uploads/{private_file.name}").status_code, 200
                )

            response = admin.post(f"/api/users/{user_id}/reset-password", json={})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertGreaterEqual(len(response.json()["temporary_password"]), 12)
            self.assertGreater(len(admin.get("/api/audit").json()), 0)

        with TestClient(app) as anonymous:
            self.assertEqual(
                anonymous.get(f"/api/uploads/{private_file.name}").status_code, 401
            )


if __name__ == "__main__":
    unittest.main()

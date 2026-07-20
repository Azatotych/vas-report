import os
import tempfile
import unittest
from unittest.mock import patch


_TEMP_DIR = tempfile.TemporaryDirectory()
os.environ["VAS_DB_PATH"] = os.path.join(_TEMP_DIR.name, "auth-test.db")

from fastapi.testclient import TestClient

from auth import hash_password, iso_utc
from db import get_db, init_db
from parsers import parse_software_docx
from software_doc import generate_software_docx
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

    def test_software_upload_keeps_original_document(self):
        source = generate_software_docx(
            {
                "title": "Проверка исходного документа",
                "certificate_number": "RU 2026777001",
                "registration_date": "17.07.2026",
                "output_data": "",
                "authors": [
                    {
                        "full_name": "Администратор А.А.",
                        "position": "Администратор",
                        "contribution_percent": 100,
                    }
                ],
            },
            {},
        )

        with TestClient(app) as admin:
            response = admin.post(
                "/api/session",
                json={"username": "sysadmin", "password": "Strong-Server-Password-2026!"},
            )
            self.assertEqual(response.status_code, 200, response.text)

            response = admin.post(
                "/api/software/parse",
                files={
                    "file": (
                        "source.docx",
                        source,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            parsed = response.json()[0]
            uploaded_filename = parsed["docx_filename"]

            response = admin.post("/api/software", json=parsed)
            self.assertEqual(response.status_code, 200, response.text)
            saved = response.json()
            self.assertEqual(saved["docx_filename"], uploaded_filename)
            self.assertEqual((main.UPLOADS_DIR / uploaded_filename).read_bytes(), source)

            response = admin.get(f"/api/software/{saved['id']}/docx")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.content, source)

            response = admin.post(
                "/api/software",
                json={
                    "title": "Недопустимая ссылка",
                    "certificate_number": "RU 2026777002",
                    "docx_filename": "sw_999_foreign.docx",
                    "authors": [],
                },
            )
            self.assertEqual(response.status_code, 400, response.text)

    def test_software_pdf_batch_waits_for_manual_percentages_and_creates_shared_memo(self):
        parsed_entries = [
            {
                "title": f"Пакетная программа {index}",
                "certificate_number": f"RU 202699900{index}",
                "registration_date": "10.07.2026",
                "output_data": "",
                "authors": [
                    {
                        "full_name": "Администратор А.А.",
                        "position": "",
                        "contribution_percent": 0,
                        "points_claimed": 0,
                    }
                ],
            }
            for index in (1, 2)
        ]

        with TestClient(app) as admin:
            response = admin.post(
                "/api/session",
                json={"username": "sysadmin", "password": "Strong-Server-Password-2026!"},
            )
            self.assertEqual(response.status_code, 200, response.text)

            with patch.object(
                main, "parse_software_certificate_pdf", side_effect=parsed_entries
            ):
                response = admin.post(
                    "/api/software/parse-batch",
                    files=[
                        ("files", ("first.pdf", b"first", "application/pdf")),
                        ("files", ("second.pdf", b"second", "application/pdf")),
                    ],
                )

            self.assertEqual(response.status_code, 200, response.text)
            entries = response.json()["entries"]
            self.assertEqual(len(entries), 2)
            self.assertIsNone(entries[0]["docx_filename"])
            self.assertIsNone(entries[1]["docx_filename"])
            self.assertEqual(entries[0]["authors"][0]["contribution_percent"], 0)

            response = admin.post(
                "/api/software/register-batch", json={"entries": entries}
            )
            self.assertEqual(response.status_code, 400, response.text)

            for entry in entries:
                entry["authors"][0]["contribution_percent"] = 100
            response = admin.post(
                "/api/software/register-batch", json={"entries": entries}
            )
            self.assertEqual(response.status_code, 200, response.text)
            saved = response.json()
            self.assertEqual(saved["registered_count"], 2)
            memo_path = main.UPLOADS_DIR / saved["docx_filename"]
            self.assertTrue(memo_path.exists())
            self.assertEqual(len(parse_software_docx(str(memo_path))), 2)

            registered = {
                item["certificate_number"]: item
                for item in admin.get("/api/software").json()
                if item["certificate_number"].startswith("RU 202699900")
            }
            self.assertEqual(len(registered), 2)
            self.assertEqual(
                {item["docx_filename"] for item in registered.values()},
                {saved["docx_filename"]},
            )
            self.assertTrue(all(
                item["authors"][0]["contribution_percent"] == 100
                for item in registered.values()
            ))


if __name__ == "__main__":
    unittest.main()

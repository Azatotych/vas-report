# Развёртывание в локальной сети

## Текущее состояние миграции

В версии 3.0 реализована серверная система аккаунтов:

- логин и пароль вместо выбора пользователя;
- Argon2id для хранения паролей;
- случайные серверные сессии в `HttpOnly` cookie;
- временный пароль с обязательной сменой;
- блокировка после повторных неудачных попыток;
- роли `employee`, `supervisor`, `admin`;
- сброс пароля, отключение аккаунта и отзыв сеансов;
- журнал событий безопасности.

SQLite пока сохранён как переходный режим. До перевода на PostgreSQL приложение
следует запускать **одним процессом Uvicorn**. Для подразделения из 40 человек
этого достаточно для опытной эксплуатации, но штатное серверное развёртывание
должно завершиться переходом на PostgreSQL.

## Первоначальная настройка

```powershell
python -m pip install -r requirements.txt
python manage.py bootstrap-admin --username admin
python main.py
```

Команда запросит пароль без отображения на экране. Требования: не менее
12 символов; пароль не должен содержать логин.

Существующим пользователям пароль можно назначить командой:

```powershell
python manage.py set-password supervisor --temporary
python manage.py list-users
```

Ключ `--temporary` заставит пользователя сменить пароль при первом входе.

## Опытная эксплуатация в локальной сети

Для временного запуска без reverse proxy:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "8000"
$env:VAS_OPEN_BROWSER = "0"
python main.py
```

После этого приложение будет доступно по IP сервера, например
`http://192.168.1.10:8000`. Такой режим предназначен только для закрытого
тестового сегмента.

## Windows-сервер: постоянная установка

Все команды выполняются в PowerShell **от имени администратора** из каталога
приложения (например, `D:\vas_report`).

### 1. Разрешить порт в брандмауэре

```powershell
New-NetFirewallRule -DisplayName "VAS Report 8000" -Direction Inbound `
  -Protocol TCP -LocalPort 8000 -Action Allow -Profile Domain,Private
```

### 2. Автозапуск при загрузке сервера (Планировщик задач)

Создать `start_server.bat` в каталоге приложения:

```bat
@echo off
cd /d %~dp0
set HOST=0.0.0.0
set PORT=8000
set VAS_OPEN_BROWSER=0
python main.py >> logs\service.log 2>&1
```

Зарегистрировать задачу, стартующую при загрузке ОС (без входа пользователя):

```powershell
schtasks /create /tn "VAS Report Server" /sc onstart /ru SYSTEM `
  /tr "D:\vas_report\start_server.bat" /rl HIGHEST /f
schtasks /run /tn "VAS Report Server"    # первый запуск без перезагрузки
```

Остановка/перезапуск: `taskkill /im python.exe /f` (если python на сервере
используется только приложением) или по PID из
`netstat -ano | findstr :8000`, затем `schtasks /run /tn "VAS Report Server"`.

Альтернатива — служба Windows через [NSSM](https://nssm.cc):
`nssm install VASReport "C:\Python311\python.exe" "D:\vas_report\main.py"`
(+ переменные окружения на вкладке Environment), тогда доступны
`nssm start|stop|restart VASReport`.

### 3. Ежедневный бэкап базы и документов

```powershell
schtasks /create /tn "VAS Report Backup" /sc daily /st 03:00 /ru SYSTEM /f /tr `
  "powershell -NoProfile -Command Compress-Archive -Path 'D:\vas_report\data.db','D:\vas_report\uploads','D:\vas_report\reports' -DestinationPath ('E:\backups\vas_' + (Get-Date -Format yyyyMMdd) + '.zip') -Force"
```

Папка назначения (`E:\backups`) должна существовать и быть недоступной обычным
пользователям. Восстановление: остановить сервер, распаковать архив поверх
каталога приложения, запустить сервер.

### 4. Первые аккаунты после установки

```powershell
python manage.py bootstrap-admin --username admin   # спросит пароль (>=12 симв.)
python manage.py list-users                         # актуальные логины
python manage.py set-password grigorenko_ag --temporary
python manage.py set-password tihonov_ss --temporary
```

`--temporary` выдаёт пользователю временный пароль (вводится администратором),
при первом входе система потребует сменить его. Дальнейшие аккаунты создаются
из интерфейса (раздел «Сотрудники и аккаунты») — система сама генерирует
временный пароль и показывает его один раз.

## Штатная схема

В рабочем контуре рекомендуется:

1. Nginx или Caddy принимает HTTPS-запросы на 443 порту.
2. FastAPI слушает только `127.0.0.1:8000`.
3. Установлены `VAS_COOKIE_SECURE=1` и `VAS_TRUST_PROXY=1`.
4. Доступ к серверу ограничен локальной сетью межсетевым экраном.
5. База данных и папки `uploads/`, `reports/` резервируются ежедневно.
6. В журнал сервера и резервные копии имеют доступ только администраторы.

Пример переменных:

```text
HOST=127.0.0.1
PORT=8000
VAS_OPEN_BROWSER=0
VAS_COOKIE_SECURE=1
VAS_TRUST_PROXY=1
VAS_SESSION_HOURS=12
VAS_MAX_UPLOAD_MB=20
```

При работе за reverse proxy заголовок `X-Forwarded-For` считается доверенным
только при `VAS_TRUST_PROXY=1`.

## Важное ограничение переходного этапа

До внедрения PostgreSQL нельзя запускать несколько Uvicorn workers или несколько
экземпляров приложения с общей SQLite-базой. Следующий этап миграции:

- SQLAlchemy;
- PostgreSQL;
- Alembic;
- пул соединений;
- перенос текущей SQLite-базы с проверкой количества записей и внешних ключей.

После этого можно будет использовать 2–4 процесса приложения и проводить
нагрузочное тестирование на 40–100 одновременных учётных записей.

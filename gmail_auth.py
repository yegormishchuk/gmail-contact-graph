"""
Gmail API Authentication Module (Web App)

Для использования:
1. Создайте проект в Google Cloud Console: https://console.cloud.google.com/
2. Включите Gmail API в разделе "APIs & Services" -> "Library"
3. Настройте OAuth consent screen и добавьте scopes
4. Создайте OAuth 2.0 credentials:
   - Перейдите в "APIs & Services" -> "Credentials"
   - Нажмите "Create Credentials" -> "OAuth client ID"
   - Выберите "Web application"
   - Добавьте Authorized redirect URI: http://localhost:8080/callback
   - Скачайте JSON файл и сохраните как 'credentials.json' в папке проекта
5. Запустите этот скрипт для аутентификации
"""

import os
import json
import pickle
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import webbrowser

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

# Scopes определяют уровень доступа к Gmail
# https://developers.google.com/gmail/api/auth/scopes
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',  # Чтение писем
    # 'https://www.googleapis.com/auth/gmail.modify',  # Изменение писем
    # 'https://www.googleapis.com/auth/gmail.send',    # Отправка писем
]

# Пути к файлам
CREDENTIALS_FILE = 'credentials.json'  # OAuth credentials из Google Cloud Console
TOKEN_FILE = 'token.pickle'  # Сохраненный токен доступа

# Redirect URI - должен совпадать с настройками в Google Cloud Console
REDIRECT_URI = 'http://localhost:8080/callback'


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """Обработчик callback от Google OAuth."""

    def do_GET(self):
        """Обработка GET запроса с authorization code."""
        parsed = urlparse(self.path)

        if parsed.path == '/callback':
            query = parse_qs(parsed.query)

            if 'code' in query:
                self.server.auth_code = query['code'][0]
                self.send_response(200)
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(
                    '<html><body><h1>Авторизация успешна!</h1>'
                    '<p>Можете закрыть это окно.</p></body></html>'.encode('utf-8')
                )
            else:
                error = query.get('error', ['Unknown error'])[0]
                self.server.auth_code = None
                self.send_response(400)
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(
                    f'<html><body><h1>Ошибка авторизации</h1>'
                    f'<p>{error}</p></body></html>'.encode('utf-8')
                )
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Отключаем логирование запросов."""
        pass


def create_flow() -> Flow:
    """Создание OAuth flow."""
    if not os.path.exists(CREDENTIALS_FILE):
        raise FileNotFoundError(
            f"Файл '{CREDENTIALS_FILE}' не найден!\n"
            "Скачайте OAuth credentials из Google Cloud Console "
            "и сохраните как 'credentials.json'"
        )

    flow = Flow.from_client_secrets_file(
        CREDENTIALS_FILE,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    return flow


def get_authorization_url() -> tuple[str, str]:
    """
    Генерация URL для авторизации.

    Returns:
        tuple[str, str]: (authorization_url, state)
    """
    flow = create_flow()
    authorization_url, state = flow.authorization_url(
        access_type='offline',  # Для получения refresh_token
        include_granted_scopes='true',
        prompt='consent'  # Всегда показывать consent screen
    )
    return authorization_url, state


def exchange_code_for_credentials(code: str) -> Credentials:
    """
    Обмен authorization code на credentials.

    Args:
        code: Authorization code от Google

    Returns:
        Credentials: Объект с учетными данными
    """
    flow = create_flow()
    flow.fetch_token(code=code)
    return flow.credentials


def save_credentials(creds: Credentials) -> None:
    """Сохранение credentials в файл."""
    with open(TOKEN_FILE, 'wb') as token:
        pickle.dump(creds, token)
    print(f"Токен сохранен в '{TOKEN_FILE}'")


def load_credentials() -> Credentials | None:
    """Загрузка credentials из файла."""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            return pickle.load(token)
    return None


def authenticate() -> Credentials:
    """
    Полный процесс аутентификации.

    При первом запуске откроется браузер для авторизации.
    Токен сохраняется в token.pickle для последующих запусков.

    Returns:
        Credentials: Объект с учетными данными для API
    """
    creds = load_credentials()

    # Если токен есть и валиден - используем его
    if creds and creds.valid:
        return creds

    # Если токен истек, но есть refresh_token - обновляем
    if creds and creds.expired and creds.refresh_token:
        print("Обновление токена...")
        creds.refresh(Request())
        save_credentials(creds)
        return creds

    # Иначе запускаем полный процесс авторизации
    print("Требуется авторизация...")

    # Генерируем URL
    auth_url, state = get_authorization_url()

    # Запускаем локальный сервер для получения callback
    server = HTTPServer(('localhost', 8080), OAuthCallbackHandler)
    server.auth_code = None

    # Открываем браузер
    print(f"Открываю браузер для авторизации...")
    print(f"Если браузер не открылся, перейдите по ссылке:\n{auth_url}\n")
    webbrowser.open(auth_url)

    # Ждем callback
    print("Ожидание авторизации...")
    server.handle_request()

    if not server.auth_code:
        raise Exception("Не удалось получить authorization code")

    # Обмениваем code на credentials
    creds = exchange_code_for_credentials(server.auth_code)
    save_credentials(creds)

    return creds


def get_gmail_service():
    """
    Получение сервиса Gmail API.

    Returns:
        Resource: Gmail API service object
    """
    creds = authenticate()
    service = build('gmail', 'v1', credentials=creds)
    return service


def get_senders(max_results: int = 100) -> list[str]:
    """
    Получение списка отправителей писем.

    Args:
        max_results: Максимальное количество писем для обработки

    Returns:
        list[str]: Список отправителей (From header)
    """
    service = get_gmail_service()
    senders = []

    print(f"Получение списка писем...")
    results = service.users().messages().list(
        userId='me', maxResults=max_results
    ).execute()

    messages = results.get('messages', [])
    print(f"Найдено {len(messages)} писем. Извлекаю отправителей...")

    for i, msg in enumerate(messages):
        msg_data = service.users().messages().get(
            userId='me', id=msg['id'], format='metadata',
            metadataHeaders=['From']
        ).execute()

        headers = {h['name']: h['value'] for h in msg_data['payload']['headers']}
        sender = headers.get('From')
        if sender:
            senders.append(sender)

        if (i + 1) % 20 == 0:
            print(f"  Обработано {i + 1}/{len(messages)}")

    return senders


def save_senders_to_json(senders: list[str], filename: str = 'senders.json') -> None:
    """Сохранение списка отправителей в JSON файл."""
    data = {
        'count': len(senders),
        'senders': senders
    }
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(senders)} отправителей в '{filename}'")


def main():
    """Получение отправителей и сохранение в JSON."""
    try:
        senders = get_senders(max_results=1000)
        save_senders_to_json(senders)
    except FileNotFoundError as e:
        print(f"Ошибка: {e}")
    except Exception as e:
        print(f"Ошибка: {e}")


if __name__ == '__main__':
    main()

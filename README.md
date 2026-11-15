# Durak Local (Hotspot Multiplayer)

Локальный мультиплеер «Дурака» на Python (Flask + Flask-SocketIO) для игры по точке доступа Wi-Fi без интернета.

## Запуск
1. Установить зависимости:
   `pip install -r requirements.txt`
2. Запустить сервер:
   `python server.py`
3. Подключить игроков к одной Wi-Fi сети и открыть в браузере `http://<IP-хоста>:5000`.
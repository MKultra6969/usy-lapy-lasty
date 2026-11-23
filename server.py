"""Раздаёт статику из public/ и сам докачивает тяжёлые файлы.

Фотографий в репозитории нет: при старте сервер читает public/photos.json
и скачивает недостающие превью с Wikimedia Commons в public/img/.
Пока файл не скачан, запрос к нему уходит редиректом на оригинал.

Видео лежит в репозитории, но на хостинг через MCP попадают только текстовые
файлы. Поэтому на сервере оно берётся по адресу из public/media.json.
"""

import gzip
import json
import os
import re
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "public"
IMG = ROOT / "img"
PORT = int(os.getenv("CTRLFREE_PORT", "8000"))
USER_AGENT = "UsyLapyLasty/1.0 (static site, image mirror)"
TEXT_TYPES = {".html", ".css", ".js", ".json", ".svg"}


def read_remote_map():
    """Имя файла в img/ -> адрес превью на Commons."""
    photos = json.loads((ROOT / "photos.json").read_text(encoding="utf-8"))
    remote = {}
    for photo in photos:
        for key, url in photo.items():
            if key.startswith("thumb") and url:
                remote[f"{photo['id']}-{key[5:]}.jpg"] = url
    return remote


def read_media_map():
    """Имя файла в media/ -> откуда его взять, если на диске его нет."""
    manifest = ROOT / "media.json"
    if not manifest.exists():
        return {}
    return {item["file"]: item["url"] for item in json.loads(manifest.read_text(encoding="utf-8"))}


REMOTE = read_remote_map()
MEDIA = read_media_map()


def download(target, url):
    name = target.name
    if target.exists() and target.stat().st_size > 0:
        return True
    for attempt in range(1, 5):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=40) as response:
                data = response.read()
            part = target.with_name(target.name + ".part")
            part.write_bytes(data)
            part.replace(target)
            return True
        except Exception as error:  # сеть может отвалиться, пробуем ещё
            print(f"[img] {name}: попытка {attempt} не удалась: {error}", flush=True)
            time.sleep(3 * attempt)
    return False


def mirror_files():
    (ROOT / "media").mkdir(parents=True, exist_ok=True)
    for name, url in MEDIA.items():
        ok = download(ROOT / "media" / name, url)
        print(f"[media] {name}: {'на месте' if ok else 'не скачался'}", flush=True)

    IMG.mkdir(parents=True, exist_ok=True)
    failed = 0
    for name, url in REMOTE.items():
        fresh = not (IMG / name).exists()
        if not download(IMG / name, url):
            failed += 1
        if fresh:
            time.sleep(0.5)  # не долбим Commons запросами подряд
    print(f"[img] готово, файлов: {len(REMOTE) - failed} из {len(REMOTE)}", flush=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path.startswith("/img/"):
            name = path[5:]
            if name in REMOTE and not (IMG / name).exists():
                self.send_response(302)
                self.send_header("Location", REMOTE[name])
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

        if self.send_gzipped(path) or self.send_range(path):
            return
        super().do_GET()

    def send_range(self, path):
        """Видео: отдаём кусками по заголовку Range, иначе Safari его не играет."""
        header = self.headers.get("Range", "")
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
        file = (ROOT / path.lstrip("/")).resolve()
        if not match or ROOT not in file.parents or not file.is_file():
            return False
        size = file.stat().st_size
        first, last = match.groups()
        if first == "" and last == "":
            return False
        if first == "":  # последние N байт
            start, end = max(0, size - int(last)), size - 1
        else:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(file)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        try:
            with open(file, "rb") as source:
                source.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = source.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except ConnectionError:
            pass  # браузер передумал и закрыл соединение, это нормально
        return True

    def send_gzipped(self, path):
        """Текстовые файлы маленькие, жмём их на лету."""
        if "gzip" not in self.headers.get("Accept-Encoding", ""):
            return False
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        file = (ROOT / relative).resolve()
        if ROOT not in file.parents or not file.is_file() or file.suffix not in TEXT_TYPES:
            return False
        body = gzip.compress(file.read_bytes(), 6)
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(file)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def send_response(self, code, message=None):
        self.status = code
        super().send_response(code, message)

    def end_headers(self):
        # надолго кэшируем только успешно отданные картинки: редирект и 404 временные
        heavy = self.path.startswith(("/img/", "/media/"))
        if heavy and getattr(self, "status", 0) in (200, 206, 304):
            self.send_header("Cache-Control", "public, max-age=604800")
        elif heavy:
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=mirror_files, daemon=True).start()
    print(f"[web] слушаю 0.0.0.0:{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

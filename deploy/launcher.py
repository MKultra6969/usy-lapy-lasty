"""Запускает сайт из открытого репозитория.

Через MCP на ctrlfree можно залить только текстовые файлы, а в проекте есть
видео. Поэтому на хостинге лежит один этот файл. При старте он скачивает архив
ветки main, распаковывает его в site/ и запускает оттуда server.py.

Чтобы обновить сайт, достаточно запушить изменения и перезапустить приложение.
Если GitHub недоступен, запускается то, что скачано в прошлый раз.
"""

import io
import runpy
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO = "MKultra6969/usy-lapy-lasty"
ARCHIVE = f"https://codeload.github.com/{REPO}/zip/refs/heads/main"
HERE = Path(__file__).resolve().parent
SITE = HERE / "site"


def fetch():
    request = urllib.request.Request(ARCHIVE, headers={"User-Agent": "usy-lapy-lasty-launcher"})
    with urllib.request.urlopen(request, timeout=60) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))

    fresh = HERE / "site.new"
    shutil.rmtree(fresh, ignore_errors=True)
    for item in archive.infolist():
        # внутри архива всё лежит в папке вида usy-lapy-lasty-main/
        relative = item.filename.split("/", 1)[1] if "/" in item.filename else ""
        if not relative or item.is_dir():
            continue
        target = (fresh / relative).resolve()
        if fresh.resolve() not in target.parents:
            continue  # путь из архива не должен вылезать за пределы папки
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(item))

    # фотографии, скачанные в прошлый запуск, переносим, чтобы не качать заново
    photos = SITE / "public" / "img"
    if photos.is_dir():
        shutil.move(str(photos), str(fresh / "public" / "img"))
    shutil.rmtree(SITE, ignore_errors=True)
    fresh.rename(SITE)


try:
    fetch()
    print("[launcher] код обновлён из репозитория", flush=True)
except Exception as error:
    print(f"[launcher] не удалось обновить код: {error}", flush=True)
    if not (SITE / "server.py").exists():
        raise

sys.argv = [str(SITE / "server.py")]
runpy.run_path(str(SITE / "server.py"), run_name="__main__")

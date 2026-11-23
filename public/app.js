(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = list => list[Math.floor(Math.random() * list.length)];

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasMouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const narrow = matchMedia('(max-width: 820px)');

  const frameJobs = [];   // всё, что двигается каждый кадр
  const resizeJobs = [];

  /* ---------- буквы заголовков ---------- */

  $$('.split').forEach(el => {
    let i = 0;
    [...el.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const ch of node.textContent) {
          if (!ch.trim()) { frag.append(ch); continue; }
          const span = document.createElement('span');
          span.className = 'ch';
          span.style.setProperty('--i', i++);
          span.textContent = ch;
          frag.append(span);
        }
        node.replaceWith(frag);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
        node.classList.add('ch');
        node.style.setProperty('--i', i++);
      }
    });
  });

  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.race([fonts, new Promise(done => setTimeout(done, 1600))])
    .then(() => root.classList.add('is-ready'));

  /* ---------- появление при прокрутке ---------- */

  const revealIO = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      revealIO.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -7% 0px' });
  $$('[data-reveal], .sheet').forEach(el => revealIO.observe(el));

  // тема страницы: берём раздел, который сейчас пересекает середину экрана
  const themeIO = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) document.body.dataset.theme = entry.target.dataset.theme;
    });
  }, { rootMargin: '-50% 0px -50% 0px' });
  $$('[data-theme]').forEach(el => el !== document.body && themeIO.observe(el));

  /* ---------- счётчики ---------- */

  const spaced = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const countIO = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      countIO.unobserve(entry.target);
      const el = entry.target;
      const to = Number(el.dataset.count);
      if (calm || !to) { el.textContent = spaced(to); return; }
      const started = performance.now();
      const long = 900 + Math.min(1100, Math.log10(to + 1) * 320);
      const step = now => {
        const t = clamp((now - started) / long, 0, 1);
        el.textContent = spaced(to * (1 - Math.pow(1 - t, 4)));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  $$('[data-count]').forEach(el => countIO.observe(el));

  /* ---------- слова при тыке в фотографию ---------- */

  const WORDS = {
    cat: ['мяу', 'мрр', 'мяу?', 'мур-мур', 'мя'],
    belek: ['ма-а', 'уа-а', 'фыр', 'ы-ы'],
    kotik: ['уф', 'уф-уф', 'арр', 'бе-е', 'хрр'],
  };

  function say(kind, x, y) {
    if (!WORDS[kind]) return;
    const el = document.createElement('span');
    el.className = 'say';
    el.textContent = pick(WORDS[kind]);
    el.style.left = `${x + 8}px`;
    el.style.top = `${y - 46}px`;
    el.style.setProperty('--r', `${Math.random() * 16 - 8}deg`);
    document.body.append(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 1600);
  }

  $$('[data-say]').forEach(el => {
    if (el.closest('.pile')) return; // у карточек на обложке свой обработчик, там ещё и перетаскивание
    el.addEventListener('click', e => say(el.dataset.say, e.clientX, e.clientY));
  });

  /* ---------- состояние мыши и прокрутки ---------- */

  const pointer = { x: 0, y: 0, nx: 0, ny: 0 };
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = e.clientX / innerWidth - 0.5;
    pointer.ny = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  const scroll = { y: scrollY, speed: 0, dir: 1, max: 1, step: 1 };
  // сглаживание, которое не зависит от частоты кадров: step это доля от обычного кадра в 60 Гц
  const ease = amount => 1 - Math.pow(1 - amount, scroll.step);
  resizeJobs.push(() => { scroll.max = Math.max(1, root.scrollHeight - innerHeight); });

  /* ---------- стопка фотографий на обложке ---------- */

  const hero = $('.hero');
  const pile = $('#pile');
  let topZ = 5;

  const snaps = $$('.snap', pile).map(el => ({
    el,
    x: 0, y: 0, vx: 0, vy: 0, tilt: 0, px: 0, py: 0,
    base: parseFloat(getComputedStyle(el).getPropertyValue('--r')) || 0,
    depth: parseFloat(el.dataset.depth) || 1,
    held: false, moved: 0, lastX: 0, lastY: 0, home: { x: 0, y: 0 },
  }));

  resizeJobs.push(() => {
    snaps.forEach(s => {
      s.home.x = pile.offsetLeft + s.el.offsetLeft + s.el.offsetWidth / 2;
      s.home.y = pile.offsetTop + s.el.offsetTop + s.el.offsetHeight / 2;
    });
  });

  snaps.forEach(s => {
    const el = s.el;

    el.addEventListener('pointerdown', e => {
      if (e.button) return;
      s.held = true;
      s.moved = 0;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.vx = s.vy = 0;
      el.style.zIndex = ++topZ;
      el.classList.add('is-drag');
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', e => {
      if (!s.held) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.x += dx;
      s.y += dy;
      s.vx = lerp(s.vx, dx, 0.6);
      s.vy = lerp(s.vy, dy, 0.6);
      s.moved += Math.abs(dx) + Math.abs(dy);
    });

    const release = e => {
      if (!s.held) return;
      s.held = false;
      el.classList.remove('is-drag');
      if (e.type === 'pointerup' && s.moved < 7) say(el.dataset.say, e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  });

  frameJobs.push(() => {
    if (scroll.y > innerHeight * 1.3) return;
    const w = hero.clientWidth;
    const h = hero.clientHeight;

    snaps.forEach(s => {
      if (s.held) {
        // пока карточку держат, наклоняем её в сторону движения
        s.tilt = lerp(s.tilt, clamp(s.vx * 1.1, -16, 16), 0.2);
        s.vx *= 0.82;
        s.vy *= 0.82;
      } else {
        s.x += s.vx;
        s.y += s.vy;
        s.vx *= 0.93;
        s.vy *= 0.93;
        // не даём выбросить карточку за край обложки
        const cx = s.home.x + s.x;
        const cy = s.home.y + s.y;
        if (cx < 40) s.vx += (40 - cx) * 0.02;
        if (cx > w - 40) s.vx += (w - 40 - cx) * 0.02;
        if (cy < 60) s.vy += (60 - cy) * 0.02;
        if (cy > h - 40) s.vy += (h - 40 - cy) * 0.02;
        s.tilt = lerp(s.tilt, clamp(s.vx * 0.8, -12, 12), 0.1);
      }

      const k = calm ? 0 : s.depth;
      s.px = lerp(s.px, -pointer.nx * 30 * k, 0.07);
      s.py = lerp(s.py, -pointer.ny * 22 * k - scroll.y * 0.07 * k, 0.07);
      s.el.style.transform =
        `translate3d(${(s.x + s.px).toFixed(2)}px, ${(s.y + s.py).toFixed(2)}px, 0) rotate(${(s.base + s.tilt).toFixed(2)}deg)`;
    });
  });

  /* ---------- круглая надпись и рыбка в шапке ---------- */

  const badge = $('#badge');
  const fish = $('#fish');
  let spin = 0;
  frameJobs.push(() => {
    spin += 0.18 + scroll.speed * 0.25;
    if (!calm) badge.style.setProperty('--a', `${spin.toFixed(2)}deg`);
    fish.style.setProperty('--p', (scroll.y / scroll.max).toFixed(4));
  });

  /* ---------- бегущая строка ---------- */

  const marquee = $('#marquee');
  marquee.innerHTML += marquee.innerHTML + marquee.innerHTML;
  let marqueeX = 0;
  let marqueeW = 1;
  resizeJobs.push(() => { marqueeW = marquee.scrollWidth / 3; });
  frameJobs.push(() => {
    if (calm) return;
    marqueeX -= (0.9 + Math.abs(scroll.speed) * 0.5) * scroll.dir;
    if (marqueeX <= -marqueeW) marqueeX += marqueeW;
    if (marqueeX > 0) marqueeX -= marqueeW;
    marquee.style.transform = `translate3d(${marqueeX.toFixed(1)}px, 0, 0) skewX(${clamp(scroll.speed * -0.25, -9, 9).toFixed(2)}deg)`;
  });

  /* ---------- параллакс внутри рамок ---------- */

  const frames = $$('[data-parallax]').map(el => ({ el, img: $('img', el), seen: false }));
  const frameIO = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const item = frames.find(f => f.el === entry.target);
      if (item) item.seen = entry.isIntersecting;
    });
  }, { rootMargin: '10% 0px' });
  frames.forEach(f => frameIO.observe(f.el));
  frameJobs.push(() => {
    if (calm) return;
    frames.forEach(f => {
      if (!f.seen) return;
      const box = f.el.getBoundingClientRect();
      const t = clamp((box.top + box.height / 2) / innerHeight, -0.2, 1.2) - 0.5;
      f.img.style.translate = `0 ${(t * -box.height * 0.16).toFixed(1)}px`;
    });
  });

  /* ---------- кот, который подглядывает ---------- */

  const peek = $('#peek svg');
  const pupils = $$('.pupil', peek).map(el => ({ el, cx: Number(el.dataset.cx), cy: Number(el.dataset.cy), x: 0, y: 0 }));
  let peekSeen = false;
  new IntersectionObserver(([entry]) => { peekSeen = entry.isIntersecting; }).observe(peek);
  frameJobs.push(() => {
    if (!peekSeen) return;
    const box = peek.getBoundingClientRect();
    const unit = box.width / 248;
    pupils.forEach(p => {
      const ex = box.left + (p.cx + 24) * unit;
      const ey = box.top + p.cy * unit;
      // без мыши кот смотрит туда, куда крутят страницу
      const tx = hasMouse ? pointer.x : box.left + box.width / 2;
      const ty = hasMouse ? pointer.y : ey + scroll.dir * 300;
      const dx = tx - ex;
      const dy = ty - ey;
      const far = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, far / 160);
      p.x = lerp(p.x, (dx / far) * 9 * pull, 0.14);
      p.y = lerp(p.y, (dy / far) * 3.5 * pull, 0.14);
      p.el.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`;
    });
  });

  /* ---------- четыре шубы ---------- */

  const coat = $('#coat');
  const coatSteps = $$('[data-coat]', coat);
  let coatStage = 1;
  let coatTimer = 0;

  function setCoat(n) {
    coatStage = n;
    coat.dataset.stage = n;
    coatSteps.forEach((btn, i) => {
      btn.classList.toggle('on', i === n);
      btn.setAttribute('aria-pressed', i === n);
    });
  }
  setCoat(1);

  coatSteps.forEach((btn, i) => btn.addEventListener('click', () => {
    clearInterval(coatTimer);
    coat.classList.add('is-manual');
    setCoat(i);
  }));

  if (!calm) {
    new IntersectionObserver(([entry]) => {
      clearInterval(coatTimer);
      if (entry.isIntersecting && !coat.classList.contains('is-manual')) {
        coatTimer = setInterval(() => setCoat((coatStage + 1) % coatSteps.length), 3400);
      }
    }, { threshold: 0.35 }).observe(coat);
  } else {
    coat.classList.add('is-manual');
  }

  /* ---------- снег и пузыри ---------- */

  class Flakes {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.kind = canvas.dataset.fx;
      this.items = [];
      this.seen = false;
      new IntersectionObserver(([entry]) => { this.seen = entry.isIntersecting; })
        .observe(canvas.closest('section'));
    }

    resize() {
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      this.w = this.canvas.clientWidth;
      this.h = this.canvas.clientHeight;
      this.canvas.width = this.w * ratio;
      this.canvas.height = this.h * ratio;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round(this.w * this.h / { snow: 13000, bubbles: 42000, embers: 30000 }[this.kind]);
      this.items = Array.from({ length: clamp(count, 14, 130) }, () => this.spawn(true));
    }

    spawn(anywhere) {
      const snow = this.kind === 'snow';
      const embers = this.kind === 'embers';
      const p = {
        x: Math.random() * this.w,
        y: anywhere ? Math.random() * this.h : (snow ? -10 : this.h + 10),
        sway: Math.random() * Math.PI * 2,
      };
      if (snow) Object.assign(p, { r: 1 + Math.random() * 2.6, v: 0.35 + Math.random() * 0.9, a: 0.55 + Math.random() * 0.45 });
      else if (embers) Object.assign(p, { r: 0.7 + Math.random() * 1.7, v: -(0.3 + Math.random() * 1.1), a: 0.25 + Math.random() * 0.55 });
      else Object.assign(p, { r: 2 + Math.random() * 8, v: -(0.25 + Math.random() * 0.7), a: 0.1 + Math.random() * 0.2 });
      return p;
    }

    draw(time) {
      if (!this.seen) return;
      const { ctx } = this;
      const snow = this.kind === 'snow';
      ctx.clearRect(0, 0, this.w, this.h);
      const embers = this.kind === 'embers';
      ctx.fillStyle = embers ? '#e58a4e' : '#fff';
      ctx.strokeStyle = '#f0e8d8';
      ctx.lineWidth = 1.2;
      this.items.forEach((p, i) => {
        p.y += p.v - scroll.speed * 0.04;
        p.x += Math.sin(time / 1400 + p.sway) * (snow ? 0.45 : embers ? 0.7 : 0.3);
        if (p.y > this.h + 12 || p.y < -12) this.items[i] = p = this.spawn(false);
        // искры мерцают, снег и пузыри нет
        ctx.globalAlpha = embers ? p.a * (0.55 + 0.45 * Math.sin(time / 260 + p.sway * 3)) : p.a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        if (snow || embers) ctx.fill(); else ctx.stroke();
      });
    }
  }

  const flakes = calm ? [] : $$('canvas[data-fx]').map(c => new Flakes(c));
  resizeJobs.push(() => flakes.forEach(f => f.resize()));
  frameJobs.push(time => flakes.forEach(f => f.draw(time)));

  /* ---------- видео с плюшевыми тюленями ---------- */

  const cinema = $('#cinema');
  const video = $('#plushVideo');
  const sound = $('#sound');
  const soundText = $('#soundText');
  let cinemaSeen = false;

  if (calm) video.controls = true;
  new IntersectionObserver(([entry]) => {
    cinemaSeen = entry.isIntersecting;
    // играет только пока ролик на экране, со звуком или без
    if (cinemaSeen && !calm) video.play().catch(() => {});
    else video.pause();
  }, { threshold: 0.2 }).observe(video);

  sound.addEventListener('click', () => {
    video.muted = !video.muted;
    const on = !video.muted;
    sound.classList.toggle('on', on);
    sound.setAttribute('aria-pressed', on);
    sound.setAttribute('aria-label', on ? 'Выключить звук' : 'Включить звук');
    soundText.textContent = on
      ? 'звук играет · нажми, чтобы выключить · звук играет ·'
      : 'включи звук · там музыка · включи звук · там музыка ·';
    if (on) video.play().catch(() => {});
  });

  frameJobs.push(() => {
    if (!cinemaSeen || calm) return;
    const box = cinema.getBoundingClientRect();
    const t = clamp((innerHeight - box.top) / (innerHeight * 0.85), 0, 1);
    cinema.style.setProperty('--s', (0.76 + 0.24 * (1 - Math.pow(1 - t, 3))).toFixed(4));
  });

  /* ---------- кто ты сегодня ---------- */

  const ANIMALS = [
    {
      img: 'cat1', kind: 'cat', name: 'Сегодня ты кот',
      lines: [
        'Уронил что-то со стола и смотришь в глаза.',
        'Дел полно, поэтому ты лежишь.',
        'Орёшь у двери, выходить не планируешь.',
        'Сел на самое нужное и не встаёшь.',
      ],
    },
    {
      img: 'belek1', kind: 'belek', name: 'Сегодня ты белёк',
      lines: [
        'Круглый, пушистый и ничего не решаешь.',
        'Лежишь на холодном и всем доволен.',
        'Прибавил два кило за день и не жалеешь.',
        'Смотришь большими глазами, тебе всё прощают.',
      ],
    },
    {
      img: 'kotik1', kind: 'kotik', name: 'Сегодня ты морской котик',
      lines: [
        'Занял лучший камень и никого не пускаешь.',
        'Громко высказался и ушёл в воду.',
        'Выглядишь мокрым, чувствуешь себя прекрасно.',
        'Полгода в море, на связь не выходишь.',
      ],
    },
  ];

  const ROUNDS = 9;
  const reels = $$('.reel', $('#reels')).map(el => {
    const strip = $('.reel__strip', el);
    for (let round = 0; round < ROUNDS; round++) {
      ANIMALS.forEach(a => {
        const img = new Image();
        img.src = `img/${a.img}-500.jpg`;
        img.alt = '';
        img.decoding = 'async';
        strip.append(img);
      });
    }
    return { el, strip, at: 0 };
  });
  const CELLS = ROUNDS * ANIMALS.length;
  const cellShift = index => `translateY(${(-index * 100 / CELLS).toFixed(4)}%)`;
  reels.forEach((r, i) => { r.at = i % ANIMALS.length; r.strip.style.transform = cellShift(r.at); });

  const spinBtn = $('#spin');
  const result = $('#result');
  const resName = $('#resName');
  const resLine = $('#resLine');
  const spinCount = $('#spinCount');

  let spins = 0;
  try { spins = Number(localStorage.getItem('spins')) || 0; } catch { /* хранилище может быть закрыто */ }
  const plural = n => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'раз';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'раза';
    return 'раз';
  };
  const showCount = () => { spinCount.textContent = spins ? `Барабаны крутили ${spins} ${plural(spins)}` : ''; };
  showCount();

  let lastAnimal = -1;
  spinBtn.addEventListener('click', () => {
    if (spinBtn.disabled) return;
    spinBtn.disabled = true;
    result.classList.remove('pop');

    let index = Math.floor(Math.random() * ANIMALS.length);
    if (index === lastAnimal && Math.random() < 0.6) index = (index + 1) % ANIMALS.length;
    lastAnimal = index;
    const animal = ANIMALS[index];

    const done = reels.map((r, i) => {
      const start = r.at % ANIMALS.length;
      const target = ANIMALS.length * (ROUNDS - 3 + i) + index;
      const long = calm ? 1 : 1500 + i * 520;
      const run = r.strip.animate(
        [{ transform: cellShift(start) }, { transform: cellShift(target) }],
        { duration: long, easing: 'cubic-bezier(.12, .78, .16, 1)' },
      );
      return run.finished.then(() => {
        r.at = index;
        r.strip.style.transform = cellShift(index);
        r.el.classList.remove('is-hit');
        void r.el.offsetWidth;
        r.el.classList.add('is-hit');
      });
    });

    Promise.all(done).then(() => {
      resName.textContent = animal.name;
      resLine.textContent = pick(animal.lines);
      void result.offsetWidth;
      result.classList.add('pop');
      spins += 1;
      try { localStorage.setItem('spins', spins); } catch { /* не страшно */ }
      showCount();
      const box = reels[1].el.getBoundingClientRect();
      say(animal.kind, box.left + box.width * 0.6, box.top + box.height * 0.2);
      spinBtn.disabled = false;
    });
  });

  /* ---------- альбом: вертикальная прокрутка двигает ленту вбок ---------- */

  const album = $('#album');
  const track = $('#track');
  const albumBar = $('#albumBar');
  const albumNum = $('#albumNum');
  const shots = $$('.shot', track);
  let albumRun = 0;
  let albumX = 0;

  // лента едет вбок, и ленивая загрузка не успевает за ней: грузим картинки заранее, на подходе к альбому
  const albumIO = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    $$('img', track).forEach(img => { img.loading = 'eager'; });
    albumIO.disconnect();
  }, { rootMargin: '120% 0px' });
  albumIO.observe(album);

  resizeJobs.push(() => {
    if (narrow.matches) {
      album.style.height = '';
      track.style.transform = '';
      return;
    }
    albumRun = Math.max(0, track.scrollWidth - innerWidth);
    album.style.height = `${albumRun + innerHeight}px`;
  });

  frameJobs.push(() => {
    if (narrow.matches || !albumRun) return;
    const top = album.offsetTop;
    if (scroll.y < top - innerHeight || scroll.y > top + albumRun + innerHeight) return;
    const p = clamp((scroll.y - top) / albumRun, 0, 1);
    albumX = calm ? p * albumRun : lerp(albumX, p * albumRun, ease(0.12));
    const skew = calm ? 0 : clamp(scroll.speed * -0.12, -4, 4);
    track.style.transform = `translate3d(${(-albumX).toFixed(1)}px, 0, 0) skewX(${skew.toFixed(2)}deg)`;
    albumBar.style.setProperty('--p', p.toFixed(4));

    let near = 0;
    let best = Infinity;
    shots.forEach((shot, i) => {
      const gap = Math.abs(shot.offsetLeft + shot.offsetWidth / 2 - albumX - innerWidth / 2);
      if (gap < best) { best = gap; near = i; }
    });
    const label = `${String(near + 1).padStart(2, '0')} / ${String(shots.length).padStart(2, '0')}`;
    if (albumNum.textContent !== label) albumNum.textContent = label;
  });

  /* ---------- следы лап за курсором ---------- */

  if (hasMouse && !calm) {
    const canvas = $('#trail');
    const ctx = canvas.getContext('2d');
    const prints = [];
    const LIFE = 1500;
    const STEP = 58;
    let last = null;
    let left = false;
    let ink = '#1c1a17';

    resizeJobs.push(() => {
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = innerWidth * ratio;
      canvas.height = innerHeight * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    });

    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      if (!last) { last = { x: e.clientX, y: e.clientY }; return; }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (Math.hypot(dx, dy) < STEP) return;
      const angle = Math.atan2(dy, dx);
      const side = (left = !left) ? -9 : 9;
      prints.push({
        x: e.clientX - Math.sin(angle) * side,
        y: e.clientY + Math.cos(angle) * side,
        angle: angle + Math.PI / 2,
        born: performance.now(),
      });
      if (prints.length > 40) prints.shift();
      last = { x: e.clientX, y: e.clientY };
    }, { passive: true });

    const toes = [[-7.4, -5.2, -0.5], [-2.7, -10, -0.15], [2.7, -10, 0.15], [7.4, -5.2, 0.5]];
    let wasEmpty = true;
    frameJobs.push(time => {
      if (!prints.length) {
        if (!wasEmpty) { ctx.clearRect(0, 0, innerWidth, innerHeight); wasEmpty = true; }
        return;
      }
      wasEmpty = false;
      ink = getComputedStyle(document.body).color; // цвет следов идёт за темой раздела
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.fillStyle = ink;
      for (let i = prints.length - 1; i >= 0; i--) {
        const p = prints[i];
        const age = (time - p.born) / LIFE;
        if (age >= 1) { prints.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = 0.2 * (1 - age) * Math.min(1, age * 14);
        ctx.beginPath();
        ctx.ellipse(0, 3.4, 6.6, 5.4, 0, 0, 6.2832);
        toes.forEach(([x, y, r]) => { ctx.moveTo(x + 2.6, y); ctx.ellipse(x, y, 2.5, 3.3, r, 0, 6.2832); });
        ctx.fill();
        ctx.restore();
      }
    });
  }

  /* ---------- список авторов фотографий ---------- */

  fetch('photos.json')
    .then(response => response.json())
    .then(photos => {
      const list = $('#credits');
      const seen = new Set();
      photos.forEach(photo => {
        if (seen.has(photo.page)) return;
        seen.add(photo.page);
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = photo.page;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = photo.name;
        li.append(link, `. ${photo.author}, ${photo.license}`);
        list.append(li);
      });
    })
    .catch(() => {});

  /* ---------- общий цикл ---------- */

  const onResize = () => resizeJobs.forEach(job => job());
  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(onResize, 120); });
  addEventListener('load', onResize);
  if (document.fonts) document.fonts.ready.then(onResize);
  onResize();

  let lastY = scrollY;
  let lastTime = 0;
  const loop = time => {
    scroll.step = clamp((time - lastTime) / 16.7, 0.5, 8);
    lastTime = time;
    scroll.y = scrollY;
    const delta = (scroll.y - lastY) / scroll.step;
    lastY = scroll.y;
    scroll.speed = lerp(scroll.speed, delta, ease(0.14));
    if (Math.abs(delta) > 0.5) scroll.dir = delta > 0 ? 1 : -1;
    frameJobs.forEach(job => job(time));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();

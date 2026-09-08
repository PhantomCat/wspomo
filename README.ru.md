<p align="center">
  <a href="README.md">English</a> · <b>Русский</b>
</p>

<h1 align="center">Workday Synced Pomodoro Timer</h1>

<p align="center">
  <b>aka <a href="https://wspomo.xyz">wspomo</a></b> — минималистичный помодоро-таймер, привязанный к вашему рабочему расписанию.<br>
  Node.js + vanilla frontend.
</p>

<p align="center">
  <a href="https://wspomo.xyz"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/wspomo.xyz-live-a6e3a1?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/wspomo.xyz-live-40a02b?style=flat-square">
    <img alt="wspomo.xyz — live" src="https://img.shields.io/badge/wspomo.xyz-live-a6e3a1?style=flat-square">
  </picture></a>
  <a href="LICENSE"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/license-GPL--3.0-89b4fa?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/license-GPL--3.0-1e66f5?style=flat-square">
    <img alt="Лицензия: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-89b4fa?style=flat-square">
  </picture></a>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/node-20-fab387?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/node-20-fe640b?style=flat-square">
    <img alt="Node.js 20" src="https://img.shields.io/badge/node-20-fab387?style=flat-square">
  </picture>
  <a href="https://catppuccin.com"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/theme-Catppuccin-cba6f7?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/theme-Catppuccin-8839ef?style=flat-square">
    <img alt="Тема: Catppuccin" src="https://img.shields.io/badge/theme-Catppuccin-cba6f7?style=flat-square">
  </picture></a>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/built_with-AI_assistance-f5c2e7?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/built_with-AI_assistance-ea76cb?style=flat-square">
    <img alt="Создано при участии ИИ" src="https://img.shields.io/badge/built_with-AI_assistance-f5c2e7?style=flat-square">
  </picture>
</p>

## Чем отличается

Большинство помодоро-таймеров просто отсчитывают время с момента нажатия «Старт». wspomo привязывает всю цепочку интервалов к вашему рабочему расписанию: он рассчитывает, в какой сессии вы *должны* быть прямо сейчас, — перерывы и фокус-блоки идут по реальным часам. Открыли в 10:15 при начале рабочего дня в 09:00 — таймер подхватит сессию с середины и покажет оставшееся время. Никаких «уплывающих» перерывов и рассинхрона.

## Возможности

- **Синхронизация с рабочим днём** — привязка цепочки помодоро к расписанию (начало, обед, конец)
- **Три режима:** Фокус, короткий перерыв, длинный перерыв
- **Настраиваемая длительность** каждого режима
- **Авто-переход** — интервалы переключаются автоматически (работа → короткий перерыв → работа → … → длинный перерыв)
- **Звуковые уведомления** с кнопкой проверки и отключением
- **Браузерные уведомления** с запросом разрешения
- **Два языка** — русский и английский, автоопределение по языку браузера
- **Сохранение настроек** в cookie браузера
- **Тёмная тема Catppuccin Mocha**

## Быстрый старт

**Онлайн:** [wspomo.xyz](https://wspomo.xyz) — установка не нужна.

**Свой сервер с Docker:**

```bash
docker compose up -d
```

Откройте `http://localhost:3000`

**Ручной запуск:**

```bash
npm install
npm start
```

## Настройки

Все настройки сохраняются в cookie браузера и сохраняются между сессиями.

> **Cookie и приватность:** wspomo ставит только перечисленные в [public/PRIVACY.md](public/PRIVACY.md) cookie — настройки, язык, тема и один анонимный случайный UUID (без логирования IP, без фингерпринтинга). Подробности — в [PRIVACY.md](public/PRIVACY.md).

| Настройка | По умолчанию | Описание |
|---|---|---|
| Длительность работы | 25 мин | Длина фокус-сессии |
| Короткий перерыв | 5 мин | Перерыв между рабочими сессиями |
| Длинный перерыв | 15 мин | Перерыв после завершения цикла |
| Сессий до длинного перерыва | 4 | Количество рабочих сессий в цикле |
| Синхрон с рабочим днём | Выкл | Привязка таймера к расписанию |
| Начало рабочего дня | 09:00 | Начало рабочего дня |
| Начало обеда | 13:00 | Начало обеденного перерыва |
| Конец обеда | 14:00 | Конец обеденного перерыва |
| Конец рабочего дня | 18:00 | Конец рабочего дня |
| Продолжать отсчёт после окончания рабочего дня | Выкл | Не останавливать таймер после конца дня |
| Звук | Вкл | Воспроизводить звуковые уведомления |
| Браузерные уведомления | Вкл | Показывать десктопные уведомления |
| Язык | Авто (браузер) | ru / en |

## Структура проекта

```
wspomo/
├── caddy/
│   └── Caddyfile
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── LICENSE
├── package.json
├── server.js
└── public/
    ├── favicon.svg
    ├── index.html
    └── style.css
```

## Стек технологий

- **Бэкенд:** Express.js, cookie-parser
- **Фронтенд:** Vanilla HTML/CSS/JS, Web Audio API
- **Тема:** Catppuccin Mocha
- **Рантайм:** Node.js 20 Alpine

## Лицензия

Copyright (C) 2026 Serge Mymrikov (PhantomCat)

wspomo — свободное ПО под лицензией [GNU GPL v3.0](LICENSE) или (по вашему выбору) любой более поздней версии. Проект можно свободно использовать, изменять и распространять — форки и производные работы обязаны оставаться под GPL-3.0, открывать исходный код и сохранять уведомление об авторских правах. Полный текст — в файле [LICENSE](LICENSE).

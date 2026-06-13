const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/settings', (req, res) => {
  const settings = req.cookies.pomodoro_settings;
  if (settings) {
    try {
      res.json(JSON.parse(decodeURIComponent(settings)));
    } catch {
      res.json(getDefaultSettings());
    }
  } else {
    res.json(getDefaultSettings());
  }
});

app.post('/api/settings', (req, res) => {
  const settings = req.body;
  res.cookie('pomodoro_settings', encodeURIComponent(JSON.stringify(settings)), {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    sameSite: 'lax'
  });
  res.json({ ok: true });
});

function getDefaultSettings() {
  return {
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    sessionsBeforeLongBreak: 4,
    workdaySync: false,
    workdayStart: '09:00',
    lunchStart: '13:00',
    lunchEnd: '14:00',
    workdayEnd: '18:00'
  };
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pomodoro timer running on http://0.0.0.0:${PORT}`);
});

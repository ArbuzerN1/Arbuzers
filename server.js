const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== БАЗА ДАННЫХ =====
const db = new sqlite3.Database('./database.db');

// Создаём таблицы
db.serialize(() => {
    // Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        money INTEGER DEFAULT 0,
        click_per_click INTEGER DEFAULT 1,
        auto_clicker INTEGER DEFAULT 0,
        skin TEXT DEFAULT 'арбуз',
        banned INTEGER DEFAULT 0,
        admin INTEGER DEFAULT 0,
        comments_allowed INTEGER DEFAULT 1
    )`);

    // Голоса
    db.run(`CREATE TABLE IF NOT EXISTS poll (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT UNIQUE,
        vote TEXT
    )`);

    // Комментарии
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT,
        text TEXT,
        time INTEGER
    )`);

    // Секретный опрос
    db.run(`CREATE TABLE IF NOT EXISTS secret_poll (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT UNIQUE,
        vote TEXT
    )`);
});

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(__dirname));

// ===== API =====

// Получить голоса
app.get('/api/poll', (req, res) => {
    db.all('SELECT vote, COUNT(*) as count FROM poll GROUP BY vote', (err, rows) => {
        if (err) return res.json({ error: err.message });
        const result = { yes: 0, no: 0 };
        rows.forEach(row => {
            if (row.vote === 'yes') result.yes = row.count;
            if (row.vote === 'no') result.no = row.count;
        });
        res.json(result);
    });
});

// Сохранить голос
app.post('/api/poll', (req, res) => {
    const { user, vote } = req.body;
    if (!user || !vote) return res.json({ error: 'Недостаточно данных' });

    db.run('INSERT OR REPLACE INTO poll (user, vote) VALUES (?, ?)', [user, vote], (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});

// Получить комментарии
app.get('/api/comments', (req, res) => {
    db.all('SELECT * FROM comments ORDER BY time DESC LIMIT 100', (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows || []);
    });
});

// Добавить комментарий
app.post('/api/comments', (req, res) => {
    const { user, text } = req.body;
    if (!user || !text) return res.json({ error: 'Недостаточно данных' });

    db.run('INSERT INTO comments (user, text, time) VALUES (?, ?, ?)', [user, text, Date.now()], (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});

// Получить лидерборд
app.get('/api/leaderboard', (req, res) => {
    db.all('SELECT name, money FROM users ORDER BY money DESC LIMIT 10', (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows || []);
    });
});

// Получить профиль пользователя
app.get('/api/user/:name', (req, res) => {
    const name = req.params.name;
    db.get('SELECT * FROM users WHERE name = ?', [name], (err, row) => {
        if (err) return res.json({ error: err.message });
        if (!row) {
            // Создаём нового пользователя
            db.run('INSERT INTO users (name, money) VALUES (?, 0)', [name], function(err) {
                if (err) return res.json({ error: err.message });
                db.get('SELECT * FROM users WHERE name = ?', [name], (err, newRow) => {
                    res.json(newRow || { name, money: 0 });
                });
            });
        } else {
            res.json(row);
        }
    });
});

// Обновить профиль
app.post('/api/user/update', (req, res) => {
    const { name, money, click_per_click, auto_clicker, skin } = req.body;
    if (!name) return res.json({ error: 'Нет имени' });

    let query = 'UPDATE users SET ';
    const params = [];
    const updates = [];

    if (money !== undefined) { updates.push('money = ?');
        params.push(money); }
    if (click_per_click !== undefined) { updates.push('click_per_click = ?');
        params.push(click_per_click); }
    if (auto_clicker !== undefined) { updates.push('auto_clicker = ?');
        params.push(auto_clicker); }
    if (skin !== undefined) { updates.push('skin = ?');
        params.push(skin); }

    if (updates.length === 0) return res.json({ error: 'Нет данных для обновления' });

    query += updates.join(', ') + ' WHERE name = ?';
    params.push(name);

    db.run(query, params, (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});

// Секретный опрос
app.get('/api/secret-poll/:user', (req, res) => {
    const user = req.params.user;
    db.get('SELECT vote FROM secret_poll WHERE user = ?', [user], (err, row) => {
        if (err) return res.json({ error: err.message });
        res.json({ vote: row ? row.vote : null });
    });
});

app.post('/api/secret-poll', (req, res) => {
    const { user, vote } = req.body;
    if (!user || !vote) return res.json({ error: 'Недостаточно данных' });

    db.run('INSERT OR REPLACE INTO secret_poll (user, vote) VALUES (?, ?)', [user, vote], (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});

// ===== ГЛАВНАЯ СТРАНИЦА =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== ЗАПУСК =====
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});

// ===== WEBSOCKET ДЛЯ РЕАЛЬНОГО ВРЕМЕНИ =====
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('🔗 Новое подключение');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Отправляем всем клиентам
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.log('Ошибка парсинга:', e);
        }
    });

    ws.on('close', () => console.log('🔌 Отключен'));
});

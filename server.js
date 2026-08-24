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
        password TEXT,
        money INTEGER DEFAULT 0,
        click_per_click INTEGER DEFAULT 1,
        auto_clicker INTEGER DEFAULT 0,
        skin TEXT DEFAULT 'арбуз',
        banned INTEGER DEFAULT 0,
        admin INTEGER DEFAULT 0,
        comments_allowed INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )`);

    // Голоса в опросе
    db.run(`CREATE TABLE IF NOT EXISTS poll (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT UNIQUE,
        vote TEXT
    )`);

    // Комментарии/чат
    db.run(`CREATE TABLE IF NOT EXISTS messages (
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

    // Новости
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        time INTEGER
    )`);

    // Скины пользователей
    db.run(`CREATE TABLE IF NOT EXISTS user_skins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT,
        skin TEXT,
        UNIQUE(user, skin)
    )`);

    console.log('✅ База данных инициализирована');
});

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(__dirname));

// ===== API =====

// --- Регистрация/Авторизация ---
app.post('/api/auth', (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) return res.json({ error: 'Введите имя и пароль' });

    // Проверяем, есть ли пользователь
    db.get('SELECT * FROM users WHERE name = ?', [name], (err, user) => {
        if (err) return res.json({ error: err.message });

        if (user) {
            // Проверяем пароль
            if (user.password === password) {
                res.json({ success: true, user });
            } else {
                res.json({ error: 'Неверный пароль' });
            }
        } else {
            // Создаём нового пользователя
            db.run('INSERT INTO users (name, password) VALUES (?, ?)', [name, password], function(err) {
                if (err) return res.json({ error: 'Имя уже занято' });
                db.get('SELECT * FROM users WHERE name = ?', [name], (err, newUser) => {
                    res.json({ success: true, user: newUser });
                });
            });
        }
    });
});

// --- Получить пользователя ---
app.get('/api/user/:name', (req, res) => {
    const name = req.params.name;
    db.get('SELECT * FROM users WHERE name = ?', [name], (err, user) => {
        if (err) return res.json({ error: err.message });
        if (!user) return res.json({ error: 'Пользователь не найден' });
        res.json(user);
    });
});

// --- Обновить пользователя ---
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

// --- Купить скин ---
app.post('/api/buy-skin', (req, res) => {
    const { user, skin, price } = req.body;
    if (!user || !skin) return res.json({ error: 'Недостаточно данных' });

    // Проверяем, есть ли уже такой скин
    db.get('SELECT * FROM user_skins WHERE user = ? AND skin = ?', [user, skin], (err, existing) => {
        if (err) return res.json({ error: err.message });
        if (existing) return res.json({ error: 'Скин уже куплен' });

        // Проверяем деньги
        db.get('SELECT money FROM users WHERE name = ?', [user], (err, userData) => {
            if (err) return res.json({ error: err.message });
            if (!userData) return res.json({ error: 'Пользователь не найден' });

            if (userData.money < price) {
                return res.json({ error: 'Недостаточно денег' });
            }

            // Покупаем скин
            db.run('INSERT INTO user_skins (user, skin) VALUES (?, ?)', [user, skin], (err) => {
                if (err) return res.json({ error: err.message });

                // Списываем деньги
                const newMoney = userData.money - price;
                db.run('UPDATE users SET money = ? WHERE name = ?', [newMoney, user], (err) => {
                    if (err) return res.json({ error: err.message });
                    res.json({ success: true, newMoney });
                });
            });
        });
    });
});

// --- Получить скины пользователя ---
app.get('/api/skins/:user', (req, res) => {
    const user = req.params.user;
    db.all('SELECT skin FROM user_skins WHERE user = ?', [user], (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows.map(r => r.skin));
    });
});

// --- Выбрать скин ---
app.post('/api/select-skin', (req, res) => {
    const { user, skin } = req.body;
    if (!user || !skin) return res.json({ error: 'Недостаточно данных' });

    // Проверяем, есть ли такой скин у пользователя
    db.get('SELECT * FROM user_skins WHERE user = ? AND skin = ?', [user, skin], (err, existing) => {
        if (err) return res.json({ error: err.message });
        if (!existing) return res.json({ error: 'Скин не куплен' });

        db.run('UPDATE users SET skin = ? WHERE name = ?', [skin, user], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// --- Голосование ---
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

app.post('/api/poll', (req, res) => {
    const { user, vote } = req.body;
    if (!user || !vote) return res.json({ error: 'Недостаточно данных' });

    db.run('INSERT OR REPLACE INTO poll (user, vote) VALUES (?, ?)', [user, vote], (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});

// --- Комментарии/чат ---
app.get('/api/messages', (req, res) => {
    db.all('SELECT * FROM messages ORDER BY time DESC LIMIT 100', (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/messages', (req, res) => {
    const { user, text } = req.body;
    if (!user || !text) return res.json({ error: 'Недостаточно данных' });

    // Проверяем, не забанен ли
    db.get('SELECT banned FROM users WHERE name = ?', [user], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (userData && userData.banned === 1) {
            return res.json({ error: 'Вы забанены' });
        }

        db.run('INSERT INTO messages (user, text, time) VALUES (?, ?, ?)', [user, text, Date.now()], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// --- Лидерборд ---
app.get('/api/leaderboard', (req, res) => {
    db.all('SELECT name, money FROM users WHERE banned = 0 ORDER BY money DESC LIMIT 10', (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows || []);
    });
});

// --- Все пользователи (для админа) ---
app.get('/api/users', (req, res) => {
    db.all('SELECT id, name, money, admin, banned, comments_allowed FROM users ORDER BY money DESC', (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows || []);
    });
});

// --- Секретный опрос ---
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

// --- Новости ---
app.get('/api/news', (req, res) => {
    db.all('SELECT * FROM news ORDER BY time DESC', (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/news', (req, res) => {
    const { title, content, user } = req.body;
    if (!title || !content) return res.json({ error: 'Недостаточно данных' });

    // Проверяем админа
    db.get('SELECT admin FROM users WHERE name = ?', [user], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (!userData || userData.admin !== 1) {
            return res.json({ error: 'Нет прав' });
        }

        db.run('INSERT INTO news (title, content, time) VALUES (?, ?, ?)', [title, content, Date.now()], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// --- АДМИН-КОМАНДЫ ---

// Выдать деньги
app.post('/api/admin/money', (req, res) => {
    const { admin, target, amount } = req.body;
    if (!admin || !target || !amount) return res.json({ error: 'Недостаточно данных' });

    db.get('SELECT admin FROM users WHERE name = ?', [admin], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (!userData || userData.admin !== 1) return res.json({ error: 'Нет прав' });

        db.run('UPDATE users SET money = money + ? WHERE name = ?', [amount, target], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Забанить
app.post('/api/admin/ban', (req, res) => {
    const { admin, target } = req.body;
    if (!admin || !target) return res.json({ error: 'Недостаточно данных' });

    db.get('SELECT admin FROM users WHERE name = ?', [admin], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (!userData || userData.admin !== 1) return res.json({ error: 'Нет прав' });
        if (target === admin) return res.json({ error: 'Нельзя забанить себя' });

        db.run('UPDATE users SET banned = 1 WHERE name = ?', [target], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Разбанить
app.post('/api/admin/unban', (req, res) => {
    const { admin, target } = req.body;
    if (!admin || !target) return res.json({ error: 'Недостаточно данных' });

    db.get('SELECT admin FROM users WHERE name = ?', [admin], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (!userData || userData.admin !== 1) return res.json({ error: 'Нет прав' });

        db.run('UPDATE users SET banned = 0 WHERE name = ?', [target], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Дать админа
app.post('/api/admin/give-admin', (req, res) => {
    const { admin, target } = req.body;
    if (!admin || !target) return res.json({ error: 'Недостаточно данных' });

    db.get('SELECT admin FROM users WHERE name = ?', [admin], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (!userData || userData.admin !== 1) return res.json({ error: 'Нет прав' });

        db.run('UPDATE users SET admin = 1 WHERE name = ?', [target], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Снять админа
app.post('/api/admin/remove-admin', (req, res) => {
    const { admin, target } = req.body;
    if (!admin || !target) return res.json({ error: 'Недостаточно данных' });

    db.get('SELECT admin FROM users WHERE name = ?', [admin], (err, userData) => {
        if (err) return res.json({ error: err.message });
        if (!userData || userData.admin !== 1) return res.json({ error: 'Нет прав' });
        if (target === admin) return res.json({ error: 'Нельзя снять админку с себя' });

        db.run('UPDATE users SET admin = 0 WHERE name = ?', [target], (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        });
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

// ===== WEBSOCKET =====
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`🔗 Подключен (${clients.size} онлайн)`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Отправляем всем клиентам
            clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.log('Ошибка парсинга:', e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`🔌 Отключен (${clients.size} онлайн)`);
    });
});

console.log(`📡 WebSocket запущен`);

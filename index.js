const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const trading = require('./trading');
require('dotenv').config();
const WebSocket = require('ws');
global.WebSocket = WebSocket;
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть указаны в .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Подключение к Supabase установлено");

// ============================================
//  МАРШРУТЫ API
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SMT Bot API работает!' });
});

app.get('/api/test-price/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const price = await trading.getPrice(symbol);
    if (price !== null) {
        res.json({ symbol, price });
    } else {
        res.status(500).json({ error: 'Не удалось получить цену' });
    }
});

app.post('/api/register', async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }

    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (existingUser) {
            return res.status(400).json({ error: 'Этот email уже зарегистрирован' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email,
                password: hashedPassword,
                telegram_username: username || null,
                auth_provider: 'email'
            })
            .select()
            .single();

        if (createError) {
            console.error('Ошибка создания:', createError);
            return res.status(500).json({ error: 'Ошибка создания пользователя' });
        }

        delete newUser.password;
        res.status(201).json({ user: newUser });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error || !user) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/user/:email', async (req, res) => {
    const { email } = req.params;

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            console.error('Ошибка получения:', error);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.put('/api/user/:email/settings', async (req, res) => {
    const { email } = req.params;
    const { settings } = req.body;

    if (!settings) {
        return res.status(400).json({ error: 'Settings обязателен' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ settings, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления:', error);
            return res.status(500).json({ error: 'Ошибка обновления настроек' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Ошибка получения пользователей:', error);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        const safeUsers = users.map(u => {
            delete u.password;
            return u;
        });

        res.json({ users: safeUsers });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.put('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active должен быть boolean' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ is_active, updated_at: new Date() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления:', error);
            return res.status(500).json({ error: 'Ошибка обновления статуса' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  ЧАТ-ЛОГИ (ПАМЯТЬ)
// ============================================

app.post('/api/chat/save', async (req, res) => {
    const { role, content, session_id } = req.body;
    if (!role || !content) {
        return res.status(400).json({ error: 'role и content обязательны' });
    }

    try {
        const { data, error } = await supabase
            .from('chat_logs')
            .insert({ role, content, session_id: session_id || 'default' })
            .select();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error('❌ Ошибка сохранения чата:', err);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.get('/api/chat/history', async (req, res) => {
    const { session_id, limit = 50 } = req.query;

    try {
        const query = supabase
            .from('chat_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (session_id) {
            query.eq('session_id', session_id);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json({ history: data.reverse() });
    } catch (err) {
        console.error('❌ Ошибка получения истории:', err);
        res.status(500).json({ error: 'Ошибка получения истории' });
    }
});

app.get('/api/chat/export', async (req, res) => {
    const { limit = 20 } = req.query;
    try {
        const { data, error } = await supabase
            .from('chat_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));
        if (error) throw error;
        res.json({
            status: 'ok',
            count: data.length,
            history: data.reverse()
        });
    } catch (err) {
        console.error('❌ Ошибка экспорта чата:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ПЛАНИРОВЩИК ТОРГОВОГО БОТА
// ============================================

const SYMBOLS = ['BONK-USDT', 'DOGS-USDT', 'PEPE-USDT', 'SOL-USDT', 'XRP-USDT'];
const priceHistory = {};

cron.schedule('*/1 * * * *', async () => {
    console.log('🔄 Запуск анализа рынка...');

    try {
        const prices = await trading.getPrices(SYMBOLS);
        console.log('📊 Получены цены:', prices);

        for (const symbol of SYMBOLS) {
            if (prices[symbol] !== undefined) {
                if (!priceHistory[symbol]) priceHistory[symbol] = [];
                priceHistory[symbol].push(prices[symbol]);
                if (priceHistory[symbol].length > 30) {
                    priceHistory[symbol].shift();
                }
            }
        }

        for (const symbol of SYMBOLS) {
            if (priceHistory[symbol] && priceHistory[symbol].length >= 5) {
                const signal = trading.generateSignal(symbol, priceHistory[symbol]);
                if (signal) {
                    console.log(`📈 СИГНАЛ: ${signal.symbol} ${signal.side} (${signal.confidence})`);

                    try {
                        const { data: users, error: userError } = await supabase
                            .from('users')
                            .select('id')
                            .limit(1);

                        if (!userError && users && users.length > 0) {
                            const userId = users[0].id;
                            const { error: insertError } = await supabase
                                .from('signals')
                                .insert({
                                    user_id: userId,
                                    symbol: signal.symbol,
                                    side: signal.side,
                                    entry_price: signal.entry,
                                    confidence: signal.confidence,
                                    rsi: signal.rsi,
                                    macd: signal.macd,
                                    reasons: signal.reasons,
                                });

                            if (insertError) {
                                console.error('❌ Ошибка сохранения сигнала:', insertError);
                            } else {
                                console.log(`✅ Сигнал сохранён в БД для пользователя ${userId}`);
                            }
                        } else {
                            console.warn('⚠️ Нет пользователей для сохранения сигнала');
                        }
                    } catch (dbError) {
                        console.error('❌ Ошибка БД:', dbError.message);
                    }
                }
            }
        }

    } catch (error) {
        console.error('❌ Ошибка анализа рынка:', error.message);
    }
}, {
    timezone: "Europe/Moscow"
});

console.log('⏰ Планировщик запущен (каждую минуту)');

// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================

app.listen(port, () => {
    console.log(`🚀 SMT Bot запущен на порту ${port}`);
    console.log(`🌐 Открой: http://localhost:${port}/`);
    console.log(`📡 API: http://localhost:${port}/api/health`);
});
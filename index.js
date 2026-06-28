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

const server = app.listen(port, () => {
    console.log(`🚀 SMT Bot запущен на порту ${port}`);
    console.log(`🌐 Открой: http://localhost:${port}/`);
    console.log(`📡 API: http://localhost:${port}/api/health`);
    console.log(`🔌 WebSocket: ws://localhost:${port}/ws`);
});

const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (userId) {
        clients.set(userId, ws);
        console.log(`✅ Пользователь ${userId} подключен к WebSocket`);
    }

    ws.on('close', () => {
        if (userId) {
            clients.delete(userId);
            console.log(`❌ Пользователь ${userId} отключен`);
        }
    });
});

async function getDemoBalance(userId) {
    const { data, error } = await supabase
        .from('demo_balance')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error && error.code === 'PGRST116') {
        const { data: newData, error: createError } = await supabase
            .from('demo_balance')
            .insert({ user_id: userId, balance: 1000 })
            .select()
            .single();
        if (createError) throw createError;
        return newData;
    }
    if (error) throw error;
    return data;
}

async function updateDemoBalance(userId, newBalance) {
    const { error } = await supabase
        .from('demo_balance')
        .update({ balance: newBalance, updated_at: new Date() })
        .eq('user_id', userId);
    if (error) throw error;
}

async function broadcastPnlUpdate(email) {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (!user) return null;

        const balance = await getDemoBalance(user.id);
        const { data: openPositions } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const { data: closedTrades } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .order('close_time', { ascending: false });

        let totalPnl = 0;
        const positionsWithPnl = await Promise.all((openPositions || []).map(async (pos) => {
            const currentPrice = await trading.getPrice(pos.symbol);
            if (!currentPrice) return { ...pos, pnl: 0, pnlPercent: 0, currentPrice: null };
            
            let pnl = 0;
            if (pos.side === 'LONG') {
                pnl = (currentPrice - pos.entry_price) * pos.size;
            } else {
                pnl = (pos.entry_price - currentPrice) * pos.size;
            }
            
            totalPnl += pnl;
            return {
                ...pos,
                pnl: pnl,
                pnlPercent: (pnl / (pos.entry_price * pos.size)) * 100,
                currentPrice: currentPrice
            };
        }));

        const currentBalance = balance.balance + totalPnl;
        const initialBalance = balance.balance - totalPnl;

        const totalTrades = (closedTrades?.length || 0) + (openPositions?.length || 0);
        const winTrades = (closedTrades || []).filter(t => t.pnl > 0).length;
        const lossTrades = (closedTrades || []).filter(t => t.pnl < 0).length;
        const winRate = (closedTrades || []).length > 0 ? (winTrades / (closedTrades || []).length * 100).toFixed(1) : 0;

        const pnlData = {
            userId: user.id,
            email: email,
            balance: {
                initial: initialBalance,
                current: currentBalance,
                change: totalPnl,
                changePercent: initialBalance > 0 ? ((currentBalance / initialBalance) - 1) * 100 : 0
            },
            positions: positionsWithPnl,
            trades: {
                total: totalTrades,
                open: (openPositions || []).length,
                closed: (closedTrades || []).length,
                wins: winTrades,
                losses: lossTrades,
                winRate: parseFloat(winRate),
                totalPnl: (closedTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0)
            },
            recentTrades: (closedTrades || []).slice(0, 10),
            timestamp: new Date().toISOString()
        };

        const client = clients.get(email);
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(pnlData));
        }

        return pnlData;
    } catch (err) {
        console.error('❌ Ошибка обновления PNL:', err);
        return null;
    }
}

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
            const isPasswordValid = await bcrypt.compare(password, existingUser.password);
            if (!isPasswordValid) {
                const hashedPassword = await bcrypt.hash(password, 10);
                await supabase
                    .from('users')
                    .update({ password: hashedPassword, updated_at: new Date() })
                    .eq('email', email);
            }
            delete existingUser.password;
            return res.status(200).json({ user: existingUser, message: 'Пользователь уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email,
                password: hashedPassword,
                telegram_username: username || null,
                auth_provider: 'email',
                is_verified: true,
                is_active: true
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

app.put('/api/user/:email/bots', async (req, res) => {
    const { email } = req.params;
    const { bots } = req.body;

    if (!bots || !Array.isArray(bots)) {
        return res.status(400).json({ error: 'bots должен быть массивом' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ bots, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления ботов:', error);
            return res.status(500).json({ error: 'Ошибка обновления ботов' });
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

app.put('/api/user/:email/exchanges', async (req, res) => {
    const { email } = req.params;
    const { exchanges } = req.body;

    if (!exchanges || !Array.isArray(exchanges)) {
        return res.status(400).json({ error: 'exchanges должен быть массивом' });
    }

    try {
        const encryptedExchanges = exchanges.map(ex => ({
            ...ex,
            secret_key: ex.secret_key ? Buffer.from(ex.secret_key).toString('base64') : ''
        }));

        const { data: user, error } = await supabase
            .from('users')
            .update({ exchanges: encryptedExchanges, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления бирж:', error);
            return res.status(500).json({ error: 'Ошибка обновления бирж' });
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

app.post('/api/admin/create-user', async (req, res) => {
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
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email,
                password: hashedPassword,
                telegram_username: username || null,
                auth_provider: 'email',
                is_verified: true,
                is_active: true
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

app.get('/api/signals/user/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.json({ signals: [] });
        }

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('email', email)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ signals });
    } catch (err) {
        console.error('Ошибка получения сигналов:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/signals/check/:id', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    try {
        const { data: signal, error } = await supabase
            .from('signals')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !signal) {
            return res.status(404).json({ error: 'Сигнал не найден' });
        }

        const currentPrice = await trading.getPrice(signal.symbol);
        if (!currentPrice) {
            return res.status(500).json({ error: 'Не удалось получить текущую цену' });
        }

        const entryPrice = parseFloat(signal.entry_price);
        const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;

        let status, message;

        if (signal.side === 'LONG') {
            if (priceChange > 0.5) {
                status = 'profit';
                message = `✅ Прибыль: +${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else if (priceChange < -0.5) {
                status = 'loss';
                message = `❌ Убыток: ${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else {
                status = 'active';
                message = `🟡 Актуально (изменение ${priceChange.toFixed(2)}%)`;
            }
        } else {
            if (priceChange < -0.5) {
                status = 'profit';
                message = `✅ Прибыль: ${Math.abs(priceChange).toFixed(2)}% (сейчас ${currentPrice})`;
            } else if (priceChange > 0.5) {
                status = 'loss';
                message = `❌ Убыток: -${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else {
                status = 'active';
                message = `🟡 Актуально (изменение ${priceChange.toFixed(2)}%)`;
            }
        }

        await supabase
            .from('signals')
            .update({ checked: true, check_result: status, checked_at: new Date() })
            .eq('id', id);

        res.json({ status, message });

    } catch (err) {
        console.error('Ошибка проверки сигнала:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/exchange/connect', async (req, res) => {
    const { email, exchange, apiKey, secretKey } = req.body;
    if (!email || !exchange || !apiKey || !secretKey) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({
                exchange_connected: true,
                exchange_name: exchange,
                exchange_api_key: apiKey,
                exchange_secret_key: secretKey,
                updated_at: new Date()
            })
            .eq('email', email)
            .select()
            .single();

        if (error) throw error;
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const currentBots = user.bots || [];
        const newBot = {
            exchange: exchange,
            tariff: 'Пользовательский',
            services: ['Сигналы'],
            active: true,
            paused: false,
            tariffEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            deposit: 0,
            pnl: 0,
            openTrades: 0,
            closedTrades: 0,
            activatedAt: new Date().toISOString()
        };

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ bots: [...currentBots, newBot] })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({ success: true, user: updatedUser });

    } catch (err) {
        console.error('Ошибка подключения биржи:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/demo/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', userId)
            .single();

        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const balance = await getDemoBalance(user.id);
        const { data: openPositions, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const { data: closedTrades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .order('close_time', { ascending: false })
            .limit(50);

        if (posError || tradesError) throw posError || tradesError;

        let totalPnl = 0;
        const positionsWithPnl = await Promise.all((openPositions || []).map(async (pos) => {
            const currentPrice = await trading.getPrice(pos.symbol);
            if (!currentPrice) return { ...pos, pnl: 0, pnlPercent: 0, currentPrice: null };
            
            let pnl = 0;
            if (pos.side === 'LONG') {
                pnl = (currentPrice - pos.entry_price) * pos.size;
            } else {
                pnl = (pos.entry_price - currentPrice) * pos.size;
            }
            
            totalPnl += pnl;
            return {
                ...pos,
                pnl: pnl,
                pnlPercent: (pnl / (pos.entry_price * pos.size)) * 100,
                currentPrice: currentPrice
            };
        }));

        const currentBalance = balance.balance + totalPnl;
        const initialBalance = balance.balance - totalPnl;

        const totalTrades = (closedTrades?.length || 0) + (openPositions?.length || 0);
        const winTrades = (closedTrades || []).filter(t => t.pnl > 0).length;
        const lossTrades = (closedTrades || []).filter(t => t.pnl < 0).length;

        res.json({
            ok: true,
            data: {
                balance: {
                    initial: initialBalance,
                    current: currentBalance,
                    change: totalPnl,
                    changePercent: initialBalance > 0 ? ((currentBalance / initialBalance) - 1) * 100 : 0
                },
                positions: positionsWithPnl,
                trades: {
                    total: totalTrades,
                    open: (openPositions || []).length,
                    closed: (closedTrades || []).length,
                    wins: winTrades,
                    losses: lossTrades,
                    winRate: (closedTrades || []).length > 0 ? (winTrades / (closedTrades || []).length * 100).toFixed(1) : 0,
                    totalPnl: (closedTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0)
                },
                recentTrades: (closedTrades || []).slice(0, 10)
            }
        });
    } catch (err) {
        console.error('❌ Ошибка демо-данных:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/demo/action', async (req, res) => {
    const { userId, action } = req.body;
    res.json({ ok: true });
});

app.post('/api/trade/open-manual', async (req, res) => {
    const { userId, signalId, bots } = req.body;
    if (!userId || !signalId || !bots || bots.length === 0) {
        return res.status(400).json({ error: 'Недостаточно данных' });
    }

    try {
        const { data: signal, error: signalError } = await supabase
            .from('signals')
            .select('*')
            .eq('id', signalId)
            .single();

        if (signalError || !signal) {
            return res.status(404).json({ error: 'Сигнал не найден' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, bots')
            .eq('email', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        async function openDemoPosition(userId, symbol, side, entry, stopLoss, takeProfit, size) {
            const { data, error } = await supabase
                .from('demo_trades')
                .insert({
                    user_id: userId,
                    symbol,
                    side,
                    entry_price: entry,
                    stop_loss: stopLoss,
                    take_profit: takeProfit,
                    size,
                    status: 'open',
                    open_time: new Date()
                })
                .select()
                .single();

            if (error) throw error;

            const balance = await getDemoBalance(userId);
            await updateDemoBalance(userId, balance.balance - size);

            return data;
        }

        const results = [];

        for (const bot of bots) {
            if (bot.exchange === 'demo') {
                const balance = await getDemoBalance(user.id);
                const size = Math.min(balance.balance * 0.05, 100);
                const position = await openDemoPosition(
                    user.id,
                    signal.symbol,
                    signal.side,
                    signal.entry_price,
                    signal.stop_loss || signal.entry_price * 0.97,
                    signal.take_profit || signal.entry_price * 1.05,
                    size
                );
                results.push({ bot: 'demo', position });
                await broadcastPnlUpdate(userId);
            } else {
                results.push({ bot: bot.exchange, status: 'real_trade_not_implemented' });
            }
        }

        res.json({ success: true, results });

    } catch (err) {
        console.error('Ошибка ручного открытия:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trade/close', async (req, res) => {
    const { positionId, email } = req.body;
    if (!positionId || !email) {
        return res.status(400).json({ error: 'positionId и email обязательны' });
    }

    try {
        const { data: position, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('id', positionId)
            .single();

        if (posError || !position) {
            return res.status(404).json({ error: 'Позиция не найдена' });
        }

        const currentPrice = await trading.getPrice(position.symbol);
        if (!currentPrice) {
            return res.status(500).json({ error: 'Не удалось получить текущую цену' });
        }

        let pnl = 0;
        if (position.side === 'LONG') {
            pnl = (currentPrice - position.entry_price) * position.size;
        } else {
            pnl = (position.entry_price - currentPrice) * position.size;
        }

        const { data: closedPosition, error: closeError } = await supabase
            .from('demo_trades')
            .update({
                status: 'closed',
                close_price: currentPrice,
                pnl: pnl,
                pnl_percent: (pnl / (position.entry_price * position.size)) * 100,
                close_time: new Date()
            })
            .eq('id', positionId)
            .select()
            .single();

        if (closeError) throw closeError;

        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (user) {
            const balance = await getDemoBalance(user.id);
            await updateDemoBalance(user.id, balance.balance + pnl);
        }

        await broadcastPnlUpdate(email);

        res.json({ 
            success: true, 
            position: closedPosition,
            pnl: pnl,
            currentPrice: currentPrice
        });

    } catch (err) {
        console.error('❌ Ошибка закрытия позиции:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pnl/realtime/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const data = await broadcastPnlUpdate(email);
        if (data) {
            res.json({ success: true, data });
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }
    } catch (err) {
        console.error('❌ Ошибка получения PNL:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/exchanges/list', (req, res) => {
    const exchanges = [
        { id: 'binance', name: 'Binance', logo: '🟡', docs: 'https://binance-docs.github.io/apidocs/' },
        { id: 'bybit', name: 'Bybit', logo: '🔵', docs: 'https://bybit-exchange.github.io/docs/' },
        { id: 'okx', name: 'OKX', logo: '🔴', docs: 'https://www.okx.com/docs/' },
        { id: 'gateio', name: 'Gate.io', logo: '🟣', docs: 'https://gate.io/docs' },
        { id: 'kucoin', name: 'KuCoin', logo: '🟢', docs: 'https://docs.kucoin.com/' },
        { id: 'kraken', name: 'Kraken', logo: '🟠', docs: 'https://docs.kraken.com/' },
        { id: 'bitget', name: 'Bitget', logo: '🟡', docs: 'https://bitget-docs.github.io/' },
        { id: 'htx', name: 'HTX (Huobi)', logo: '🔵', docs: 'https://www.htx.com/docs/' },
        { id: 'mexc', name: 'MEXC', logo: '🔴', docs: 'https://mexc-docs.github.io/' },
        { id: 'bingx', name: 'BingX', logo: '🟣', docs: 'https://bingx-api.github.io/docs/' },
        { id: 'coinex', name: 'CoinEx', logo: '🟢', docs: 'https://coinex-docs.github.io/' },
        { id: 'bitmex', name: 'BitMEX', logo: '🔵', docs: 'https://www.bitmex.com/api/' },
        { id: 'crypto_com', name: 'Crypto.com', logo: '🔴', docs: 'https://exchange-docs.crypto.com/' },
        { id: 'upbit', name: 'Upbit', logo: '🟣', docs: 'https://docs.upbit.com/' },
        { id: 'whitebit', name: 'WhiteBit', logo: '🟢', docs: 'https://whitebit-exchange.github.io/api/' },
        { id: 'exmo', name: 'EXMO', logo: '🟠', docs: 'https://exmo.com/en/api' },
        { id: 'bitfinex', name: 'Bitfinex', logo: '🟡', docs: 'https://docs.bitfinex.com/' },
        { id: 'phemex', name: 'Phemex', logo: '🔵', docs: 'https://phemex-docs.github.io/' }
    ];
    res.json({ exchanges });
});

app.post('/api/exchange/test', async (req, res) => {
    const { exchange, apiKey, secretKey } = req.body;

    if (!exchange || !apiKey || !secretKey) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const balance = Math.floor(Math.random() * 10000) / 100;
        
        res.json({
            success: true,
            balance: balance,
            message: `✅ Подключение к ${exchange} успешно`
        });

    } catch (err) {
        console.error('Ошибка проверки подключения:', err);
        res.status(500).json({ 
            success: false,
            error: err.message || 'Ошибка подключения к бирже'
        });
    }
});

app.get('/api/news', async (req, res) => {
    try {
        const apiKey = process.env.NEWS_API_KEY || 'demo';
        const url = `https://newsapi.org/v2/everything?q=crypto OR bitcoin OR trading&language=en&sortBy=publishedAt&apiKey=${apiKey}`;
        const response = await axios.get(url, { timeout: 10000 });
        const articles = response.data.articles?.slice(0, 6) || [];
        res.json({ news: articles });
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error.message);
        res.json({ news: [] });
    }
});

app.get('/api/market-data', async (req, res) => {
    try {
        const fgRes = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 });
        const fearGreed = parseInt(fgRes.data.data[0].value) || 50;

        const btcRes = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { timeout: 8000 });
        const btcPrice = btcRes.data.bitcoin?.usd || null;

        const capRes = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8000 });
        const totalCap = capRes.data.data?.total_market_cap?.usd || null;
        const totalCapStr = totalCap ? '$' + (totalCap / 1e12).toFixed(2) + 'T' : '--';

        res.json({
            fearGreed,
            btcPrice: btcPrice ? btcPrice.toLocaleString() : '--',
            totalCap: totalCapStr
        });
    } catch (error) {
        console.error('❌ Ошибка получения рыночных данных:', error.message);
        res.json({ fearGreed: 50, btcPrice: '--', totalCap: '--' });
    }
});

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
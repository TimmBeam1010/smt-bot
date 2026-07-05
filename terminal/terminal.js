const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_URL = 'https://bot.smtbot.com';

app.get('/api/status', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/status`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/balance', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/balance`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/positions', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/positions`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/history`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

io.on('connection', (socket) => {
    console.log('📊 Клиент подключен');
    const sendData = async () => {
        try {
            const [b, p] = await Promise.all([
                axios.get(`${API_URL}/api/balance`, { timeout: 5000 }),
                axios.get(`${API_URL}/api/positions`, { timeout: 5000 })
            ]);
            const data = {
                balance: b.data.balance || 0,
                positions: p.data || { total: 0, long: 0, short: 0 },
                timestamp: new Date().toISOString()
            };
            console.log('📊 Отправка данных:', JSON.stringify(data));
            socket.emit('data', data);
        } catch (e) {
            console.error('❌ Ошибка:', e.message);
            socket.emit('error', { message: 'Ошибка получения данных' });
        }
    };
    sendData();
    const interval = setInterval(sendData, 3000);
    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('📊 Клиент отключен');
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`📊 Terminal запущен на порту ${PORT}`);
});

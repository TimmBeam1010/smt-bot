// ============================================
//  МОДУЛЬ ЛОГИРОВАНИЯ (Logger)
// ============================================

const fs = require('fs');
const path = require('path');

// Конфигурация
const LOG_DIR = path.join(__dirname, '../logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5;

// Уровни логирования
const LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// Убедимся, что папка для логов существует
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

class Logger {
    constructor(name = 'app') {
        this.name = name;
        this.logFile = path.join(LOG_DIR, `${name}.log`);
        this.currentLevel = LEVELS.INFO; // По умолчанию INFO
    }

    setLevel(level) {
        if (LEVELS[level] !== undefined) {
            this.currentLevel = LEVELS[level];
        }
    }

    _write(level, message, meta = {}) {
        if (LEVELS[level] > this.currentLevel) return;

        const timestamp = new Date().toISOString();
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const logLine = `[${timestamp}] [${level}] [${this.name}] ${message}${metaStr}\n`;

        // Пишем в консоль
        if (level === 'ERROR') {
            console.error(logLine.trim());
        } else {
            console.log(logLine.trim());
        }

        // Пишем в файл
        try {
            fs.appendFileSync(this.logFile, logLine);
            this._rotateIfNeeded();
        } catch (err) {
            console.error(`❌ Ошибка записи лога: ${err.message}`);
        }
    }

    error(message, meta = {}) {
        this._write('ERROR', message, meta);
    }

    warn(message, meta = {}) {
        this._write('WARN', message, meta);
    }

    info(message, meta = {}) {
        this._write('INFO', message, meta);
    }

    debug(message, meta = {}) {
        this._write('DEBUG', message, meta);
    }

    _rotateIfNeeded() {
        try {
            const stats = fs.statSync(this.logFile);
            if (stats.size > MAX_LOG_SIZE) {
                // Ротация: перемещаем старые логи
                for (let i = MAX_LOG_FILES - 1; i >= 0; i--) {
                    const oldFile = `${this.logFile}.${i}`;
                    const newFile = `${this.logFile}.${i + 1}`;
                    if (i === 0 && fs.existsSync(this.logFile)) {
                        fs.renameSync(this.logFile, `${this.logFile}.1`);
                    } else if (fs.existsSync(oldFile)) {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            }
        } catch (err) {
            // Игнорируем ошибки ротации, чтобы не нарушить работу
        }
    }
}

// Создаём и экспортируем логгеры для разных модулей
module.exports = {
    logger: (name) => new Logger(name),
    defaultLogger: new Logger('smt-bot')
};
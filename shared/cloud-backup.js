// ============================================
//  ОБЛАЧНОЕ РЕЗЕРВНОЕ КОПИРОВАНИЕ
// ============================================

const fs = require('fs');
const path = require('path');

class CloudBackup {
    constructor(config = {}) {
        this.backupDir = config.backupDir || './backups';
        this.maxBackups = config.maxBackups || 10;
        this.ensureDirectory();
    }

    ensureDirectory() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    /**
     * Создать резервную копию
     */
    createBackup(data, name = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = name ? `${name}-${timestamp}.json` : `backup-${timestamp}.json`;
        const filepath = path.join(this.backupDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(`📦 Бэкап создан: ${filepath}`);
        
        // Очищаем старые бэкапы
        this.cleanOldBackups();
        return filepath;
    }

    /**
     * Восстановить из бэкапа
     */
    restoreBackup(filename) {
        const filepath = path.join(this.backupDir, filename);
        if (!fs.existsSync(filepath)) {
            console.error(`❌ Бэкап не найден: ${filename}`);
            return null;
        }
        
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        console.log(`📦 Восстановлен бэкап: ${filename}`);
        return data;
    }

    /**
     * Очистить старые бэкапы
     */
    cleanOldBackups() {
        const files = fs.readdirSync(this.backupDir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(this.backupDir, f),
                time: fs.statSync(path.join(this.backupDir, f)).mtime
            }))
            .sort((a, b) => b.time - a.time);
        
        if (files.length > this.maxBackups) {
            const toDelete = files.slice(this.maxBackups);
            for (const file of toDelete) {
                fs.unlinkSync(file.path);
                console.log(`🗑️ Удален старый бэкап: ${file.name}`);
            }
        }
    }
}

module.exports = { CloudBackup };

const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    paragraph: { type: String, required: true },
    secret: { type: String, required: true },
    q1: { type: String, required: true },
    q2: { type: String, required: true },
    q3: { type: String, required: true },
    anonymous: { type: Number, default: 0 },
    selfie: { type: String },
    created_at: { type: Date, default: Date.now },
    driveBackup: { type: String, default: 'pending' },
    driveBackupAt: { type: Date }
});

module.exports = mongoose.model('Entry', entrySchema);

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    bakiye: { type: Number, default: 500 }
});

userSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
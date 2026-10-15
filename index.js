require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./User');
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionsBitField, 
    EmbedBuilder, 
    AuditLogEvent, 
    Partials, 
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} = require('discord.js');
const { createCanvas, loadImage } = require('canvas');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember]
});

const guildInvites = new Map();

// Cooldown ve Sayaçlar
const xpCooldowns = new Set();
const dailyCooldowns = new Map();

// Kullanıcı verisini MongoDB'den getiren veya oluşturan yardımcı fonksiyon
async function getUserData(guildId, userId) {
    let userData = await User.findOne({ guildId, userId });
    if (!userData) {
        userData = await User.create({ guildId, userId, xp: 0, level: 1, bakiye: 500 });
    }
    return { key: `${guildId}-${userId}`, data: userData };
}

// Üye sayısını ses kanalına güncelleyen fonksiyon
async function updateMemberCount(guild) {
    try {
        const memberCountChannel = guild.channels.cache.find(ch => ch.name.startsWith('👥 Üye:') || ch.name.startsWith('Üye Sayısı:'));
        if (memberCountChannel) {
            await memberCountChannel.setName(`👥 Üye: ${guild.memberCount}`);
        }
    } catch (err) {
        console.log('Member count güncellenirken hata oluştu:', err.message);
    }
}

// XP Verip Seviye Atlatma ve Coin Ödülü Verme Fonksiyonu
async function giveXp(guild, member, amount, source = 'text') {
    if (!guild || !member || member.user.bot) return;

    const { data } = await getUserData(guild.id, member.id);
    data.xp += amount;

    const currentLevel = data.level;
    const neededXp = currentLevel * 100;

    if (data.xp >= neededXp) {
        data.level += 1;
        data.xp -= neededXp;
        const newLevel = data.level;

        // Seviye Atlama Mokoko Coin Ödülü (0 - 100 arası rastgele)
        const earnedCoin = Math.floor(Math.random() * 101);
        data.bakiye += earnedCoin;

        // Öncelik 'seviye-atlama' kanalında
        const levelLogChannel = guild.channels.cache.find(ch => 
            ch.name === 'seviye-atlama' || ch.name === 'level-log' || ch.name === 'seviye-log'
        );

        const levelText = `🎉 Tebrikler ${member}!${source === 'voice' ? 'Ses kanalında vakit geçirerek' : 'Sohbet ettikçe'} gelişiyorsun, **Seviye ${newLevel}** oldun!\n🎁 Ödül olarak **+${earnedCoin} Mokoko Coin** kazandın! 🪙`;

        if (levelLogChannel) {
            levelLogChannel.send(levelText).catch(() => {});
        }

        // Otomatik Rol Verme
        const levelRoles = {
            5: 'Seviye 5',
            10: 'Seviye 10',
            20: 'Seviye 20',
            30: 'Seviye 30',
            50: 'Seviye 50'
        };

        if (levelRoles[newLevel]) {
            const roleName = levelRoles[newLevel];
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (role && member) {
                member.roles.add(role).catch(err => console.log('Seviye rolü verilemedi:', err));
            }
        }
    }

    await data.save();
}

// 1. TÜRKÇE SLASH KOMUTLARI
const commands = [
    new SlashCommandBuilder()
        .setName('sustur')
        .setDescription('Belirtilen kullanıcıyı süreli olarak susturur (Timeout).')
        .addUserOption(option => option.setName('kullanici').setDescription('Susturulacak kullanıcı').setRequired(true))
        .addIntegerOption(option => option.setName('sure').setDescription('Kaç dakika susturulacak?').setRequired(true))
        .addStringOption(option => option.setName('sebep').setDescription('Susturma sebebi').setRequired(false)),

    new SlashCommandBuilder()
        .setName('susturmayi-kaldir')
        .setDescription('Susturulmuş bir kullanıcının susturmasını kaldırır.')
        .addUserOption(option => option.setName('kullanici').setDescription('Susturması kaldırılacak kullanıcı').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mesaj-sil')
        .setDescription('Kanalda belirtilen miktarda mesajı topluca siler.')
        .addIntegerOption(option => option.setName('miktar').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('seviye')
        .setDescription('Mevcut seviye ve XP durumunuzu gösteren kartı görüntüler.')
        .addUserOption(option => option.setName('kullanici').setDescription('Seviyesine bakılacak kullanıcı').setRequired(false)),

    new SlashCommandBuilder()
        .setName('siralama')
        .setDescription('Sunucudaki en yüksek seviyeli ilk 10 üyeyi sıralar.'),

    new SlashCommandBuilder()
        .setName('cüzdan')
        .setDescription('Cüzdanınızdaki Mokoko Coin miktarını gösterir.')
        .addUserOption(option => option.setName('kullanici').setDescription('Bakiyesine bakılacak kullanıcı').setRequired(false)),

    new SlashCommandBuilder()
        .setName('zenginler')
        .setDescription('Sunucudaki en fazla Mokoko Coin\'e sahip ilk 10 zengini sıralar.'),

    new SlashCommandBuilder()
        .setName('günlük')
        .setDescription('Her 24 saatte bir ücretsiz günlük Mokoko Coin ödülünüzü alırsınız.'),

    new SlashCommandBuilder()
        .setName('zar-oyna')
        .setDescription('Bataklık kanalında bot ile zar atarak bahse girersiniz.')
        .addIntegerOption(option => option.setName('bahis').setDescription('Yatırmak istediğiniz Mokoko Coin miktarı').setRequired(true)),

    new SlashCommandBuilder()
        .setName('rulet')
        .setDescription('Bataklık kanalında 5 atışlı ölümcül risk ruletini oynarsınız.')
        .addIntegerOption(option => option.setName('bahis').setDescription('Yatırmak istediğiniz Mokoko Coin miktarı').setRequired(true))
].map(command => command.toJSON());

// 2. BOT HAZIR OLDUĞUNDA
client.once('ready', async () => {
    // MongoDB Bağlantısı Başlangıcı
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('🍃 MongoDB veritabanına başarıyla bağlandı!'))
        .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));
    // -----------------------------

    console.log(`✅ ${client.user.tag} aktif! Ses log sistemi ve tüm modüller devrede.`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('🚀 Tüm Slash Komutları başarıyla kaydedildi!');
    } catch (error) {
        console.error('Komut yüklenirken hata oluştu:', error);
    }

    client.guilds.cache.forEach(async (guild) => {
        try {
            const firstInvites = await guild.invites.fetch();
            guildInvites.set(guild.id, new Map(firstInvites.map((invite) => [invite.code, invite.uses])));
        } catch (err) {
            console.log(`Davetler çekilemedi (${guild.name}): Yetki eksik olabilir.`);
        }

        await updateMemberCount(guild);

        // --- ROL ALMA KANALINA MESAJ ---
        const roleChannel = guild.channels.cache.find(ch => ch.name === 'rol-alma');
        if (roleChannel) {
            try {
                const messages = await roleChannel.messages.fetch({ limit: 10 });
                const botMsg = messages.find(m => m.author.id === client.user.id);

                if (!botMsg) {
                    const embed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('🎭 Sunucu Katılım ve Üye Rolü')
                        .setDescription('Sunucudaki tüm kanallara erişebilmek ve aramıza katılmak için aşağıdaki **"Üye Rolü Al 👤"** butonuna tıklayabilirsiniz.')
                        .setFooter({ text: `${guild.name} Doğrulama Sistemi` });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('btn_user_role')
                            .setLabel('Üye Rolü Al')
                            .setEmoji('👤')
                            .setStyle(ButtonStyle.Primary)
                    );

                    await roleChannel.send({ embeds: [embed], components: [row] });
                }
            } catch (err) {
                console.log('Rol-alma mesajı gönderilemedi.');
            }
        }

        // --- DESTEK / TICKET KANALINA MESAJ ---
        const ticketChannel = guild.channels.cache.find(ch => ch.name === 'destek' || ch.name === 'ticket');
        if (ticketChannel) {
            try {
                const messages = await ticketChannel.messages.fetch({ limit: 10 });
                const botTicketMsg = messages.find(m => m.author.id === client.user.id);

                if (!botTicketMsg) {
                    const ticketEmbed = new EmbedBuilder()
                        .setColor('#2F3136')
                        .setTitle('📩 MokokoMod Destek & Bilet Sistemi')
                        .setDescription('Bir sorununuz, şikayetiniz veya yetkililere iletmek istediğiniz bir konu mu var?\n\nAşağıdaki **"Destek Talebi Oluştur"** butonuna tıklayarak size ve yetkililere özel gizli bir görüşme kanalı açabilirsiniz.')
                        .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
                        .setFooter({ text: `${guild.name} Destek Hizmetleri` });

                    const ticketRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('btn_create_ticket')
                            .setLabel('Destek Talebi Oluştur')
                            .setEmoji('📩')
                            .setStyle(ButtonStyle.Success)
                    );

                    await ticketChannel.send({ embeds: [ticketEmbed], components: [ticketRow] });
                }
            } catch (err) {
                console.log('Ticket paneli mesajı atılamadı:', err);
            }
        }
    });

    // --- SES KANALINDAKİ ÜYELERE 1 DAKİKADA BİR XP VE MOKOKO COIN VERME ---
    setInterval(() => {
        client.guilds.cache.forEach(guild => {
            const afkChannelId = guild.afkChannelId;

            guild.channels.cache.forEach(async channel => {
                if (channel.type === ChannelType.GuildVoice && channel.id !== afkChannelId) {
                    channel.members.forEach(async member => {
                        if (!member.user.bot) {
                            const voiceXp = Math.floor(Math.random() * 11) + 10;
                            const voiceCoin = Math.floor(Math.random() * 6) + 5;
                            await giveXp(guild, member, voiceXp, 'voice');
                            const { data } = await getUserData(guild.id, member.id);
                            data.bakiye += voiceCoin;
                            await data.save();
                        }
                    });
                }
            });
        });
    }, 60000);
});

client.on('inviteCreate', async (invite) => {
    const invites = guildInvites.get(invite.guild.id) || new Map();
    invites.set(invite.code, invite.uses);
    guildInvites.set(invite.guild.id, invites);
});

// 3. HOŞ GELDİN KARTI VE DAVET TAKİP
client.on('guildMemberAdd', async (member) => {
    await updateMemberCount(member.guild);

    const welcomeChannel = member.guild.channels.cache.find(ch => ch.name === 'hos-geldin' || ch.name === 'welcome');
    if (!welcomeChannel) return;

    const cachedInvites = guildInvites.get(member.guild.id) || new Map();
    let inviter = null;
    let inviterUses = 0;

    try {
        const newInvites = await member.guild.invites.fetch();
        const usedInvite = newInvites.find(inv => cachedInvites.has(inv.code) && cachedInvites.get(inv.code) < inv.uses);

        if (usedInvite) {
            inviter = usedInvite.inviter;
            inviterUses = usedInvite.uses;
        }
        guildInvites.set(member.guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) {
        console.log('Davet bilgisi okunamadı.');
    }

    const canvas = createCanvas(700, 250);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#23272A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#7289DA';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('HOŞ GELDİN!', 250, 100);

    ctx.font = '34px sans-serif';
    ctx.fillStyle = '#7289DA';
    const nameText = member.user.username.length > 15 ? member.user.username.substring(0, 15) + '...' : member.user.username;
    ctx.fillText(nameText, 250, 150);

    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(`Sunucunun ${member.guild.memberCount}. üyesisin!`, 250, 190);

    try {
        const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatar = await loadImage(avatarURL);

        ctx.save();
        ctx.beginPath();
        ctx.arc(120, 125, 70, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(avatar, 50, 55, 140, 140);
        ctx.restore();
    } catch (e) {
        console.log('Avatar yüklenemedi.');
    }

    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'hosgeldin.png' });

    const inviterText = inviter 
        ? `Aramıza **${inviter.tag}** sayesinde katıldı! 🎉 (Toplam **${inviterUses}** daveti var)`
        : 'Aramıza özel davet linki ile katıldı!';

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🎉 Aramıza Katıldı: ${member.user.username}`)
        .setDescription(`Selam ${member}! Sunucumuza hoş geldin.\n\n🔗 ${inviterText}\n👉 Rolünü alıp kanalları açmak için **#rol-alma** kanalına gidebilirsin!`)
        .setImage('attachment://hosgeldin.png')
        .setTimestamp()
        .setFooter({ text: `${member.guild.name} Güvenlik Sistemi` });

    await welcomeChannel.send({ embeds: [embed], files: [attachment] });
});

// --- SUNUCUDAN AYRILAN ÜYE LOG SİSTEMİ ---
client.on('guildMemberRemove', async (member) => {
    await updateMemberCount(member.guild);

    const logChannel = member.guild.channels.cache.find(ch => ch.name === 'mod-log' || ch.name === 'mesaj-log' || ch.name === 'gorusuruz');
    if (!logChannel) return;

    const joinedAt = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : null;
    const createdAt = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

    const timeField = joinedAt 
        ? { name: '📅 Sunucuya Katılış:', value: joinedAt, inline: true }
        : { name: '📅 Hesap Kuruluş Tarihi:', value: createdAt, inline: true };

    const leaveEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚪 Bir Üye Sunucudan Ayrıldı')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: '👤 Kullanıcı:', value: `${member.user.tag} (${member})`, inline: true },
            { name: '🆔 Kullanıcı ID:', value: `\`${member.id}\``, inline: true },
            timeField,
            { name: '📊 Güncel Üye Sayısı:', value: `**${member.guild.memberCount}** kişi kaldık.`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: `${member.guild.name} Ayrılış Takip Sistemi` });

    logChannel.send({ embeds: [leaveEmbed] }).catch(err => console.log('Ayrılış logu atılamadı:', err));
});

// --- SES KANALI GİRİŞ / ÇIKIŞ LOG SİSTEMİ ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    const guild = newState.guild;
    const member = newState.member;
    if (!member || member.user.bot) return;

    const logChannel = guild.channels.cache.find(ch => ch.name === 'mod-log' || ch.name === 'mesaj-log' || ch.name === 'ses-log');
    if (!logChannel) return;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    let embed = new EmbedBuilder()
        .setTimestamp()
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

    // 1. Ses Kanalına Giriş Yaptı
    if (!oldChannel && newChannel) {
        embed
            .setColor('#00FF7F')
            .setTitle('🔊 Ses Kanalına Giriş Yapıldı')
            .addFields(
                { name: '👤 Kullanıcı:', value: `${member.user.tag} (${member})`, inline: true },
                { name: '📌 Kanal:', value: `${newChannel.name}`, inline: true }
            )
            .setFooter({ text: 'MokokoMod Ses Log Sistemi' });

        return logChannel.send({ embeds: [embed] }).catch(() => {});
    }

    // 2. Ses Kanalından Ayrıldı
    if (oldChannel && !newChannel) {
        embed
            .setColor('#ED4245')
            .setTitle('🔇 Ses Kanalından Ayrıldı')
            .addFields(
                { name: '👤 Kullanıcı:', value: `${member.user.tag} (${member})`, inline: true },
                { name: '📌 Ayrıldığı Kanal:', value: `${oldChannel.name}`, inline: true }
            )
            .setFooter({ text: 'MokokoMod Ses Log Sistemi' });

        return logChannel.send({ embeds: [embed] }).catch(() => {});
    }

    // 3. Başka Bir Ses Kanalına Geçiş Yaptı
    if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
        embed
            .setColor('#5865F2')
            .setTitle('🔀 Ses Kanalı Değiştirildi')
            .addFields(
                { name: '👤 Kullanıcı:', value: `${member.user.tag} (${member})`, inline: true },
                { name: '📤 Eski Kanal:', value: `${oldChannel.name}`, inline: true },
                { name: '📥 Yeni Kanal:', value: `${newChannel.name}`, inline: true }
            )
            .setFooter({ text: 'MokokoMod Ses Log Sistemi' });

        return logChannel.send({ embeds: [embed] }).catch(() => {});
    }
});

// 4. BUTON İŞLEMLERİ (Rol Alma ve Ticket Yönetimi)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'btn_user_role') {
        const guild = interaction.guild;
        if (!guild) return;

        const roleName = 'Üye';
        const role = guild.roles.cache.find(r => r.name === roleName);

        if (!role) {
            return interaction.reply({ content: `⚠️ Sunucuda **"${roleName}"** isminde bir rol bulunamadı!`, ephemeral: true });
        }

        if (interaction.member.roles.cache.has(role.id)) {
            return interaction.reply({ content: '⚠️ Zaten **Üye** rolüne sahipsin!', ephemeral: true });
        }

        try {
            await interaction.member.roles.add(role);
            await interaction.reply({ content: '👤 **Üye** rolünüz başarıyla verildi! Artık tüm kanalları görebilirsiniz.', ephemeral: true });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: '❌ Rol verilirken bir hata oluştu.', ephemeral: true });
        }
    }

    if (interaction.customId === 'btn_create_ticket') {
        const guild = interaction.guild;
        const user = interaction.user;

        const existingChannel = guild.channels.cache.find(ch => ch.name === `ticket-${user.username.toLowerCase()}`);
        if (existingChannel) {
            return interaction.reply({ content: `⚠️ Zaten açık bir destek talebin var: ${existingChannel}`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.AttachFiles
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                    }
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setColor('#00FF7F')
                .setTitle(`🎫 Destek Talebi: ${user.username}`)
                .setDescription(`Merhaba ${user},\n\nDestek talebin başarıyla oluşturuldu. Lütfen sorununuzu veya iletmek istediğiniz konuyu detaylıca buraya yazın. Yetkililerimiz en kısa sürede seninle ilgilenecektir.\n\nİşin bittiğinde aşağıdaki **"🔒 Talebi Kapat"** butonuna basarak kanalı kapatabilirsin.`)
                .setTimestamp()
                .setFooter({ text: 'MokokoMod Destek Sistemi' });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_close_ticket')
                    .setLabel('Talebi Kapat')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `${user} | <@&1439199711230824459>`, embeds: [ticketEmbed], components: [closeRow] });

            await interaction.editReply({ content: `✅ Destek talebiniz oluşturuldu: ${ticketChannel}` });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Destek kanalı oluşturulurken bir hata oluştu!' });
        }
    }

    if (interaction.customId === 'btn_close_ticket') {
        const channel = interaction.channel;

        await interaction.reply({ content: '🔒 Destek talebi 5 saniye içerisinde kapatılıp silinecektir...' });

        setTimeout(async () => {
            try {
                await channel.delete();
            } catch (err) {
                console.log('Kanal silinirken hata oluştu:', err);
            }
        }, 5000);
    }
});

// 5. SİLİNEN MESAJ LOG SİSTEMİ
client.on('messageDelete', async (message) => {
    if (message.author?.bot) return;

    const logChannel = message.guild?.channels.cache.find(ch => ch.name === 'mod-log' || ch.name === 'mesaj-log');
    if (!logChannel) return;

    let deleter = 'Bilinmiyor / Kendi sildi';
    let authorInfo = message.author ? `${message.author.tag} (${message.author})` : 'Bilinmeyen Kullanıcı';
    let messageContent = message.content || '*[İçerik alınamadı veya sadece görsel]*';

    try {
        const fetchedLogs = await message.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MessageDelete,
        });
        const firstEntry = fetchedLogs.entries.first();

        if (firstEntry) {
            const timeDifference = Date.now() - firstEntry.createdTimestamp;
            if (timeDifference < 10000 && firstEntry.extra.channel.id === message.channel.id) {
                deleter = `${firstEntry.executor.tag} (${firstEntry.executor})`;
            }
        }
    } catch (err) {
        console.log('Audit log okunamadı.');
    }

    const logEmbed = new EmbedBuilder()
        .setColor('#FF3333')
        .setTitle('🗑️ Bir Mesaj Silindi!')
        .addFields(
            { name: '👤 Mesaj Sahibi:', value: authorInfo, inline: true },
            { name: '🛠️ Silen Kişi:', value: deleter, inline: true },
            { name: '📌 Kanal:', value: `${message.channel}`, inline: true },
            { name: '💬 Silinen Mesaj:', value: messageContent }
        )
        .setTimestamp()
        .setFooter({ text: 'MokokoMod Güvenlik Log Sistemi' });

    logChannel.send({ embeds: [logEmbed] }).catch(() => {});
});

// 6. MESAJ İŞLEMLERİ (CAPS LOCK, METİN XP & MOKOKO COIN KAZANMA)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || !message.content) return;

    // --- CAPS LOCK FİLTRESİ ---
    if (!message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const text = message.content;
        const lettersOnly = text.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');

        if (lettersOnly.length >= 7) {
            let upperCount = 0;
            for (let char of lettersOnly) {
                if (char === char.toUpperCase() && char !== char.toLowerCase()) {
                    upperCount++;
                }
            }

            const percentage = (upperCount / lettersOnly.length) * 100;
            if (percentage >= 70) {
                try {
                    await message.delete();
                    const warningMsg = await message.channel.send(`⚠️ ${message.author}, Çok fazla caps kullanma la eşek`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 3000);
                    return;
                } catch (err) {
                    console.log('Mesaj silinirken hata oluştu:', err);
                }
            }
        }
    }

    // --- METİN XP VE MOKOKO COİN SİSTEMİ ---
    const userId = message.author.id;
    const key = `${message.guild.id}-${userId}`;

    if (!xpCooldowns.has(key)) {
        xpCooldowns.add(key);
        setTimeout(() => xpCooldowns.delete(key), 10000);

        const addXp = Math.floor(Math.random() * 11) + 15;
        const addCoin = Math.floor(Math.random() * 6) + 5;
        
        await giveXp(message.guild, message.member, addXp, 'text');
        
        const { data } = await getUserData(message.guild.id, userId);
        data.bakiye += addCoin;
        await data.save();
    }
});

// 7. TÜRKÇE SLASH KOMUTLARI
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // --- /SUSTUR ---
    if (interaction.commandName === 'sustur') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: '❌ Bu komutu kullanmak için yetkin yok!', ephemeral: true });
        }

        const targetUser = interaction.options.getMember('kullanici');
        const durationMinutes = interaction.options.getInteger('sure');
        const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi.';

        if (!targetUser) return interaction.reply({ content: '❌ Kullanıcı bulunamadı!', ephemeral: true });
        if (!targetUser.moderatable) return interaction.reply({ content: '❌ Yetkim yetmiyor!', ephemeral: true });

        try {
            await targetUser.timeout(durationMinutes * 60 * 1000, reason);
            await interaction.reply({ content: `🔇 **${targetUser.user.tag}**${durationMinutes} dakika susturuldu.\n**Sebep:** ${reason}` });
        } catch (error) {
            await interaction.reply({ content: '❌ Hata oluştu!', ephemeral: true });
        }
    }

    // --- /SUSTURMAYI-KALDIR ---
    if (interaction.commandName === 'susturmayi-kaldir') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: '❌ Yetkin yok!', ephemeral: true });
        }

        const targetUser = interaction.options.getMember('kullanici');
        if (!targetUser) return interaction.reply({ content: '❌ Kullanıcı bulunamadı!', ephemeral: true });
        if (!targetUser.isCommunicationDisabled()) return interaction.reply({ content: '⚠️ Zaten susturulmamış!', ephemeral: true });

        try {
            await targetUser.timeout(null);
            await interaction.reply({ content: `🔊 **${targetUser.user.tag}** kullanıcısının susturması kaldırıldı.` });
        } catch (error) {
            await interaction.reply({ content: '❌ Hata oluştu!', ephemeral: true });
        }
    }

    // --- /MESAJ-SİL ---
    if (interaction.commandName === 'mesaj-sil') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ Bu komutu kullanmak için **Mesajları Yönet** yetkisine sahip olmalısın!', ephemeral: true });
        }

        const amount = interaction.options.getInteger('miktar');

        if (amount < 1 || amount > 100) {
            return interaction.reply({ content: '⚠️ Lütfen **1** ile **100** arasında bir miktar belirtin!', ephemeral: true });
        }

        try {
            const deleted = await interaction.channel.bulkDelete(amount, true);
            
            await interaction.reply({ 
                content: `🧹 **${deleted.size}** adet mesaj başarıyla silindi.`, 
                ephemeral: true 
            });

            const logChannel = interaction.guild.channels.cache.find(ch => ch.name === 'mod-log' || ch.name === 'mesaj-log');
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('🧹 Toplu Mesaj Silindi')
                    .addFields(
                        { name: '🛠️ Sorumlu Yetkili:', value: `${interaction.user.tag} (${interaction.user})`, inline: true },
                        { name: '📌 Kanal:', value: `${interaction.channel}`, inline: true },
                        { name: '📊 Silinen Miktar:', value: `\`${deleted.size}\` mesaj`, inline: true }
                    )
                    .setTimestamp();

                logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }

        } catch (error) {
            console.error(error);
            await interaction.reply({ 
                content: '❌ Mesajlar silinirken bir hata oluştu!', 
                ephemeral: true 
            });
        }
    }

    // --- /SEVİYE ---
    if (interaction.commandName === 'seviye') {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('kullanici') || interaction.user;
        const { data } = await getUserData(guildId, targetUser.id);
        const currentLevel = data.level;
        const currentXp = data.xp;
        const neededXp = currentLevel * 100;

        const canvas = createCanvas(700, 220);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#2F3136';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#5865F2';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        ctx.font = '28px sans-serif';
        ctx.fillStyle = '#FFFFFF';
        const nameText = targetUser.username.length > 14 ? targetUser.username.substring(0, 14) + '...' : targetUser.username;
        ctx.fillText(nameText, 210, 80);

        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#00FF7F';
        ctx.fillText(`Seviye: ${currentLevel}`, 210, 120);

        ctx.font = '18px sans-serif';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText(`XP: ${currentXp} /${neededXp}`, 480, 120);

        ctx.fillStyle = '#4F545C';
        ctx.fillRect(210, 140, 440, 30);

        const progressPercentage = Math.min(currentXp / neededXp, 1);
        const progressWidth = 440 * progressPercentage;

        ctx.fillStyle = '#5865F2';
        ctx.fillRect(210, 140, progressWidth, 30);

        try {
            const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarURL);

            ctx.save();
            ctx.beginPath();
            ctx.arc(100, 110, 60, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();

            ctx.drawImage(avatar, 40, 50, 120, 120);
            ctx.restore();
        } catch (e) {
            console.log('Avatar yüklenemedi.');
        }

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'seviye-kart.png' });
        await interaction.editReply({ files: [attachment] });
    }

    // --- /SIRALAMA ---
    if (interaction.commandName === 'siralama') {
        await interaction.deferReply();
        const users = await User.find({ guildId }).sort({ level: -1, xp: -1 }).limit(10);

        if (users.length === 0) {
            return interaction.editReply({ content: '📊 Henüz sıralamaya girecek kimse yok!' });
        }

        const medals = ['🥇', '🥈', '🥉'];
        let description = '';

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const medal = medals[i] || `**#${i + 1}**`;
            
            let memberName = `<@${user.userId}>`;
            try {
                const fetchedMember = await interaction.guild.members.fetch(user.userId);
                if (fetchedMember) memberName = `**${fetchedMember.user.username}**`;
            } catch (e) {}

            description += `${medal}${memberName} — Seviye ${user.level} *(${user.xp} XP)*\n`;
        }

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`🏆 ${interaction.guild.name} — Seviye Liderlik Tablosu`)
            .setDescription(description)
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: 'MokokoMod Sıralama Sistemi' });

        await interaction.editReply({ embeds: [embed] });
    }

    // --- /ZENGİNLER (COİN LİDERLİK TABLOSU) ---
    if (interaction.commandName === 'zenginler') {
        await interaction.deferReply();
        const users = await User.find({ guildId }).sort({ bakiye: -1 }).limit(10);

        if (users.length === 0) {
            return interaction.editReply({ content: '📊 Henüz zenginlik tablosunda kimse yok!' });
        }

        const medals = ['🥇', '🥈', '🥉'];
        let description = '';

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const medal = medals[i] || `**#${i + 1}**`;

            let memberName = `<@${user.userId}>`;
            try {
                const fetchedMember = await interaction.guild.members.fetch(user.userId);
                if (fetchedMember) memberName = `**${fetchedMember.user.username}**`;
            } catch (e) {}

            description += `${medal}${memberName} — \`${user.bakiye} Mokoko Coin\` 🪙\n`;
        }

        const embed = new EmbedBuilder()
            .setColor('#00FF7F')
            .setTitle(`👑 ${interaction.guild.name} — En Zenginler Kulübü`)
            .setDescription(description)
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: 'MokokoMod Ekonomi Liderlik Tablosu' });

        await interaction.editReply({ embeds: [embed] });
    }

    // --- /CÜZDAN ---
    if (interaction.commandName === 'cüzdan') {
        const targetUser = interaction.options.getUser('kullanici') || interaction.user;
        const { data } = await getUserData(guildId, targetUser.id);

        const embed = new EmbedBuilder()
            .setColor('#00FF7F')
            .setTitle(`💰 Cüzdan Bilgisi`)
            .setDescription(`👤 **${targetUser.username}** adlı kullanıcının cüzdan durumu:\n\n🪙 **Mokoko Coin:** \`${data.bakiye} Mokoko Coin\``)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: 'MokokoMod Ekonomi Sistemi' });

        await interaction.reply({ embeds: [embed] });
    }

    // --- /GÜNLÜK ---
    if (interaction.commandName === 'günlük') {
        const cooldownKey = `${guildId}-${userId}`;
        const lastClaim = dailyCooldowns.get(cooldownKey) || 0;
        const now = Date.now();
        const cooldownTime = 24 * 60 * 60 * 1000;

        if (now - lastClaim < cooldownTime) {
            const remaining = cooldownTime - (now - lastClaim);
            const hours = Math.floor(remaining / (1000 * 60 * 60));
            const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

            return interaction.reply({ 
                content: `⏳ Günlük ödülünü zaten aldın! Tekrar alabilmek için **${hours} saat${minutes} dakika** beklemelisin.`, 
                ephemeral: true 
            });
        }

        dailyCooldowns.set(cooldownKey, now);
        const { data } = await getUserData(guildId, userId);
        const reward = 250;
        data.bakiye += reward;
        await data.save();

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🎁 Günlük Ödül Alındı!')
            .setDescription(`Tebrikler ${interaction.user}, günlük **${reward} Mokoko Coin** cüzdanına eklendi!\n🪙 Güncel Bakiyen: \`${data.bakiye} Mokoko Coin\``)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    // --- /ZAR-OYNA ---
    if (interaction.commandName === 'zar-oyna') {
        const channelName = interaction.channel.name;
        if (channelName !== 'bataklık') {
            return interaction.reply({ 
                content: `⚠️ Bu komutu sadece **#bataklık** kanalında kullanabilirsin!`, 
                ephemeral: true 
            });
        }

        const bahis = interaction.options.getInteger('bahis');
        if (bahis <= 0) return interaction.reply({ content: '⚠️ Geçerli bir bahis miktarı girmelisin!', ephemeral: true });

        const { data } = await getUserData(guildId, userId);
        if (data.bakiye < bahis) {
            return interaction.reply({ content: `❌ Cüzdanında yeterli paran yok! Mevcut bakiyen: \`${data.bakiye} Mokoko Coin\``, ephemeral: true });
        }

        const rollMsg = await interaction.reply({ content: `🎲 Zarlar masada dönüyor...`, fetchReply: true });
        await new Promise(resolve => setTimeout(resolve, 1500));

        const oyuncuZar1 = Math.floor(Math.random() * 6) + 1;
        const oyuncuZar2 = Math.floor(Math.random() * 6) + 1;
        const oyuncuToplam = oyuncuZar1 + oyuncuZar2;
        const oyuncuCiftMi = (oyuncuZar1 === oyuncuZar2);

        const botZar1 = Math.floor(Math.random() * 4) + 1;
        const botZar2 = Math.floor(Math.random() * 4) + 1;
        const botToplam = botZar1 + botZar2;

        let sonucMetni = '';
        let kazanc = 0;
        let durumEmoji = '';

        if (oyuncuToplam > botToplam) {
            if (oyuncuCiftMi) {
                kazanc = bahis * 3;
                data.bakiye += (kazanc - bahis);
                durumEmoji = '🎉';
                sonucMetni = `**Kazandın!** Çift zar attığın için **+${kazanc} Mokoko Coin** aldın!`;
            } else {
                kazanc = bahis * 2;
                data.bakiye += (bahis);
                durumEmoji = '✨';
                sonucMetni = `**Botu Yendin!** **+${kazanc} Mokoko Coin** kazandın!`;
            }
        } else if (oyuncuToplam === botToplam) {
            kazanc = bahis * 2;
            data.bakiye += bahis;
            durumEmoji = '🤝';
            sonucMetni = `**Berabere!** Şans senden yana, ödülü kaptın (**+${kazanc} Mokoko Coin**).`;
        } else {
            data.bakiye -= bahis;
            durumEmoji = '😢';
            sonucMetni = `**Kaybettin!** Yatırdığın **${bahis} Mokoko Coin** yandı.`;
        }

        await data.save();

        const finalOutput = 
            `🎲 **Zar Düellosu** ${durumEmoji}\n` +
            `👤 **Sen:** ${oyuncuZar1} -${oyuncuZar2} *(Toplam: **${oyuncuToplam}**)*${oyuncuCiftMi ? '🔥 **[Çift]**' : ''}\n` +
            `🤖 **Bot:** ${botZar1} - ${botZar2} *(Toplam: **${botToplam}**)*\n\n` +
            `📜 ${sonucMetni}\n` +
            `🪙 Bakiye: \`${data.bakiye} Mokoko Coin\``;

        await rollMsg.edit({ content: finalOutput });
    }

    // --- /RULET ---
    if (interaction.commandName === 'rulet') {
        const channelName = interaction.channel.name;
        if (channelName !== 'bataklık') {
            return interaction.reply({ 
                content: `⚠️ Bu komutu sadece **#bataklık** kanalında kullanabilirsin!`, 
                ephemeral: true 
            });
        }

        const baslangicBahis = interaction.options.getInteger('bahis');
        if (baslangicBahis <= 0) return interaction.reply({ content: '⚠️ Geçerli bir bahis miktarı girmelisin!', ephemeral: true });

        const { data } = await getUserData(guildId, userId);
        if (data.bakiye < baslangicBahis) {
            return interaction.reply({ content: `❌ Cüzdanında yeterli paran yok! Mevcut bakiyen: \`${data.bakiye} Mokoko Coin\``, ephemeral: true });
        }

        data.bakiye -= baslangicBahis;
        await data.save();

        let atisHakki = 0; 
        const mermiIndex = Math.floor(Math.random() * 5); 
        const multipliers = [1.5, 2.0, 3.0, 5.0, 10.0];

        const getRuletContent = (status, currentMultiplier, currentWin) => {
            return `🎯 **Rus Ruleti — Ölümcül Risk**\n` +
                   `----------------------------------------\n` +
                   `👤 **Oyuncu:** ${interaction.user}\n` +
                   `💰 **Yatırılan Bahis:** \`${baslangicBahis} Mokoko Coin\`\n` +
                   `🔫 **Atış Adımı:** ${atisHakki + 1} / 5\n` +
                   `📈 **Mevcut Çarpan:** \`${currentMultiplier}x\`\n` +
                   `💵 **Anlık Kazanç:** \`${currentWin} Mokoko Coin\`\n` +
                   `----------------------------------------\n` +
                   `📜 **Durum:** ${status}`;
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rulet_ates')
                .setLabel('Ateş Et (Devam Et)')
                .setEmoji('🔫')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('rulet_cek')
                .setLabel('Parayı Çek (Cashout)')
                .setEmoji('💰')
                .setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.reply({ 
            content: getRuletContent('Silah kuruldu! İlk tetik için hazır mısın?', '1.0', baslangicBahis), 
            components: [row], 
            fetchReply: true 
        });

        const collector = msg.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async i => {
            if (i.user.id !== userId) {
                return i.reply({ content: '❌ Bu rulet masası senin değil!', ephemeral: true });
            }

            const currentData = (await getUserData(guildId, userId)).data;

            if (i.customId === 'rulet_ates') {
                if (atisHakki === mermiIndex) {
                    collector.stop('expired');
                    const failRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('bitti').setLabel('Mermi Patladı!').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                    await i.update({ 
                        content: `💥 **BAM! Mermi Patladı!**\nAtış ${atisHakki + 1} sırasında şanssızlık yakanı bırakmadı ve yatırdığın **${baslangicBahis} Mokoko Coin** bataklığa gömüldü. 💀\n🪙 Güncel Cüzdan: \`${currentData.bakiye} Mokoko Coin\``, 
                        components: [failRow] 
                    });
                } else {
                    atisHakki++;
                    if (atisHakki >= 5) {
                        collector.stop('expired');
                        const finalKazanc = Math.floor(baslangicBahis * multipliers[4]);
                        currentData.bakiye += finalKazanc;
                        await currentData.save();

                        const winRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('bitti').setLabel('Tebrikler!').setStyle(ButtonStyle.Success).setDisabled(true)
                        );
                        await i.update({ 
                            content: `🏆 **EFSANE BAŞARI! 5 Atışı da Atlatın!**\nÖlümcül silahsız 5 adımı tamamladın ve **${finalKazanc} Mokoko Coin** kazandın! 🚀\n🪙 Güncel Cüzdan: \`${currentData.bakiye} Mokoko Coin\``, 
                            components: [winRow] 
                        });
                    } else {
                        const currentMult = multipliers[atisHakki - 1];
                        const currentWin = Math.floor(baslangicBahis * currentMult);
                        await i.update({ 
                            content: getRuletContent(`Tetik çekildi... **Boş çıktı!** 😅 Devam mı edeceksin, parayı çekecek misin?`, currentMult, currentWin), 
                            components: [row] 
                        });
                    }
                }
            } else if (i.customId === 'rulet_cek') {
                collector.stop('expired');
                const kazanilanPara = atisHakki === 0 ? baslangicBahis : Math.floor(baslangicBahis * multipliers[atisHakki - 1]);
                currentData.bakiye += kazanilanPara;
                await currentData.save();

                const successRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('bitti').setLabel('Para Çekildi').setStyle(ButtonStyle.Success).setDisabled(true)
                );
                await i.update({ 
                    content: `💰 **Parayı Güvenle Çektin!**\nRisk almayı bırakarak **${kazanilanPara} Mokoko Coin** kazancını cüzdanına aktardın! ✅\n🪙 Güncel Cüzdan: \`${currentData.bakiye} Mokoko Coin\``, 
                    components: [successRow] 
                });
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const timeoutRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('bitti').setLabel('Süre Aşımı').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                const currentData = (await getUserData(guildId, userId)).data;
                await msg.edit({ content: `⏳ Süre bittiği için masadan atıldın ve bahsin yandı!\n🪙 Güncel Cüzdan: \`${currentData.bakiye} Mokoko Coin\``, components: [timeoutRow] }).catch(() => {});
            }
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
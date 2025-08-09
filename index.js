const { Client, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');

// Конфігурація через змінні середовища
const config = {
    token: process.env.DISCORD_TOKEN,
    port: process.env.PORT || 3000,
    allowedUsers: process.env.ALLOWED_USERS ? 
        process.env.ALLOWED_USERS.split(',') : 
        ['1344598543440019538', '721996501999550485'] // Дефолтні дозволені користувачі
};

// Express сервер для Railway
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'Message Cleaner Bot активний',
        uptime: process.uptime(),
        botStatus: client.user ? client.user.presence.status : 'не підключений'
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Discord клієнт
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Функція для видалення повідомлень користувача
async function deleteUserMessages(interaction, targetUserId, channelId = null) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const guild = interaction.guild;
        const targetUser = await client.users.fetch(targetUserId).catch(() => null);
        
        if (!targetUser) {
            return await interaction.editReply({
                content: ' Користувача з таким ID не знайдено!'
            });
        }

        let deletedCount = 0;
        let channelsProcessed = 0;
        const channels = channelId ? 
            [guild.channels.cache.get(channelId)] : 
            guild.channels.cache.filter(channel => 
                channel.isTextBased() && 
                channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.ReadMessageHistory)
            ).values();

        const progressEmbed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(' Видалення повідомлень...')
            .setDescription(`Початок видалення повідомлень користувача **${targetUser.tag}**`);
        
        await interaction.editReply({ embeds: [progressEmbed] });

        for (const channel of channels) {
            if (!channel || !channel.isTextBased()) continue;
            
            try {
                // Перевірка прав доступу
                const permissions = channel.permissionsFor(guild.members.me);
                if (!permissions?.has([
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.ManageMessages
                ])) {
                    continue;
                }

                let lastMessageId = null;
                let channelDeleted = 0;

                while (true) {
                    // Отримуємо повідомлення пакетами по 100
                    const messages = await channel.messages.fetch({
                        limit: 100,
                        before: lastMessageId
                    });

                    if (messages.size === 0) break;

                    // Фільтруємо повідомлення конкретного користувача
                    const userMessages = messages.filter(msg => msg.author.id === targetUserId);
                    
                    if (userMessages.size === 0) {
                        lastMessageId = messages.last().id;
                        continue;
                    }

                    // Видаляємо повідомлення (тільки нові, < 14 днів)
                    const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
                    const recentMessages = userMessages.filter(msg => msg.createdTimestamp > fourteenDaysAgo);

                    if (recentMessages.size > 1) {
                        // Масове видалення для нових повідомлень
                        try {
                            await channel.bulkDelete(recentMessages);
                            deletedCount += recentMessages.size;
                            channelDeleted += recentMessages.size;
                        } catch (error) {
                            // Якщо масове видалення не працює, видаляємо по одному
                            for (const message of recentMessages.values()) {
                                try {
                                    await message.delete();
                                    deletedCount++;
                                    channelDeleted++;
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                } catch (deleteError) {
                                    console.error(`Помилка видалення повідомлення: ${deleteError.message}`);
                                }
                            }
                        }
                    } else if (recentMessages.size === 1) {
                        try {
                            await recentMessages.first().delete();
                            deletedCount++;
                            channelDeleted++;
                        } catch (error) {
                            console.error(`Помилка видалення повідомлення: ${error.message}`);
                        }
                    }

                    lastMessageId = messages.last().id;
                    
                    // Затримка між пакетами
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (channelDeleted > 0) {
                    channelsProcessed++;
                    console.log(`Канал ${channel.name}: видалено ${channelDeleted} повідомлень`);
                }

            } catch (error) {
                console.error(`Помилка обробки каналу ${channel.name}: ${error.message}`);
            }
        }

        // Фінальний результат
        const resultEmbed = new EmbedBuilder()
            .setColor(deletedCount > 0 ? '#00FF00' : '#FFA500')
            .setTitle(' Операція завершена')
            .setDescription(`
                **Користувач:** ${targetUser.tag} (${targetUser.id})
                **Видалено повідомлень:** ${deletedCount}
                **Оброблено каналів:** ${channelsProcessed}
                
                 *Видалено тільки повідомлення молодше 14 днів*
            `)
            .setTimestamp();

        await interaction.editReply({ embeds: [resultEmbed] });

        // Лог для адміністраторів
        console.log(`${interaction.user.tag} видалив ${deletedCount} повідомлень користувача ${targetUser.tag}`);

    } catch (error) {
        console.error('Помилка видалення повідомлень:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(' Помилка')
            .setDescription(`Сталася помилка: ${error.message}`);

        await interaction.editReply({ embeds: [errorEmbed] }).catch(console.error);
    }
}

// Slash команди
const commands = [
    new SlashCommandBuilder()
        .setName('clear-user')
        .setDescription('Видалити повідомлення користувача на сервері (останні 14 днів)')
        .addStringOption(option =>
            option.setName('userid')
                .setDescription('ID користувача Discord')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Конкретний канал (якщо не вказано - всі канали)')
                .setRequired(false)
        ),
    
    new SlashCommandBuilder()
        .setName('clear-info')
        .setDescription('Інформація про команди бота')
];

// Події бота
client.once('ready', async () => {
    console.log(` Message Cleaner Bot ${client.user.tag} готовий!`);
    
    // Реєстрація slash команд
    try {
        await client.application.commands.set(commands);
        console.log(' Slash команди зареєстровані');
    } catch (error) {
        console.error('Помилка реєстрації команд:', error);
    }
    
    client.user.setActivity('Очищення повідомлень', { type: 'WATCHING' });
    client.user.setStatus('online');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Перевірка прав (адміністратори або дозволені користувачі)
    const hasManageMessages = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages);
    const isAllowedUser = config.allowedUsers.includes(interaction.user.id);
    
    if (!hasManageMessages && !isAllowedUser) {
        return await interaction.reply({
            content: ' У вас немає прав для використання цієї команди! Потрібні права **Manage Messages** або бути в списку дозволених користувачів.',
            ephemeral: true
        });
    }

    const { commandName } = interaction;

    if (commandName === 'clear-user') {
        const targetUserId = interaction.options.getString('userid');
        const targetChannel = interaction.options.getChannel('channel');
        
        // Валідація User ID
        if (!/^\d{17,19}$/.test(targetUserId)) {
            return await interaction.reply({
                content: ' Невірний формат ID користувача! ID повинен містити 17-19 цифр.',
                ephemeral: true
            });
        }

        // Захист від видалення повідомлень бота або власних
        if (targetUserId === client.user.id) {
            return await interaction.reply({
                content: 'Неможливо видалити повідомлення самого бота!',
                ephemeral: true
            });
        }

        if (targetUserId === interaction.user.id) {
            return await interaction.reply({
                content: ' Використовуйте стандартні засоби Discord для видалення власних повідомлень!',
                ephemeral: true
            });
        }

        await deleteUserMessages(interaction, targetUserId, targetChannel?.id);
    }
    
    else if (commandName === 'clear-info') {
        const infoEmbed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('Message Cleaner Bot')
            .setDescription('Бот для видалення повідомлень користувачів')
            .addFields(
                {
                    name: 'Команди',
                    value: '`/clear-user userid: [channel:]` - Видалити повідомлення користувача'
                },
                {
                    name: 'Обмеження',
                    value: 'Видаляються тільки повідомлення **молодше 14 днів** (обмеження Discord API)'
                },
                {
                    name: 'Права доступу',
                    value: 'Потрібні права **Manage Messages**'
                },
                {
                    name: 'Застереження',
                    value: 'Операція незворотна! Використовуйте обережно.'
                },
                {
                    name: 'Швидкість',
                    value: 'Швидке видалення завдяки bulk delete API'
                }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [infoEmbed], ephemeral: true });
    }
});

// Обробка помилок
client.on('error', console.error);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Необроблена помилка Promise:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Необроблена помилка:', error);
});

// Запуск Express сервера
app.listen(config.port, () => {
    console.log(`Express сервер запущено на порті ${config.port}`);
});

// Запуск Discord бота
client.login(config.token);

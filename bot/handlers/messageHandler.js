const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions } = require('../utils/session');
const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');

module.exports = function messageHandler(bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignorar comandos que ya son manejados por otros handlers
    if (text && text.startsWith('/')) return;

    try {
      const user = await userApiService.getUser(chatId);

      // Manejar actualización de DNI si el usuario está en estado de espera
      if (userSessions.has(chatId) && userSessions.get(chatId).waitingForDni) {
        const targetUserId = userSessions.get(chatId).waitingForDni;
        
        // Validar DNI (entre 6 y 12 caracteres)
        if (!text || text.length < 6 || text.length > 12) {
          await bot.sendMessage(chatId, 
            '❌ **DNI inválido**\n\nEl DNI debe tener entre 6 y 12 caracteres.\n\nInténtalo nuevamente:',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        try {
          console.log(`Actualizando DNI del usuario ${targetUserId} con nuevo DNI: ${text}`);
          
          // Actualizar DNI en el backend
          const updateResult = await userApiService.updateUser(targetUserId, { dni: text });
          console.log('Resultado de actualización:', JSON.stringify(updateResult, null, 2));
          
          // Limpiar estado de espera
          userSessions.get(chatId).waitingForDni = null;
          
          // Mostrar detalles actualizados del usuario
          const updatedUser = await userApiService.getUserById(targetUserId);
          console.log('Usuario actualizado obtenido:', JSON.stringify(updatedUser, null, 2));
          
          if (updatedUser) {
            const rolEmoji = updatedUser.role_id === 1 ? '👑' : '👤';
            const roleName = updatedUser.role_id === 1 ? 'Admin' : 'Usuario';
          
            const userDetailMenu = {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✏️ Editar Rol', callback_data: `edit_rol_${updatedUser.id}` },
                    { text: '🆔 Editar DNI', callback_data: `edit_dni_${updatedUser.id}` }
                  ],
                  [
                    { text: '🗑️ Eliminar Usuario', callback_data: `delete_user_${updatedUser.id}` }
                  ],
                  [
                    { text: '🔙 Volver a Lista', callback_data: 'users_list' }
                  ]
                ]
              }
            };
          
            console.log('Enviando mensaje con DNI actualizado:', updatedUser.dni);
            
            // Usar sendMessage en lugar de editMessageText ya que no tenemos messageId
            await bot.sendMessage(chatId,
              `👤 **Detalles del Usuario**\n\n` +
              `${rolEmoji} **Nombre:** ${updatedUser.nombre || 'No especificado'}\n` +
              `🆔 **DNI:** ${updatedUser.dni || 'No especificado'}\n` +
              `📱 **Telegram ID:** ${updatedUser.telegram_id || 'No especificado'}\n` +
              `🎭 **Rol:** ${roleName}\n` +
              `🏢 **Sede:** ${updatedUser.sede || 'Sin sede'}\n\n` +
              `✅ **DNI actualizado exitosamente**\n\n` +
              `Selecciona una acción:`,
              {
                parse_mode: 'Markdown',
                reply_markup: userDetailMenu.reply_markup
              }
            );
          } else {
            console.error('No se pudo obtener el usuario actualizado');
            await bot.sendMessage(chatId, 
              '❌ **Error**\n\nNo se pudo obtener los datos actualizados del usuario.',
              { parse_mode: 'Markdown' }
            );
          }
          
        } catch (error) {
          console.error('Error completo al actualizar DNI:', error);
          console.error('Stack trace:', error.stack);
          await bot.sendMessage(chatId, 
            '❌ **Error al actualizar DNI**\n\nNo se pudo conectar con el backend. Inténtalo nuevamente.',
            { parse_mode: 'Markdown' }
          );
        }
        return;
      }

      if (text) {
        switch (text) {
          case '🏠 Menú Principal':
            if (user) {
              const sent = await bot.sendMessage(chatId, 'Menú Principal', mainMenu(user));
              trackBotMessage(chatId, sent.message_id);
            }
            break;

          case '📊 Mi Perfil':
            if (user) {
              await bot.sendMessage(chatId,
                `*Nombre:* ${user.nombre}\n*DNI:* ${user.dni}`,
                { parse_mode: 'Markdown' });
            }
            break;

          case '🔑 Panel Admin':
            if (user && user.role_id === 1) {
              const sent = await bot.sendMessage(chatId,
                '🔐 **Panel de Administración**\n\nSelecciona una opción:',
                { parse_mode: 'Markdown', ...adminMenu() });
              trackBotMessage(chatId, sent.message_id);
            } else {
              await bot.sendMessage(chatId,
                '❌ No tienes permisos de administrador',
                { parse_mode: 'Markdown' });
            }
            break;

          case '🛒 Tienda':
            await bot.sendMessage(chatId, 'Bienvenido a la tienda 🛍️');
            break;

          case '📋 Reportes':
            await bot.sendMessage(chatId, 'Aquí irían los reportes 📋');
            break;

          case '❓ Ayuda':
            await bot.sendMessage(chatId,
              '🆘 Usa los botones del menú para navegar\n/start para reiniciar.');
            break;

          case '⚙️ Configuración':
            await bot.sendMessage(chatId, '⚙️ Configuración no disponible por ahora.');
            break;

          case '📝 Registrarse':
            await bot.sendMessage(chatId, 'Por favor, ingresa tu DNI para registrarte:');
            break;
        }
      }

      if (userSessions.has(chatId)) {
        renewSessionTimeout(bot, chatId);
      }
    } catch (error) {
      console.error('Error en messageHandler:', error);
    }

    // Renovar timeout de sesión
    if (userSessions.has(chatId)) {
      renewSessionTimeout(bot, chatId);
    }
  });
};

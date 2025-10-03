const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions, trackBotMessage } = require('../utils/session');
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
      
      // Si el usuario no existe, no procesar el mensaje (está en proceso de registro)
      if (!user) {
        return; // Simplemente ignorar el mensaje sin mostrar error
      }

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
          
          if (updateResult && updateResult.success) {
            console.log('DNI actualizado exitosamente:', updateResult);
            
            // Limpiar la sesión de espera
            userSessions.delete(chatId);
            
            // Obtener el usuario actualizado
            const updatedUser = await userApiService.getUserById(targetUserId);
            
            if (updatedUser) {
              console.log('Usuario actualizado obtenido:', updatedUser);
              
              // Determinar el rol y emoji
              const roleName = updatedUser.role_id === 1 ? 'Admin' : 'Usuario';
              const rolEmoji = updatedUser.role_id === 1 ? '👑' : '👤';
              
              // Crear menú de detalles del usuario
              const userDetailMenu = {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✏️ Editar DNI', callback_data: `edit_dni_${updatedUser.id}` },
                      { text: '🎭 Cambiar Rol', callback_data: `edit_rol_${updatedUser.id}` }
                    ],
                    [{ text: '🔙 Volver a Lista', callback_data: 'admin_users' }]
                  ]
                }
              };
              
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
            
          } else {
            console.error('Error en la respuesta del backend:', updateResult);
            await bot.sendMessage(chatId, 
              '❌ **Error al actualizar DNI**\n\nEl backend devolvió un error. Inténtalo nuevamente.',
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

      // Renovar timeout de sesión
      renewSessionTimeout(bot, chatId);

      switch (text) {
        case '👤 Perfil':
          await bot.sendMessage(chatId, 
            `👤 <b>Tu Perfil</b>\n\n` +
            `📛 <b>Nombre:</b> ${user.nombre}\n` +
            `🆔 <b>DNI:</b> ${user.dni}\n` +
            `📱 <b>Telegram ID:</b> ${user.telegram_id}\n` +
            `🎭 <b>Rol:</b> ${user.role_id === 1 ? 'Administrador' : 'Usuario'}\n` +
            `🏢 <b>Sede:</b> ${user.sede || 'Sin sede'}`,
            { parse_mode: 'HTML' }
          );
          break;

        case '📝 Consultas':
          // Verificar si el usuario es administrador
          if (user.role_id === 1) {
            await bot.sendMessage(chatId, 
              '❌ <b>Acceso restringido</b>\n\n' +
              'Los administradores no tienen acceso a la sección de consultas.\n' +
              'Usa el Panel Admin para gestionar el sistema.',
              { parse_mode: 'HTML' }
            );
            return;
          }
          
          const consultasMenu = require('../menus/consultasMenu');
          await bot.sendMessage(chatId, 'Selecciona una consulta:', consultasMenu());
          break;

        case '🛒 Tienda':
          const { tiendaWebApp } = require('../menus/shopMenu');
          await bot.sendMessage(chatId, 'Bienvenido a la tienda 🛍️', tiendaWebApp());
          break;

        case '📊 Reportes':
          const reportsMenu = require('../menus/reportsMenu');
          await bot.sendMessage(chatId, 'Selecciona un reporte:', reportsMenu());
          break;

        case '🔑 Panel Admin':
          if (user.role_id === 1) {
            const adminMenu = require('../menus/adminMenu');
            await bot.sendMessage(chatId, 'Panel de Administración:', adminMenu());
          } else {
            await bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
          }
          break;

        case '🚪 Cerrar Sesión':
          // Limpiar sesión y mostrar solo botón de inicio
          const { clearUserSession } = require('../utils/session');
          await clearUserSession(bot, chatId);
          
          const startKeyboard = {
            reply_markup: { 
              keyboard: [['🚀 Iniciar']], 
              resize_keyboard: true 
            }
          };
          
          await bot.sendMessage(chatId, 
            '👋 <b>Sesión cerrada</b>\n\nPresiona "Iniciar" para volver a comenzar.',
            { parse_mode: 'HTML', ...startKeyboard }
          );
          break;

        case '🚀 Iniciar':
          // Recrear sesión
          try {
            const user = await userApiService.getUser(chatId);
            if (user) {
              // Recrear menú persistente
              let keyboard = [
                ['👤 Perfil']
              ];
              
              // Solo agregar consultas si NO es administrador
              if (user.role_id !== 1) {
                keyboard[0].push('📝 Consultas'); // Agregar a la primera fila
                keyboard.push(['🛒 Tienda', '📊 Reportes']); // Segunda fila
              } else {
                keyboard.push(['🛒 Tienda', '📊 Reportes']); // Primera fila para admins
              }
              
              if (user.role_id === 1) {
                keyboard.push(['🔑 Panel Admin']);
              }
              
              keyboard.push(['🚪 Cerrar Sesión']);
              
              const replyKeyboard = {
                reply_markup: { keyboard: keyboard, resize_keyboard: true }
              };
              
              const { startSessionTimeout } = require('../utils/session');
              startSessionTimeout(bot, chatId);
              
              await bot.sendMessage(chatId,
                `¡Hola ${user.nombre}! 👋\n\nUsa el menú de abajo para navegar.`, replyKeyboard);
            }
          } catch (error) {
            await bot.sendMessage(chatId, '❌ Error al iniciar sesión.');
          }
          break;

        default:
          await bot.sendMessage(chatId, 
            '❓ <b>Comando no reconocido</b>\n\n' +
            'Usa las opciones del menú de abajo para navegar:\n\n' +
            '• 👤 Perfil - Ver tu información\n' +
            '• 📝 Consultas - Ver reportes y crédito\n' +
            '• 🛒 Tienda - Acceder a la tienda\n' +
            '• 📊 Reportes - Generar reportes\n' +
            (user.role_id === 1 ? '• 🔑 Panel Admin - Administración\n' : '') +
            '• 🚪 Cerrar Sesión - Salir del sistema',
            { parse_mode: 'HTML' }
          );
          break;
      }

    } catch (error) {
      console.error('Error en messageHandler:', error);
      // Solo mostrar error si el usuario existe (está registrado)
      try {
        const user = await userApiService.getUser(chatId);
        if (user) {
          await bot.sendMessage(chatId,
            '❌ Error interno del servidor. Inténtalo nuevamente.',
            { parse_mode: 'Markdown' });
        }
      } catch (checkError) {
        // Si no se puede verificar el usuario, no mostrar error
        console.log('Usuario no registrado, ignorando error del messageHandler');
      }
    }
  });
};

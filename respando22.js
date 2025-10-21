const { getUser, getUserById, updateUserRol, updateUserDni, deleteUser } = require('../../db/index');
const { renewSessionTimeout, userSessions } = require('../utils/session');
const { trackBotMessage } = require('../utils/messages');
const mainMenu = require('../menus/mainMenu');
// importa otros menús según necesites
const adminMenu = require('../menus/adminMenu');
const usersManagementMenu = require('../menus/usersMenu');
const shopMenu = require('../menus/shopMenu');
const reportsMenu = require('../menus/reportsMenu');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


module.exports = function callbackHandler(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const user = getUser(chatId);
    const action = query.data;

    try {
      await bot.answerCallbackQuery(query.id);
    } catch {}

    // ejemplos simples
    if (action === 'nav_home') {
      await bot.editMessageText(`Hola ${user.nombre}!`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        ...mainMenu(user)
      });
      return;
    }

    if (action === 'perfil') {
      const estado = user.estado === '1' ? '🟢 Activo' : '🔴 Inactivo';
      await bot.editMessageText(
        `*Nombre:* ${user.nombre}\n*DNI:* ${user.dni}\n*Estado:* ${estado}`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
      );
      return;
    }

    if (action === 'consulta') {
    let loadingMessageId;
    
    try {
      // Editar mensaje inicial con animación
      const loadingMessage = await bot.editMessageText('⏳ Generando reporte', {
        chat_id: chatId,
        message_id: query.message.message_id
      });
      loadingMessageId = loadingMessage.message_id;
      
      // Animación de carga
      const loadingFrames = ['⏳', '⌛', '⏳', '⌛'];
      let frameIndex = 0;
      
      const loadingInterval = setInterval(async () => {
        try {
          await bot.editMessageText(
            `${loadingFrames[frameIndex]} Generando reporte${'.'.repeat((frameIndex % 3) + 1)}`,
            {
              chat_id: chatId,
              message_id: loadingMessageId
            }
          );
          frameIndex = (frameIndex + 1) % loadingFrames.length;
        } catch (err) {
          // Ignorar errores de edición durante la animación
        }
      }, 1000);

      // Generar PDF desde API
      const reportsDir = path.join(__dirname, '../../reportes');
      fs.mkdirSync(reportsDir, { recursive: true });
      const pdfPath = path.join(reportsDir, `reporte_${user.dni}.pdf`);

      try {
        const res = await axios.post(
          'https://0f18915009e0.ngrok-free.app/pdf/generate-and-download',
          { dni: user.dni },
          { responseType: 'arraybuffer', timeout: 60000 }
        );
        
        // Detener animación
        clearInterval(loadingInterval);
        
        // Actualizar mensaje a "completado"
        await bot.editMessageText('✅ Reporte generado exitosamente', {
          chat_id: chatId,
          message_id: loadingMessageId
        });
        
        // Guardar y enviar PDF
        fs.writeFileSync(pdfPath, res.data);
        await bot.sendDocument(chatId, pdfPath, {
          caption: `📄 Reporte para DNI: ${user.dni}`
        }, {
          filename: `reporte_${user.dni}.pdf`,
          contentType: 'application/pdf'
        });
        
        // Opcional: Eliminar mensaje de "completado" después de 3 segundos
        setTimeout(async () => {
          try {
            await bot.deleteMessage(chatId, loadingMessageId);
          } catch (err) {
            // Ignorar si no se puede eliminar
          }
        }, 3000);
        
      } catch (err) {
        // Detener animación en caso de error
        clearInterval(loadingInterval);
        
        console.error('❌ Error generando reporte:', err.message);
        
        // Actualizar mensaje con error
        await bot.editMessageText('❌ Error generando el reporte. Intenta nuevamente.', {
          chat_id: chatId,
          message_id: loadingMessageId
        });
        
        // Eliminar mensaje de error después de 5 segundos
        setTimeout(async () => {
          try {
            await bot.deleteMessage(chatId, loadingMessageId);
          } catch (err) {
            // Ignorar si no se puede eliminar
          }
        }, 5000);
      }
      
    } catch (error) {
      console.log('⚠️ Error editando mensaje:', error.message);
      // Fallback: enviar nuevo mensaje si no se puede editar
      await bot.sendMessage(chatId, '⏳ Generando reporte...');
      
      // Continuar con la lógica normal...
      const reportsDir = path.join(__dirname, '../../reportes');
      fs.mkdirSync(reportsDir, { recursive: true });
      const pdfPath = path.join(reportsDir, `reporte_${user.dni}.pdf`);

      try {
        const res = await axios.post(
          'https://consulta.jamuywasi.com/generate-and-download-pdf',
          { dni: user.dni },
          { responseType: 'arraybuffer', timeout: 60000 }
        );
        fs.writeFileSync(pdfPath, res.data);
        await bot.sendDocument(chatId, pdfPath, {
          caption: '✅ Reporte generado con éxito'
        }, {
          filename: `reporte_${user.dni}.pdf`,
          contentType: 'application/pdf'
        });
      } catch (err) {
        console.error('❌ Error generando reporte:', err.message);
        await bot.sendMessage(chatId, '❌ Error generando el reporte.');
      }
    }}

    if (action === 'admin' && user.rol === 'admin') {
    try {
      await bot.editMessageText(
        '🔐 **Panel de Administrador**\n\nSelecciona una opción:',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          ...adminMenu()
        }
      );
    } catch (error) {
      console.log('⚠️ Error editando mensaje:', error.message);
      await bot.sendMessage(chatId, '🔐 **Panel de Administrador**\n\nSelecciona una opción:', {
        parse_mode: 'Markdown',
        ...adminMenu()
      });
    }}

    if (action === 'admin_users' && user.rol === 'admin') {
    try {
      await bot.editMessageText(
        '👥 **Gestión de Usuarios**\n\n¿Qué deseas hacer?',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          ...usersManagementMenu()
        }
      );
    } catch (error) {
      await bot.sendMessage(chatId, '👥 **Gestión de Usuarios**\n\n¿Qué deseas hacer?', {
        parse_mode: 'Markdown',
        ...usersManagementMenu()
      });
    }
  } 

  if (action === 'view_all_users' && user.rol === 'admin') {
    const { getAllUsers } = require('./db');
    const allUsers = getAllUsers();
    
    let usersList = '👥 **Lista de Usuarios:**\n\n';
    allUsers.forEach((u, index) => {
      const estado = u.estado === '1' ? '🟢' : '🔴';
      const rol = u.rol === 'admin' ? '👑' : '👤';
      usersList += `${index + 1}. ${rol} **${u.nombre}**\n`;
      usersList += `   DNI: \`${u.dni}\` ${estado}\n\n`;
    });
    
    await bot.sendMessage(chatId, usersList, {
      parse_mode: 'Markdown',
      ...usersManagementMenu()
    });
  } 

  if (action === 'users_list' && user.rol === 'admin') {
    const { listUsers } = require('../../db/index');
    const allUsers = listUsers();
    
    if (allUsers.length === 0) {
      await bot.sendMessage(chatId, '📋 **No hay usuarios registrados**', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Volver', callback_data: 'admin_users' }]
          ]
        }
      });
      return;
    }
    
    // Crear botones para cada usuario
    let userButtons = [];
    allUsers.forEach(u => {
      const estado = u.estado === '1' ? '🟢' : '🔴';
      const rol = u.rol === 'admin' ? '👑' : '👤';
      const buttonText = `${rol} ${u.nombre} (${u.dni}) ${estado}`;
      
      userButtons.push([{ 
        text: buttonText, 
        callback_data: `user_detail_${u.telegram_id}` 
      }]);
    });
    
    // Agregar botón de navegación
    userButtons.push([{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]);
    
    try {
      await bot.editMessageText(
        '👥 **Lista de Usuarios**\n\nSelecciona un usuario para ver su reporte detallado:',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: userButtons }
        }
      );
    } catch (error) {
      const sentMessage = await bot.sendMessage(chatId, 
        '👥 **Lista de Usuarios**\n\nSelecciona un usuario para ver su reporte detallado:', 
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: userButtons }
        }
      );
      trackBotMessage(chatId, sentMessage.message_id);
    }}

    

    if (userSessions.has(chatId)) {
      renewSessionTimeout(bot, chatId);
    }

    trackBotMessage(chatId, query.message.message_id);
  });
};

    // Manejar detalles de usuario específico
    if (action.startsWith('user_detail_')) {
      const targetUserId = action.split('_')[2];
      const targetUser = getUserById(targetUserId);
      
      if (!targetUser) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
        return;
      }

      const rolEmoji = targetUser.rol === 'admin' ? '👑' : '👤';
      const estadoEmoji = targetUser.estado === '1' ? '✅' : '❌';
      
      const userDetailMenu = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✏️ Editar Rol', callback_data: `edit_rol_${targetUserId}` },
              { text: '🆔 Editar DNI', callback_data: `edit_dni_${targetUserId}` }
            ],
            [
              { text: '🗑️ Eliminar Usuario', callback_data: `delete_user_${targetUserId}` }
            ],
            [
              { text: '🔙 Volver a Lista', callback_data: 'admin_users' }
            ]
          ]
        }
      };

      try {
        await bot.editMessageText(
          `👤 **Detalles del Usuario**\n\n` +
          `${rolEmoji} **Nombre:** ${targetUser.nombre || 'No especificado'}\n` +
          `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
          `📱 **Telegram ID:** ${targetUser.chat_id}\n` +
          `🎭 **Rol:** ${targetUser.rol}\n` +
          `${estadoEmoji} **Estado:** ${targetUser.estado === '1' ? 'Activo' : 'Inactivo'}\n\n` +
          `Selecciona una acción:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...userDetailMenu
          }
        );
      } catch (error) {
        const sentMessage = await bot.sendMessage(chatId, 
          `👤 **Detalles del Usuario**\n\n` +
          `${rolEmoji} **Nombre:** ${targetUser.nombre || 'No especificado'}\n` +
          `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
          `📱 **Telegram ID:** ${targetUser.chat_id}\n` +
          `🎭 **Rol:** ${targetUser.rol}\n` +
          `${estadoEmoji} **Estado:** ${targetUser.estado === '1' ? 'Activo' : 'Inactivo'}\n\n` +
          `Selecciona una acción:`,
          {
            parse_mode: 'Markdown',
            ...userDetailMenu
          }
        );
        trackBotMessage(chatId, sentMessage.message_id);
      }
    }

    // Manejar edición de rol
    if (action.startsWith('edit_rol_')) {
      const targetUserId = action.split('_')[2];
      const targetUser = getUserById(targetUserId);
      
      if (!targetUser) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
        return;
      }

      const rolMenu = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👤 Usuario', callback_data: `set_rol_${targetUserId}_user` },
              { text: '👑 Admin', callback_data: `set_rol_${targetUserId}_admin` }
            ],
            [
              { text: '🔙 Volver', callback_data: `user_detail_${targetUserId}` }
            ]
          ]
        }
      };

      try {
        await bot.editMessageText(
          `🎭 **Cambiar Rol de Usuario**\n\n` +
          `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
          `🎭 **Rol actual:** ${targetUser.rol}\n\n` +
          `Selecciona el nuevo rol:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...rolMenu
          }
        );
      } catch (error) {
        console.error('Error al mostrar menú de rol:', error);
      }
    }

    // Manejar establecimiento de rol
    if (action.startsWith('set_rol_')) {
      const parts = action.split('_');
      const targetUserId = parts[2];
      const newRol = parts[3];
      
      try {
        updateUserRol(targetUserId, newRol);
        await bot.answerCallbackQuery(query.id, { 
          text: `✅ Rol actualizado a ${newRol}` 
        });
        
        // Volver a mostrar detalles del usuario
        const updatedUser = getUserById(targetUserId);
        const rolEmoji = updatedUser.rol === 'admin' ? '👑' : '👤';
        const estadoEmoji = updatedUser.estado === '1' ? '✅' : '❌';
        
        const userDetailMenu = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✏️ Editar Rol', callback_data: `edit_rol_${targetUserId}` },
                { text: '🆔 Editar DNI', callback_data: `edit_dni_${targetUserId}` }
              ],
              [
                { text: '🗑️ Eliminar Usuario', callback_data: `delete_user_${targetUserId}` }
              ],
              [
                { text: '🔙 Volver a Lista', callback_data: 'admin_users' }
              ]
            ]
          }
        };

        await bot.editMessageText(
          `👤 **Detalles del Usuario**\n\n` +
          `${rolEmoji} **Nombre:** ${updatedUser.nombre || 'No especificado'}\n` +
          `🆔 **DNI:** ${updatedUser.dni || 'No especificado'}\n` +
          `📱 **Telegram ID:** ${updatedUser.chat_id}\n` +
          `🎭 **Rol:** ${updatedUser.rol}\n` +
          `${estadoEmoji} **Estado:** ${updatedUser.estado === '1' ? 'Activo' : 'Inactivo'}\n\n` +
          `✅ **Rol actualizado exitosamente**\n\n` +
          `Selecciona una acción:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...userDetailMenu
          }
        );
      } catch (error) {
        console.error('Error al actualizar rol:', error);
        await bot.answerCallbackQuery(query.id, { 
          text: '❌ Error al actualizar rol' 
        });
      }
    }

    // Manejar edición de DNI
    if (action.startsWith('edit_dni_')) {
      const targetUserId = action.split('_')[2];
      const targetUser = getUserById(targetUserId);
      
      if (!targetUser) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
        return;
      }

      // Guardar el estado para esperar el nuevo DNI
      if (!userSessions.has(chatId)) {
        userSessions.set(chatId, {});
      }
      userSessions.get(chatId).waitingForDni = targetUserId;

      try {
        await bot.editMessageText(
          `🆔 **Editar DNI de Usuario**\n\n` +
          `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
          `🆔 **DNI actual:** ${targetUser.dni || 'No especificado'}\n\n` +
          `📝 **Envía el nuevo DNI:**`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Cancelar', callback_data: `user_detail_${targetUserId}` }]
              ]
            }
          }
        );
      } catch (error) {
        console.error('Error al mostrar edición de DNI:', error);
      }
    }

    // Manejar eliminación de usuario
    if (action.startsWith('delete_user_')) {
      const targetUserId = action.split('_')[2];
      const targetUser = getUserById(targetUserId);
      
      if (!targetUser) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
        return;
      }

      const confirmMenu = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Sí, Eliminar', callback_data: `confirm_delete_${targetUserId}` },
              { text: '❌ Cancelar', callback_data: `user_detail_${targetUserId}` }
            ]
          ]
        }
      };

      try {
        await bot.editMessageText(
          `🗑️ **Confirmar Eliminación**\n\n` +
          `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
          `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
          `📱 **Telegram ID:** ${targetUser.chat_id}\n\n` +
          `⚠️ **¿Estás seguro de que quieres eliminar este usuario?**\n` +
          `Esta acción no se puede deshacer.`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...confirmMenu
          }
        );
      } catch (error) {
        console.error('Error al mostrar confirmación de eliminación:', error);
      }
    }

    // Manejar confirmación de eliminación
    if (action.startsWith('confirm_delete_')) {
      const targetUserId = action.split('_')[2];
      
      try {
        deleteUser(targetUserId);
        await bot.answerCallbackQuery(query.id, { 
          text: '✅ Usuario eliminado exitosamente' 
        });
        
        // Volver a la lista de usuarios
        const { listUsers } = require('../../db/index');
        const users = listUsers();
        const userButtons = [];
        
        users.forEach(u => {
          const rolEmoji = u.rol === 'admin' ? '👑' : '👤';
          const estadoEmoji = u.estado === '1' ? '✅' : '❌';
          userButtons.push([{ 
            text: `${rolEmoji} ${u.nombre || 'Sin nombre'} ${estadoEmoji}`, 
            callback_data: `user_detail_${u.chat_id}` 
          }]);
        });
        
        userButtons.push([{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]);
        
        await bot.editMessageText(
          '👥 **Lista de Usuarios**\n\n✅ **Usuario eliminado exitosamente**\n\nSelecciona un usuario para ver su reporte detallado:',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: userButtons }
          }
        );
      } catch (error) {
        console.error('Error al eliminar usuario:', error);
        await bot.answerCallbackQuery(query.id, { 
          text: '❌ Error al eliminar usuario' 
        });
      }
    }
    

    // ... existing code ...

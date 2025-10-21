const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions, trackBotMessage, clearUserSession } = require('../utils/session');
const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');
const consultasMenu = require('../menus/consultasMenu');
const { tiendaWebApp } = require('../menus/shopMenu');
const reportsMenu = require('../menus/reportsMenu');

module.exports = function messageHandler(bot) {
  // Handler para fotos (proceso de autorización)
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      
      // Si el usuario no existe, verificar si está intentando usar "🚀 Iniciar"
      if (!user) {
        if (text === '🚀 Iniciar') {
          await bot.sendMessage(chatId, 
            '❌ **Acceso no autorizado**\n\n' +
            'Tu cuenta no está registrada o ha sido eliminada.\n\n' +
            'Para registrarte o volver a acceder, usa el comando: /start',
            { parse_mode: 'Markdown' }
          );
        }
        return; // Ignorar otros mensajes si el usuario no existe
      }

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      console.log(`[FOTO DEBUG] Usuario encontrado: ${user.nombre}, chatId: ${chatId}`);
      console.log(`[FOTO DEBUG] userSessions.has(${chatId}):`, userSessions.has(chatId));

      // Verificar si el usuario está en proceso de autorización
      if (!userSessions.has(chatId)) {
        console.log(`[FOTO DEBUG] No hay sesión activa para chatId: ${chatId}`);
        await bot.sendMessage(chatId, 
          '📷 Foto recibida, pero no estás en ningún proceso activo.\n\n' +
          'Si quieres crear una autorización, ve a: Consultas → Crear autorización'
        );
        return;
      }

      console.log(`[FOTO DEBUG] Sesión encontrada:`, session);
      console.log(`[FOTO DEBUG] autorizacionStep:`, session.autorizacionStep);
      
      if (!session.autorizacionStep) {
        console.log(`[FOTO DEBUG] No hay autorizacionStep en la sesión`);
        await bot.sendMessage(chatId, 
          '📷 Foto recibida, pero no estás en proceso de autorización.\n\n' +
          'Si quieres crear una autorización, ve a: Consultas → Crear autorización'
        );
        return;
      }

      // Renovar timeout de sesión
      renewSessionTimeout(bot, chatId);

      // Obtener la foto de mayor calidad
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;

      try {
        // Descargar la foto
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        
        const axios = require('axios');
        const response = await axios.get(fileUrl, { 
          responseType: 'arraybuffer',
          timeout: 30000 
        });
        
        const photoBuffer = Buffer.from(response.data);

        if (session.autorizacionStep === 'esperando_firma') {
          // Guardar la firma
          session.autorizacionData.firma = {
            buffer: photoBuffer,
            filename: `firma_${user.dni}.jpg`
          };
          
          // Cambiar al siguiente paso
          session.autorizacionStep = 'esperando_huella';

          await bot.sendMessage(chatId,
            '✅ **Firma recibida correctamente**\n\n' +
            '👆 **Paso 2 de 2: Huella dactilar**\n\n' +
            '📋 **Instrucciones:**\n' +
            '• Coloca tu dedo índice en una superficie blanca\n' +
            '• Toma una foto clara de tu huella\n' +
            '• Asegúrate de que se vean las líneas claramente\n' +
            '• Evita sombras o reflejos\n\n' +
            '📷 **Envía la foto de tu huella ahora:**',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
                ]
              }
            }
          );

        } else if (session.autorizacionStep === 'esperando_huella') {
          // Guardar la huella
          session.autorizacionData.huella = {
            buffer: photoBuffer,
            filename: `huella_${user.dni}_${Date.now()}.jpg`
          };
          
          // Cambiar al paso de confirmación
          session.autorizacionStep = 'confirmacion';

          await bot.sendMessage(chatId,
            '✅ **Huella recibida correctamente**\n\n' +
            '📋 **Resumen de tu autorización:**\n' +
            `👤 **Nombre:** ${user.nombre}\n` +
            `🆔 **DNI:** ${user.dni}\n` +
            `📝 **Firma:** ✅ Recibida\n` +
            `👆 **Huella:** ✅ Recibida\n` +
            `📅 **Fecha:** ${new Date().toLocaleDateString('es-ES')}\n\n` +
            '⚠️ **¿Confirmas que quieres enviar esta autorización?**\n' +
            'Una vez enviada no podrás modificarla.',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Confirmar y enviar', callback_data: 'autorizacion_enviar' }],
                  [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
                ]
              }
            }
          );

        } else {
          await bot.sendMessage(chatId, 
            '❌ Estado de proceso inválido. Por favor reinicia el proceso.',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
                ]
              }
            }
          );
        }

      } catch (downloadError) {
        console.error('Error descargando foto:', downloadError);
        await bot.sendMessage(chatId,
          '❌ **Error al procesar la foto**\n\n' +
          'No se pudo descargar o procesar la imagen.\n' +
          'Por favor, intenta enviar la foto nuevamente.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
              ]
            }
          }
        );
      }

    } catch (error) {
      console.error('Error en handler de fotos:', error);
      await bot.sendMessage(chatId,
        '❌ Error interno al procesar la foto. Intenta nuevamente.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    }
  });

  // Handler para documentos
  bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      if (!user) return;

      // Verificar si hay una alerta de sesión activa
      let session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '📄 <b>Documento recibido</b>\n\n' +
        'Actualmente solo procesamos fotos para el proceso de autorización.\n\n' +
        'Si necesitas enviar una imagen, por favor envíala como foto, no como documento.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de documentos:', error);
    }
  });

  // Handler para videos
  bot.on('video', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      if (!user) return;

      // Verificar si hay una alerta de sesión activa
      let session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '🎥 <b>Video recibido</b>\n\n' +
        'Actualmente solo procesamos fotos para el proceso de autorización.\n\n' +
        'Si necesitas enviar una imagen de tu firma o huella, por favor envíala como foto.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de videos:', error);
    }
  });

  // Handler para audios
  bot.on('audio', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      if (!user) return;

      // Verificar si hay una alerta de sesión activa
      let session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '🎤 <b>Audio recibido</b>\n\n' +
        'Actualmente no procesamos mensajes de audio.\n\n' +
        'Usa el menú de abajo para navegar por las opciones disponibles.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de audios:', error);
    }
  });

  // Handler para stickers
  bot.on('sticker', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      
      if (!user) {
        return; // Usuario no registrado, ignorar
      }

      // Verificar si hay una alerta de sesión activa
      let session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '😄 <b>Sticker recibido</b>\n\n' +
        '¡Gracias por el sticker! Usa el menú de abajo para navegar por las opciones disponibles.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de stickers:', error);
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignorar comandos, fotos, documentos, videos, audios, voces, stickers y animaciones
    if (!text || text.startsWith('/') || msg.photo || msg.document || msg.video || msg.audio || msg.voice || msg.sticker || msg.animation) {
      return;
    }
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');

    try {
      const user = await userApiService.getUser(chatId);
      
      // Si el usuario no existe, no procesar el mensaje (está en proceso de registro)
      if (!user) {
        return; // Simplemente ignorar el mensaje sin mostrar error
      }

      // Verificar si hay una alerta de sesión activa
      let session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Manejar búsqueda de administradores
      if (userSessions.has(chatId) && userSessions.get(chatId).waitingForAdminSearch) {
        try {
          const usersResponse = await userApiService.listUsers({ page: 1 });
          const users = usersResponse.usuarios || [];
          const admins = users.filter(u => u.role_id === 1);
          
          // Buscar por nombre o DNI
          const searchResults = admins.filter(admin => 
            (admin.nombre && admin.nombre.toLowerCase().includes(text.toLowerCase())) ||
            (admin.dni && admin.dni.includes(text))
          );
          
          // Limpiar el estado de búsqueda
          userSessions.get(chatId).waitingForAdminSearch = false;
          
          if (searchResults.length > 0) {
            const userButtons = [];
            searchResults.forEach(admin => {
              userButtons.push([{ 
                text: `👑 ${admin.nombre || 'Sin nombre'}`, 
                callback_data: `admin_detail_${admin.id}` 
              }]);
            });
            
            userButtons.push([{ text: '🔙 Volver a Administradores', callback_data: 'admin_type_menu' }]);
            
            await bot.sendMessage(chatId,
              `🔍 **Resultados de Búsqueda**\n\n` +
              `Se encontraron ${searchResults.length} administrador(es) con "${text}":\n\n` +
              `Selecciona un administrador para ver sus detalles:`,
              {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: userButtons }
              }
            );
          } else {
            await bot.sendMessage(chatId,
              `❌ **Sin Resultados**\n\n` +
              `No se encontraron administradores con "${text}".\n\n` +
              `Intenta con otro término de búsqueda.`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔍 Buscar de nuevo', callback_data: 'search_admin' }],
                    [{ text: '🔙 Volver a Administradores', callback_data: 'admin_type_menu' }]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error('Error al buscar administradores:', error);
          await bot.sendMessage(chatId,
            '❌ **Error de búsqueda**\n\nNo se pudo realizar la búsqueda. Inténtalo nuevamente.',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Administradores', callback_data: 'admin_type_menu' }]
                ]
              }
            }
          );
        }
        return;
      }

      // Manejar búsqueda de usuarios
      if (userSessions.has(chatId) && userSessions.get(chatId).waitingForUserSearch) {
        try {
          const usersResponse = await userApiService.listUsers({ page: 1 });
          const users = usersResponse.usuarios || [];
          const normalUsers = users.filter(u => u.role_id !== 1);
          
          // Buscar por nombre o DNI
          const searchResults = normalUsers.filter(user => 
            (user.nombre && user.nombre.toLowerCase().includes(text.toLowerCase())) ||
            (user.dni && user.dni.includes(text))
          );
          
          // Limpiar el estado de búsqueda
          userSessions.get(chatId).waitingForUserSearch = false;
          
          if (searchResults.length > 0) {
            const userButtons = [];
            searchResults.forEach(normalUser => {
              userButtons.push([{ 
                text: `👤 ${normalUser.nombre || 'Sin nombre'}`, 
                callback_data: `user_detail_${normalUser.id}` 
              }]);
            });
            
            userButtons.push([{ text: '🔙 Volver a Usuarios', callback_data: 'user_type_menu' }]);
            
            await bot.sendMessage(chatId,
              `🔍 **Resultados de Búsqueda**\n\n` +
              `Se encontraron ${searchResults.length} usuario(s) con "${text}":\n\n` +
              `Selecciona un usuario para ver sus detalles:`,
              {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: userButtons }
              }
            );
          } else {
            await bot.sendMessage(chatId,
              `❌ **Sin Resultados**\n\n` +
              `No se encontraron usuarios con "${text}".\n\n` +
              `Intenta con otro término de búsqueda.`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔍 Buscar de nuevo', callback_data: 'search_user' }],
                    [{ text: '🔙 Volver a Usuarios', callback_data: 'user_type_menu' }]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error('Error al buscar usuarios:', error);
          await bot.sendMessage(chatId,
            '❌ **Error de búsqueda**\n\nNo se pudo realizar la búsqueda. Inténtalo nuevamente.',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Usuarios', callback_data: 'user_type_menu' }]
                ]
              }
            }
          );
        }
        return;
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

      // Manejar generación de autorización por DNI (admin)
      if (userSessions.has(chatId) && userSessions.get(chatId).adminAction === 'generar_autorizacion') {
        // Validar DNI (solo números, entre 6 y 12 caracteres)
        if (!text || !/^\d{6,12}$/.test(text)) {
          await bot.sendMessage(chatId, 
            '❌ **DNI inválido**\n\n' +
            'El DNI debe contener solo números y tener entre 6 y 12 dígitos.\n\n' +
            '📋 Ejemplo: 12345678\n\n' +
            'Inténtalo nuevamente:',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }]
                ]
              }
            }
          );
          return;
        }

        try {
          // Buscar usuario por DNI
          const axios = require('axios');
          const backendUrl = process.env.BACKEND_BASE_URL;
          const response = await axios.get(`${backendUrl}/users/dni/${text}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY
            }
          });

          if (response.data.success && response.data.usuario) {
            const userData = response.data.usuario;
            
            // Limpiar la sesión de admin
            userSessions.delete(chatId);
            
            // Mostrar confirmación con datos del usuario
            await bot.sendMessage(chatId,
              '👤 **Usuario Encontrado**\n\n' +
              `📛 **Nombre:** ${userData.nombre}\n` +
              `🆔 **DNI:** ${userData.dni}\n` +
              `📱 **Telegram ID:** ${userData.telegram_id}\n` +
              `🏢 **Sede:** ${userData.sede || 'Sin sede'}\n\n` +
              '❓ **¿Deseas generar una autorización para este usuario?**',
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '✅ Generar Autorización', callback_data: `admin_confirmar_autorizacion_${text}` }],
                    [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }],
                    [{ text: '🔙 Volver', callback_data: 'admin_generador_menu' }]
                  ]
                }
              }
            );
          } else {
            await bot.sendMessage(chatId, 
              '❌ **Usuario no encontrado**\n\n' +
              `No se encontró ningún usuario con el DNI: ${text}\n\n` +
              'Verifica que el DNI sea correcto e inténtalo nuevamente:',
              { 
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error('Error al buscar usuario por DNI:', error);
          await bot.sendMessage(chatId, 
            '❌ **Error de Conexión**\n\n' +
            'No se pudo conectar con el servidor para buscar el usuario.\n\n' +
            'Inténtalo más tarde.',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_generar_autorizacion' }],
                  [{ text: '🔙 Volver al Menú', callback_data: 'admin_generador_menu' }]
                ]
              }
            }
          );
        }
        return;
      }

      // Manejar generación de Compa-Venta por DNI (admin)
      if (userSessions.has(chatId) && userSessions.get(chatId).adminAction === 'generar_compaventa') {
        // Validar DNI (solo números, entre 6 y 12 caracteres)
        if (!text || !/^\d{6,12}$/.test(text)) {
          await bot.sendMessage(chatId, 
            '❌ **DNI inválido**\n\n' +
            'El DNI debe contener solo números y tener entre 6 y 12 dígitos.\n\n' +
            '📋 Ejemplo: 12345678\n\n' +
            'Inténtalo nuevamente:',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }]
                ]
              }
            }
          );
          return;
        }

        try {
          // Buscar usuario por DNI
          const axios = require('axios');
          const backendUrl = process.env.BACKEND_BASE_URL;
          const response = await axios.get(`${backendUrl}/users/dni/${text}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY
            }
          });

          if (response.data.success && response.data.usuario) {
            const userData = response.data.usuario;
            
            // Limpiar la sesión de admin
            userSessions.delete(chatId);
            
            // Mostrar confirmación con datos del usuario
            await bot.sendMessage(chatId,
              '👤 **Usuario Encontrado**\n\n' +
              `📛 **Nombre:** ${userData.nombre}\n` +
              `🆔 **DNI:** ${userData.dni}\n` +
              `📱 **Telegram ID:** ${userData.telegram_id}\n` +
              `🏢 **Sede:** ${userData.sede || 'Sin sede'}\n\n` +
              '❓ **¿Deseas generar un documento Compa-Venta para este usuario?**',
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '✅ Generar Compa-Venta', callback_data: `admin_confirmar_compaventa_${text}` }],
                    [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }],
                    [{ text: '🔙 Volver', callback_data: 'admin_generador_menu' }]
                  ]
                }
              }
            );
          } else {
            await bot.sendMessage(chatId, 
              '❌ **Usuario no encontrado**\n\n' +
              `No se encontró ningún usuario con el DNI: ${text}\n\n` +
              'Verifica que el DNI sea correcto e inténtalo nuevamente:',
              { 
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error('Error al buscar usuario por DNI para Compa-Venta:', error);
          await bot.sendMessage(chatId, 
            '❌ **Error de Conexión**\n\n' +
            'No se pudo conectar con el servidor para buscar el usuario.\n\n' +
            'Inténtalo más tarde.',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_generar_compaventa' }],
                  [{ text: '🔙 Volver al Menú', callback_data: 'admin_generador_menu' }]
                ]
              }
            }
          );
        }
        return;
      }

      // Renovar timeout de sesión
      renewSessionTimeout(chatId);

      // Manejar el texto del mensaje principal
      if (text === '🚀 Iniciar') {
        // Mostrar menú principal directamente
        // Crear el teclado persistente para el usuario
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
        
        // Si es administrador (role_id = 1), añadir botón de admin
        if (user.role_id === 1) {
          keyboard.push(['🔑 Panel Admin']); // Añadir fila con botón de admin
        }
        
        // Añadir botón de cerrar sesión
        keyboard.push(['🚪 Cerrar Sesión']);
        
        const replyKeyboard = {
          reply_markup: { keyboard: keyboard, resize_keyboard: true }
        };
        
        await bot.sendMessage(chatId,
          `¡Hola ${user.nombre}! 👋\n\nUsa el menú de abajo para navegar.`, replyKeyboard);
        
        return;
      } else if (text === '👤 Perfil') {
        // Mostrar perfil del usuario (sin menú inline, mantener teclado persistente)
        await bot.sendMessage(chatId, 
          `👤 **Tu Perfil**\n\n` +
          `📛 **Nombre:** ${user.nombre || 'No especificado'}\n` +
          `🆔 **DNI:** ${user.dni || 'No especificado'}\n` +
          `📱 **Telegram ID:** ${user.telegram_id}\n` +
          `🏢 **Sede:** ${user.sede || 'Sin sede'}\n` +
          `👑 **Rol:** ${user.role_id === 1 ? 'Administrador' : 'Usuario'}`,
          { 
            parse_mode: 'Markdown'
          }
        );
      } else if (text === '📝 Consultas') {
        // Mostrar menú de consultas (con submenú inline)
        await bot.sendMessage(chatId, 
          '📝 **Mis Consultas**\n\nSelecciona una opción:',
          { 
            parse_mode: 'Markdown',
            ...consultasMenu()
          }
        );
      } else if (text === '🛒 Tienda') {
        console.log('Handler de Tienda ejecutado para usuario:', user.nombre);
        try {
          // Mostrar tienda (con submenú inline)
          await bot.sendMessage(chatId, 
            '🛒 **Tienda**\n\nAccede a nuestros productos y servicios.',
            { 
              parse_mode: 'Markdown',
              ...tiendaWebApp()
            }
          );
          console.log('Mensaje de tienda enviado correctamente');
        } catch (error) {
          console.error('Error en handler de Tienda:', error);
          await bot.sendMessage(chatId, 
            '❌ **Error**\n\nOcurrió un error al cargar la tienda.',
            { parse_mode: 'Markdown' }
          );
        }
      } else if (text === '📊 Reportes') {
        // Mostrar reportes (solo para admins)
        if (user.role_id === 1) {
          await bot.sendMessage(chatId, 
            '📊 **Reportes**\n\nAccede a los reportes del sistema.',
            { 
              parse_mode: 'Markdown',
              ...reportsMenu(chatId)
            }
          );
        } else {
          await bot.sendMessage(chatId, 
            '❌ **Acceso Denegado**\n\nNo tienes permisos para acceder a los reportes.',
            { 
              parse_mode: 'Markdown'
            }
          );
        }
      } else if (text === '🔑 Panel Admin') {
        // Mostrar panel admin (solo para admins)
        if (user.role_id === 1) {
          await bot.sendMessage(chatId, 
            '🔑 **Panel de Administración**\n\nSelecciona una opción:',
            { 
              parse_mode: 'Markdown',
              ...adminMenu()
            }
          );
        } else {
          await bot.sendMessage(chatId, 
            '❌ **Acceso Denegado**\n\nNo tienes permisos de administrador.',
            { 
              parse_mode: 'Markdown'
            }
          );
        }
      } else if (text === '🚪 Cerrar Sesión') {
        // Cerrar sesión correctamente
        console.log(`🚪 Usuario ${user.nombre} cerrando sesión...`);
        try {
          // Limpiar sesión completa y mostrar botón Iniciar
          await clearUserSession(bot, chatId, true); // skipFinalMessage = true
          
          // Enviar mensaje de despedida con botón Iniciar
          await bot.sendMessage(chatId, 
            '👋 **Sesión Cerrada**\n\nHasta luego. Presiona "🚀 Iniciar" para volver a comenzar.',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [['🚀 Iniciar']], 
                resize_keyboard: true 
              }
            }
          );
          console.log(`✅ Sesión cerrada correctamente para ${user.nombre}`);
        } catch (error) {
          console.error('Error al cerrar sesión:', error);
          await bot.sendMessage(chatId, 
            '❌ **Error**\n\nOcurrió un error al cerrar la sesión. Usa /start para reiniciar.',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [['🚀 Iniciar']], 
                resize_keyboard: true 
              }
            }
          );
        }
      } else {
        // Mensaje no reconocido (sin menú inline, mantener teclado persistente)
        await bot.sendMessage(chatId, 
          '❓ **Comando no reconocido**\n\n' +
          'Por favor, utiliza los botones del menú para navegar.',
          { 
            parse_mode: 'Markdown'
          }
        );
      }

    } catch (error) {
      console.error('Error en messageHandler:', error);
      await bot.sendMessage(chatId, 
        '❌ **Error interno**\n\nOcurrió un error al procesar tu mensaje. Inténtalo nuevamente.',
        { parse_mode: 'Markdown' }
      );
    }
  });
};

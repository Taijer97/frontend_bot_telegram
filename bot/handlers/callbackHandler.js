const path = require('path');
const fs = require('fs');
const axios = require('axios');
const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions, clearUserSession } = require('../utils/session');
const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');
const usersManagementMenu = require('../menus/usersMenu');
const { shopManagementMenu, tiendaWebApp } = require('../menus/shopMenu');
const reportsMenu = require('../menus/reportsMenu');
const { getChatStats, cleanOldMessages } = require('../utils/chatManager');
const consultasMenu = require('../menus/consultasMenu'); // Nueva importación

module.exports = function callbackHandler(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const action = data; // Asignar data a action para compatibilidad con el código existente

    console.log(`📞 Callback recibido: ${data} de usuario: ${chatId}`);

    // Responder al callback query para evitar el loading
    await bot.answerCallbackQuery(query.id);

    try {
      // Obtener usuario actual
      const user = await userApiService.getUser(chatId);

      // Navegación principal
      if (action === 'main_menu') {
        await bot.editMessageText(
          'Menú Principal',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            ...mainMenu(user)
          }
        );
      }

      // Perfil de usuario
      else if (action === 'perfil') {
        if (user) {
          await bot.editMessageText(
            `👤 **Tu Perfil**\n\n` +
            `**Nombre:** ${user.nombre}\n` +
            `**DNI:** ${user.dni}\n` +
            `**Rol:** ${user.rol}\n`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver al Menú Principal', callback_data: 'main_menu' }]
                ]
              }
            }
          );
        } else {
          await bot.editMessageText(
            '❌ No se pudo cargar tu perfil. Intenta de nuevo.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver al Menú Principal', callback_data: 'main_menu' }]
                ]
              }
            }
          );
        }
      }

      // Consulta - Mostrar menú de consultas
      else if (action === 'consulta') {
        try {
          await bot.editMessageText(
            '📝 **Mis Consultas**\n\n' +
            'Selecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...consultasMenu()
            }
          );
        } catch (error) {
          console.error('Error mostrando menú de consultas:', error);
          await bot.sendMessage(chatId, 
            '📝 **Mis Consultas**\n\nSelecciona una opción:', 
            { parse_mode: 'Markdown', ...consultasMenu() }
          );
        }
      }

      // Consulta - Ver reporte (generar)
      else if (action === 'consulta_reporte') {
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
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const res = await axios.post(
              `${shopUrl}/pdf/generate-and-download`,
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
            
            // Enviar menú de consultas nuevamente
            setTimeout(async () => {
              try {
                await bot.deleteMessage(chatId, loadingMessageId);
                await bot.sendMessage(chatId, 
                  '📝 **Mis Consultas**\n\n¿Necesitas algo más?', 
                  { parse_mode: 'Markdown', ...consultasMenu() }
                );
              } catch (err) {
                // Ignorar si no se puede eliminar
              }
            }, 3000);
            
          } catch (err) {
            // Detener animación en caso de error
            clearInterval(loadingInterval);
            
            console.error('❌ Error generando reporte:', err.message);
            
            // Actualizar mensaje con error y botón para volver
            await bot.editMessageText(
              '❌ Error generando el reporte. Intenta nuevamente.',
              {
                chat_id: chatId,
                message_id: loadingMessageId,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: 'consulta_reporte' }],
                    [{ text: '🔙 Volver', callback_data: 'consulta' }]
                  ]
                }
              }
            );
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
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const res = await axios.post(
              `${shopUrl}/pdf/generate-and-download`,
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
            
            // Enviar menú de consultas
            await bot.sendMessage(chatId, 
              '📝 **Mis Consultas**\n\n¿Necesitas algo más?', 
              { parse_mode: 'Markdown', ...consultasMenu() }
            );
          } catch (err) {
            console.error('❌ Error generando reporte:', err.message);
            await bot.sendMessage(chatId, 
              '❌ Error generando el reporte.',
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: 'consulta_reporte' }],
                    [{ text: '🔙 Volver', callback_data: 'consulta' }]
                  ]
                }
              }
            );
          }
        }
      }

      // Consulta - Ver crédito accesible
      else if (action === 'consulta_credito') {
        let loadingMessageId;
        
        try {
          // Mostrar mensaje de carga inicial
          const loadingMessage = await bot.editMessageText('⏳ Evaluando crédito', {
            chat_id: chatId,
            message_id: query.message.message_id
          });
          loadingMessageId = loadingMessage.message_id;
          
          // Animación de carga dinámica
          const loadingFrames = ['💳', '💰', '📊', '🔍'];
          const loadingTexts = [
            'Consultando historial crediticio',
            'Analizando capacidad de pago',
            'Evaluando reglas de negocio',
            'Calculando monto disponible'
          ];
          let frameIndex = 0;
          
          const loadingInterval = setInterval(async () => {
            try {
              await bot.editMessageText(
                `${loadingFrames[frameIndex]} ${loadingTexts[frameIndex]}${'.'.repeat((frameIndex % 3) + 1)}`,
                {
                  chat_id: chatId,
                  message_id: loadingMessageId
                }
              );
              frameIndex = (frameIndex + 1) % loadingFrames.length;
            } catch (err) {
              // Ignorar errores de edición durante la animación
            }
          }, 1500);

          try {
            // Consultar crédito usando la API real
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const response = await axios.post(
              `${shopUrl}/evaluar_credito/evaluar_credito`,
              { dni: user.dni },
              { 
                timeout: 30000,
                headers: {
                  'Content-Type': 'application/json'
                }
              }
            );
            
            // Detener animación
            clearInterval(loadingInterval);
            
            const creditoData = response.data;
            
            // Función para escapar caracteres HTML
            const escapeHtml = (text) => {
              if (typeof text !== 'string') return String(text);
              return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            };
            
            // Función para formatear números
            const formatNumber = (num) => {
              if (typeof num === 'number') {
                return num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              }
              return String(num);
            };
            
            let mensaje = '💳 <b>Evaluación de Crédito</b>\n\n';
            mensaje += `👤 <b>DNI:</b> ${escapeHtml(creditoData.dni)}\n\n`;
            
            if (creditoData.encontrado) {
              // Información financiera
              mensaje += `💰 <b>Monto Total:</b> S/${formatNumber(creditoData.monto_total)}\n`;
              mensaje += `💳 <b>Cuota Mensual:</b> S/${formatNumber(creditoData.cuota)}\n`;
              mensaje += `💸 <b>Por Pagar:</b> S/${formatNumber(creditoData.por_pagar)}\n\n`;
              
              // Evaluación de reglas
              mensaje += `📋 <b>Evaluación de Reglas:</b>\n`;
              mensaje += `• Deuda Menor al 50%: ${creditoData.regla_A ? '✅' : '❌'}\n`;
              mensaje += `• Salieron ultimos descuentes: ${creditoData.regla_B ? '✅' : '❌'}\n`;
              mensaje += `• Salieron descuentos completos: ${creditoData.regla_C ? '✅' : '❌'}\n\n`;
              
              // Historial de últimos 3 pagos
              
              
              // Decisión final
              const decisionEmoji = creditoData.decision_final === 'APROBADO' ? '✅' : 
                                   creditoData.decision_final === 'NEGADO' ? '❌' : '⚠️';
              mensaje += `🎯 <b>Su Credito esta:</b> ${decisionEmoji} ${escapeHtml(creditoData.decision_final)}\n\n`;
              
              // Mensaje adicional según la decisión
              if (creditoData.decision_final === 'APROBADO') {
                mensaje += `🎉 ¡Felicidades! Tienes crédito disponible.\n`;
                mensaje += `🛒 Puedes realizar compras en nuestra tienda.`;
              } else if (creditoData.decision_final === 'NEGADO') {
                mensaje += `😔 Lo sentimos, no tienes crédito disponible en este momento.\n`;
                mensaje += `📞 Contacta a un agente para más información.`;
              }
              
              // Información adicional si existe
              if (creditoData.message) {
                mensaje += `\n\n📝 <b>Información:</b> ${escapeHtml(creditoData.message)}`;
              }
              
            } else {
              mensaje += `❌ <b>No encontrado</b>\n\n`;
              mensaje += `No se encontró información crediticia para el DNI ${escapeHtml(creditoData.dni)}.\n`;
              mensaje += `📞 Contacta a un agente para más información.`;
            }

            // Botones según la decisión
            let keyboard = [];
            
            if (creditoData.encontrado && creditoData.decision_final === 'APROBADO') {
              keyboard = [
                [{ text: '🛒 Ir a Tienda', callback_data: 'tienda' }],
                [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
                [{ text: '🔙 Volver', callback_data: 'consulta' }],
                [{ text: '🏠 Menú Principal', callback_data: 'main_menu' }]
              ];
            } else {
              keyboard = [
                [{ text: '📞 Contactar Agente', url: 'https://wa.me/1234567890' }], // Cambiar por número real
                [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
                [{ text: '🔙 Volver', callback_data: 'consulta' }],
                [{ text: '🏠 Menú Principal', callback_data: 'main_menu' }]
              ];
            }

            await bot.editMessageText(mensaje, {
              chat_id: chatId,
              message_id: loadingMessageId,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: keyboard
              }
            });
            
          } catch (apiError) {
            // Detener animación en caso de error
            clearInterval(loadingInterval);
            
            console.error('❌ Error consultando crédito:', apiError.message);
            
            let errorMessage = '❌ <b>Error consultando el crédito</b>\n\n';
            
            if (apiError.code === 'ECONNABORTED' || apiError.message.includes('timeout')) {
              errorMessage += '⏱️ La consulta está tardando más de lo esperado.\n';
              errorMessage += 'El servidor puede estar sobrecargado.';
            } else if (apiError.message.includes('ENOTFOUND') || apiError.message.includes('ECONNREFUSED')) {
              errorMessage += '🔌 No se puede conectar con el servidor de créditos.\n';
              errorMessage += 'Verifica que el servicio esté disponible.';
            } else if (apiError.response && apiError.response.status) {
              errorMessage += `🔧 Error del servidor: ${apiError.response.status}\n`;
              errorMessage += 'Contacta al administrador si el problema persiste.';
            } else {
              errorMessage += '🔧 Error técnico del sistema.\n';
              errorMessage += 'Inténtalo nuevamente en unos momentos.';
            }
            
            await bot.editMessageText(errorMessage, {
              chat_id: chatId,
              message_id: loadingMessageId,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: 'consulta_credito' }],
                  [{ text: '🔙 Volver', callback_data: 'consulta' }],
                  [{ text: '🏠 Menú Principal', callback_data: 'main_menu' }]
                ]
              }
            });
          }
          
        } catch (error) {
          console.error('Error en consulta_credito:', error);
          
          // Si hay un error, intentar sin Markdown
          try {
            await bot.sendMessage(chatId, 
              '❌ Error consultando el crédito. Intenta nuevamente.',
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: 'consulta_credito' }],
                    [{ text: '🔙 Volver', callback_data: 'consulta' }]
                  ]
                }
              }
            );
          } catch (fallbackError) {
            console.error('Error en fallback:', fallbackError);
          }
        }
      }

      // Tienda
      else if (action === 'tienda') {
        await bot.editMessageText(
          '🛒 **Tienda**\n\nBienvenido a nuestra tienda online.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...tiendaWebApp()
          }
        );
      }

      // Panel de administración
      else if (action === 'admin') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '🔐 **Panel de Administración**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...adminMenu()
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Gestión de usuarios
      else if (action === 'admin_users') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '👥 **Gestión de Usuarios**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...usersManagementMenu(chatId)
            }
          );
        }
      }

      // Lista de usuarios
      else if (action === 'users_list') {
        if (user && user.role_id === 1) {
          try {
            const usersResponse = await userApiService.listUsers({ page: 1 });
            
            // Usar la estructura correcta del backend
            const users = usersResponse.usuarios || [];
            const totalUsuarios = usersResponse.total_usuarios || 0;
            const userButtons = [];
            
            if (Array.isArray(users) && users.length > 0) {
              users.forEach(u => {
                const rolEmoji = u.role_id === 1 ? '👑' : '👤';
                userButtons.push([{ 
                  text: `${rolEmoji} ${u.nombre || 'Sin nombre'}`, 
                  callback_data: `user_detail_${u.id}` 
                }]);
              });
            } else {
              userButtons.push([{ text: '📝 No hay usuarios registrados', callback_data: 'admin_users' }]);
            }
            
            userButtons.push([{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]);
            
            await bot.editMessageText(
              `👥 **Lista de Usuarios** (${totalUsuarios} total)\n\nSelecciona un usuario para ver su reporte detallado:`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: userButtons }
              }
            );
          } catch (error) {
            console.error('Error al obtener lista de usuarios:', error);
            await bot.editMessageText(
              '❌ **Error**\n\nNo se pudo obtener la lista de usuarios. Verifica la conexión con el backend.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'admin_users' }]]
                }
              }
            );
          }
        }
      }

      // Navegación home
      else if (action === 'nav_home') {
        await bot.editMessageText(
          'Menú Principal',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            ...mainMenu(user)
          }
        );
      }

      // Gestión de usuarios
      else if (action === 'admin_users') {
        if (user && user.rol === 'admin') {
          await bot.editMessageText(
            '👥 **Gestión de Usuarios**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...usersManagementMenu(chatId)
            }
          );
        }
      }

      // Lista de usuarios
      else if (action === 'users_list') {
        if (user && user.rol === 'admin') {
          try {
            const usersResponse = await userApiService.listUsers({ limit: 50 });
            const users = usersResponse.users || usersResponse.data || usersResponse;
            const userButtons = [];
            
            if (Array.isArray(users) && users.length > 0) {
              users.forEach(u => {
                const rolEmoji = u.rol === 'admin' ? '👑' : '👤';
                const estadoEmoji = u.estado === 'activo' ? '🟢' : '🔴';
                userButtons.push([{ 
                  text: `${rolEmoji} ${u.nombre || 'Sin nombre'} ${estadoEmoji}`, 
                  callback_data: `user_detail_${u.id || u.chat_id}` 
                }]);
              });
            } else {
              userButtons.push([{ text: '📝 No hay usuarios registrados', callback_data: 'admin_users' }]);
            }
            
            userButtons.push([{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]);
            
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
            console.error('Error al obtener lista de usuarios:', error);
            await bot.editMessageText(
              '❌ **Error**\n\nNo se pudo obtener la lista de usuarios. Verifica la conexión con el backend.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver', callback_data: 'admin_users' }]
                  ]
                }
              }
            );
          }
        }
      }

      // Gestión de tienda
      else if (action === 'admin_shop') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '🛒 **Gestión de Tienda**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...shopManagementMenu(chatId)
            }
          );
        }
      }

      // Opciones de tienda
      else if (action === 'shop_list') {
        await bot.editMessageText(
          '📦 **Lista de Productos**\n\nAquí se mostrarían los productos.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
              ]
            }
          });
      }

      else if (action === 'shop_add') {
        await bot.editMessageText(
          '➕ **Agregar Producto**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
              ]
            }
          });
      }

      else if (action === 'shop_edit') {
        await bot.editMessageText(
          '✏️ **Editar Producto**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
              ]
            }
          });
      }

      else if (action === 'shop_delete') {
        await bot.editMessageText(
          '🗑️ **Eliminar Producto**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
              ]
            }
          });
      }

      // Manejar solicitudes de crédito
      else if (action === 'shop_solicitudes') {
        try {
          const shopUrl = process.env.BACKEND_BASE_URL;
          const response = await axios.get(`${shopUrl}/shop/solicitudes-detalle/${chatId}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY,
              'ngrok-skip-browser-warning': 'true',
              'User-Agent': 'TelegramBot/1.0'
            }
          });

          const data = response.data;
          
          if (data.success && data.solicitudes && data.solicitudes.length > 0) {
            let mensaje = '📋 MIS SOLICITUDES DE CRÉDITO\n\n';
            
            // Mostrar estadísticas
            const stats = data.estadisticas;
            mensaje += `📊 RESUMEN:\n`;
            mensaje += `• Total solicitudes: ${stats.total_solicitudes}\n`;
            mensaje += `• Pendientes: ${stats.solicitudes_pendientes}\n`;
            mensaje += `• Aprobadas: ${stats.solicitudes_aprobadas}\n`;
            mensaje += `• Rechazadas: ${stats.solicitudes_rechazadas}\n`;
            mensaje += `• Monto total: S/${stats.monto_total_solicitado.toLocaleString()}\n\n`;
            mensaje += `Selecciona una solicitud para ver los detalles:`;

            // Crear botones para cada solicitud
            const solicitudButtons = [];
            data.solicitudes.forEach(solicitud => {
              const estadoEmoji = solicitud.estado === 'PENDIENTE' ? '⏳' : 
                                 solicitud.estado === 'APROBADA' ? '✅' : 
                                 solicitud.estado === 'RECHAZADA' ? '❌' : '📋';
              
              const buttonText = `Solicitud ${solicitud.id.split('_')[1]} ${estadoEmoji} ${solicitud.estado}`;
              solicitudButtons.push([{ 
                text: buttonText, 
                callback_data: `shop_solicitud_detail_${solicitud.id}` 
              }]);
            });

            // Añadir botones de navegación
            solicitudButtons.push([{ text: '🔄 Actualizar', callback_data: 'shop_solicitudes' }]);
            solicitudButtons.push([{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]);

            await bot.editMessageText(mensaje, {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: solicitudButtons
              }
            });

          } else {
            await bot.editMessageText(
              '📋 MIS SOLICITUDES DE CRÉDITO\n\n' +
              'No hay solicitudes pendientes\n\n' +
              'Visite nuestra tienda para ver nuevas novedades',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🛒 Ir a Tienda', web_app: { url: `${shopUrl}/shop/html` } }],
                    [{ text: '🔙 Volver', callback_data: 'tienda' }]
                  ]
                }
              });
          }

        } catch (error) {
          console.error('Error al obtener solicitudes:', error);
          await bot.editMessageText(
            '❌ ERROR AL CARGAR SOLICITUDES\n\n' +
            'No se pudieron obtener las solicitudes de crédito.\n' +
            'Inténtalo nuevamente más tarde.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: 'shop_solicitudes' }],
                  [{ text: '🔙 Volver', callback_data: 'tienda' }]
                ]
              }
            });
        }
      }

      // Manejar detalles de solicitud específica
      else if (action.startsWith('shop_solicitud_detail_')) {
        try {
          const solicitudId = action.replace('shop_solicitud_detail_', '');
          const shopUrl = process.env.BACKEND_BASE_URL;
          
          // Obtener todas las solicitudes para encontrar la específica
          const response = await axios.get(`${shopUrl}/shop/solicitudes-detalle/${chatId}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY,
              'ngrok-skip-browser-warning': 'true',
              'User-Agent': 'TelegramBot/1.0'
            }
          });

          const data = response.data;
          
          const solicitud = data.solicitudes.find(s => s.id === solicitudId);

          if (solicitud) {
            
            let mensaje = '';
            let keyboard = [];

            // Manejar según el estado de la solicitud
            if (solicitud.estado === 'PENDIENTE') {
              mensaje = `⏳ SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Su solicitud aun esta siendo revisada`;
              
              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];

            } else if (solicitud.estado === 'RECHAZADA') {
              mensaje = `❌ SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Lo sentimos por ahora no es posible realizar una ampliacion con su peticion o contactese a un agente de ventas`;
              
              keyboard = [
                [{ text: '📞 Contactar Agente', url: 'https://wa.me/1234567890' }], // Cambiar por el número real
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];

            } else if (solicitud.estado === 'APROBADA') {
              // Solo si está aprobada, mostrar todos los detalles
              const fecha = new Date(solicitud.fecha_solicitud).toLocaleDateString('es-ES');
              
              mensaje = `✅ SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Estado: ${solicitud.estado}\n`;
              mensaje += `📅 Fecha: ${fecha}\n`;
              mensaje += `📦 Productos: ${solicitud.total_productos}\n`;
              mensaje += `📅 Financiamiento: ${solicitud.meses_financiamiento} meses\n`;
              mensaje += `💳 Cuota mensual: S/${solicitud.cuota_mensual.toLocaleString()}\n`;
              mensaje += `💰 Total: S/${solicitud.precio_total.toLocaleString()}\n`;
              mensaje += `📈 Tasa: ${solicitud.tasa_mensual}\n\n`;
              
              mensaje += `PRODUCTOS:\n`;
              if (solicitud.productos && solicitud.productos.length > 0) {
                solicitud.productos.forEach(producto => {
                  mensaje += `• ${producto.nombre} x${producto.cantidad} - S/${producto.subtotal.toLocaleString()}\n`;
                });
              }

              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];
            } else {
              // Caso por defecto para estados no reconocidos
              mensaje = `📋 SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Estado: ${solicitud.estado}\n\n`;
              mensaje += `Estado no reconocido. Contacte al administrador.`;
              
              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];
            }

            // Verificar que el mensaje no esté vacío antes de enviarlo
            if (!mensaje || mensaje.trim() === '') {
              mensaje = `📋 SOLICITUD ${solicitud.id.split('_')[1]}\n\nError: No se pudo cargar la información de la solicitud.`;
              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];
            }

            await bot.editMessageText(mensaje, {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: keyboard
              }
            });

          } else {
            await bot.editMessageText(
              '❌ ERROR\n\n' +
              'No se encontró la solicitud especificada.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '📋 Ver Solicitudes', callback_data: 'shop_solicitudes' }],
                    [{ text: '🔙 Volver', callback_data: 'tienda' }]
                  ]
                }
              });
          }

        } catch (error) {
          console.error('Error al obtener detalles de solicitud:', error);
          await bot.editMessageText(
            '❌ ERROR AL CARGAR DETALLES\n\n' +
            'No se pudieron obtener los detalles de la solicitud.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📋 Ver Solicitudes', callback_data: 'shop_solicitudes' }],
                  [{ text: '🔙 Volver', callback_data: 'tienda' }]
                ]
              }
            });
        }
      }

      // Reportes
      else if (action === 'admin_reports') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '📊 **Reportes**\n\nSelecciona un tipo de reporte:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...reportsMenu(chatId)
            }
          );
        }
      }

      else if (action === 'report_users') {
        try {
          const stats = await userApiService.getStats();
          const statsText = stats.total_users ? 
            `📊 **Estadísticas de Usuarios**\n\n` +
            `👥 **Total de usuarios:** ${stats.total_users}\n` +
            `👑 **Administradores:** ${stats.admin_users || 0}\n` +
            `👤 **Usuarios regulares:** ${stats.regular_users || 0}\n` +
            `❌ **Usuarios inactivos:** ${stats.inactive_users || 0}` :
            '📊 **Reporte de Usuarios**\n\nNo se pudieron obtener las estadísticas.';

          await bot.editMessageText(
            statsText,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
                ]
              }
            }
          );
        } catch (error) {
          await bot.editMessageText(
            '📊 **Reporte de Usuarios**\n\nError al obtener estadísticas.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
                ]
              }
            }
          );
        }
      }

      else if (action === 'report_sales') {
        await bot.editMessageText(
          '💰 **Reporte de Ventas**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
              ]
            }
          });
      }

      else if (action === 'report_activity') {
        await bot.editMessageText(
          '📈 **Reporte de Actividad**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
              ]
            }
          });
      }
      
      // Manejar estadísticas de chat
      else if (action === 'admin_chat_stats') {
        const stats = getChatStats();
        
        let statsMessage = '📊 **Estadísticas de Chat**\n\n';
        statsMessage += `👥 **Total de usuarios:** ${stats.totalUsers}\n`;
        statsMessage += `💬 **Total de mensajes:** ${stats.totalMessages}\n\n`;
        
        if (stats.totalUsers > 0) {
          statsMessage += '**Top 5 usuarios más activos:**\n';
          const sortedUsers = Object.entries(stats.userStats)
            .sort(([,a], [,b]) => b.messageCount - a.messageCount)
            .slice(0, 5);
          
          for (let i = 0; i < sortedUsers.length; i++) {
            const [userId, userData] = sortedUsers[i];
            const lastActivity = new Date(userData.lastActivity).toLocaleDateString('es-ES');
            statsMessage += `${i + 1}. Usuario ${userId}: ${userData.messageCount} mensajes (${lastActivity})\n`;
          }
        } else {
          statsMessage += 'No hay datos de usuarios disponibles.';
        }
        
        await bot.editMessageText(statsMessage, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Actualizar', callback_data: 'admin_chat_stats' }],
              [{ text: '🔙 Volver', callback_data: 'admin_menu' }]
            ]
          }
        });
      }

      // Manejar limpieza de chats antiguos
      else if (action === 'admin_clean_chats') {
        const cleaned = cleanOldMessages(7); // Limpiar mensajes de más de 7 días
        
        let cleanMessage = '🧹 **Limpieza de Chats Antiguos**\n\n';
        if (cleaned > 0) {
          cleanMessage += `✅ Se limpiaron ${cleaned} usuarios con actividad antigua (más de 7 días).\n\n`;
          cleanMessage += 'Los mensajes de estos usuarios han sido eliminados del registro.';
        } else {
          cleanMessage += '✨ No hay chats antiguos para limpiar.\n\n';
          cleanMessage += 'Todos los usuarios tienen actividad reciente.';
        }
        
        await bot.editMessageText(cleanMessage, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Limpiar de nuevo', callback_data: 'admin_clean_chats' }],
              [{ text: '📊 Ver estadísticas', callback_data: 'admin_chat_stats' }],
              [{ text: '🔙 Volver', callback_data: 'admin_menu' }]
            ]
          }
        });
      }

      // Manejar detalles de usuario específico
      else if (action.startsWith('user_detail_')) {
        const targetUserId = action.split('_')[2];
    
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            console.log('ERROR: targetUser es null o undefined');
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }
          
          // Usar la estructura correcta del backend
          const rolEmoji = targetUser.role_id === 1 ? '👑' : '👤';
          const roleName = targetUser.role_id === 1 ? 'Admin' : 'Usuario';
          

          
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
                  { text: '🔙 Volver a Lista', callback_data: 'users_list' }
                ]
              ]
            }
          };

          await bot.editMessageText(
            `👤 **Detalles del Usuario**\n\n` +
            `${rolEmoji} **Nombre:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📱 **Telegram ID:** ${targetUser.telegram_id || 'No especificado'}\n` +
            `🎭 **Rol:** ${roleName}\n` +
            `🏢 **Sede:** ${targetUser.sede || 'Sin sede'}\n` +
            `Selecciona una acción:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...userDetailMenu
            }
          );
        } catch (error) {
          console.error('Error al obtener detalles del usuario:', error);
          console.error('Error completo:', JSON.stringify(error, null, 2));
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al obtener usuario' });
        }
      }

      // Manejar edición de rol
      else if (action.startsWith('edit_rol_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Crear botón para el rol contrario al actual
          const roleButtons = [];
          const currentRoleId = targetUser.role_id;
          
          if (currentRoleId === 1) {
            // Si es admin, mostrar opción para cambiar a usuario
            roleButtons.push([{ 
              text: '👤 Cambiar a Usuario', 
              callback_data: `set_rol_${targetUserId}_2` 
            }]);
          } else {
            // Si es usuario (o cualquier otro rol), mostrar opción para cambiar a admin
            roleButtons.push([{ 
              text: '👑 Cambiar a Admin', 
              callback_data: `set_rol_${targetUserId}_1` 
            }]);
          }
          
          roleButtons.push([{ text: '🔙 Volver', callback_data: `user_detail_${targetUserId}` }]);

          const rolMenu = {
            reply_markup: {
              inline_keyboard: roleButtons
            }
          };

          // Determinar el nombre del rol actual para mostrar
          const currentRoleName = currentRoleId === 1 ? 'Admin' : 'Usuario';
          const currentRoleEmoji = currentRoleId === 1 ? '👑' : '👤';

          await bot.editMessageText(
            `🎭 **Cambiar Rol de Usuario**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `${currentRoleEmoji} **Rol actual:** ${currentRoleName}\n\n` +
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
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar roles' });
        }
      }

      // Manejar establecimiento de rol
      else if (action.startsWith('set_rol_')) {
        const parts = action.split('_');
        const targetUserId = parts[2];
        const newRoleId = parseInt(parts[3]); // Convertir a número
        
        console.log(`Intentando cambiar rol del usuario ${targetUserId} a role_id: ${newRoleId}`);
        
        try {
          // Usar la estructura correcta del backend
          const updateResult = await userApiService.updateUser(targetUserId, { role_id: newRoleId });
          console.log('Resultado de actualización:', updateResult);
          
          // Determinar el nombre del rol para el mensaje
          const roleName = newRoleId === 1 ? 'Admin' : 'Usuario';
          
          await bot.answerCallbackQuery(query.id, { 
            text: `✅ Rol actualizado a ${roleName}` 
          });
          
          // Volver a mostrar detalles del usuario
          const updatedUser = await userApiService.getUserById(targetUserId);
          console.log('Usuario actualizado completo:', JSON.stringify(updatedUser, null, 2));
          
          // Verificar si el usuario existe
          if (!updatedUser) {
            throw new Error('Usuario no encontrado después de la actualización');
          }
          
          const rolEmoji = updatedUser.role_id === 1 ? '👑' : '👤';
          const currentRoleName = updatedUser.role_id === 1 ? 'Admin' : 'Usuario';
          
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
                  { text: '🔙 Volver a Lista', callback_data: 'users_list' }
                ]
              ]
            }
          };

          await bot.editMessageText(
            `👤 **Detalles del Usuario**\n\n` +
            `${rolEmoji} **Nombre:** ${updatedUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${updatedUser.dni || 'No especificado'}\n` +
            `📱 **Telegram ID:** ${updatedUser.telegram_id || 'No especificado'}\n` +
            `🎭 **Rol:** ${currentRoleName}\n` +
            `🏢 **Sede:** ${updatedUser.sede || 'Sin sede'}\n` +
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
          console.error('Detalles del error:', error.response?.data || error.message);
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Error al actualizar rol' 
          });
        }
      }

      // Manejar edición de DNI
      else if (action.startsWith('edit_dni_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Guardar el estado para esperar el nuevo DNI
          if (!userSessions.has(chatId)) {
            userSessions.set(chatId, {});
          }
          userSessions.get(chatId).waitingForDni = targetUserId;

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
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Manejar eliminación de usuario
      else if (action.startsWith('delete_user_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
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
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Manejar confirmación de eliminación
      else if (action.startsWith('confirm_delete_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          await userApiService.deleteUser(targetUserId);
          await bot.answerCallbackQuery(query.id, { 
            text: '✅ Usuario eliminado exitosamente' 
          });
          
          // Volver a la lista de usuarios
          const usersResponse = await userApiService.listUsers({ limit: 50 });
          const users = usersResponse.users || usersResponse.data || usersResponse;
          const userButtons = [];
          
          if (Array.isArray(users) && users.length > 0) {
            users.forEach(u => {
              const rolEmoji = u.rol === 'admin' ? '👑' : '👤';
              const estadoEmoji = u.estado === 'activo' ? '🟢' : '🔴';
              userButtons.push([{ 
                text: `${rolEmoji} ${u.nombre || 'Sin nombre'} ${estadoEmoji}`, 
                callback_data: `user_detail_${u.id || u.chat_id}` 
              }]);
            });
          }
          
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

      // Manejar callbacks de sesión
      else if (action === 'session_continue') {
        await bot.editMessageText(
          '✅ Sesión renovada. ¡Continuemos!',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: '🏠 Ir al Menú Principal', callback_data: 'main_menu' }]
              ]
            }
          }
        );
        
        // Renovar la sesión
        renewSessionTimeout(bot, chatId);
      }

      else if (action === 'session_exit') {
        await bot.editMessageText(
          '👋 ¡Hasta luego! Usa /start cuando quieras volver.',
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
        
        // Limpiar la sesión después de 3 segundos
        setTimeout(async () => {
          await clearUserSession(bot, chatId);
        }, 3000);
      }

    } catch (error) {
      console.error('Error en callbackHandler:', error);
      await bot.answerCallbackQuery(query.id, { 
        text: '❌ Error interno del servidor' 
      });
    }

    // Renovar timeout de sesión
    if (userSessions.has(chatId)) {
      renewSessionTimeout(bot, chatId);
    }

    // El tracking se hace automáticamente con el botWrapper
    // Ya no necesitamos llamar trackBotMessage manualmente
  });
};


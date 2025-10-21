const { createNavigationButtons } = require('../utils/navigation');
const userApiService = require('../services/userApiService');

function usersManagementMenu(chatId) {
  const menuButtons = [
    [{ text: '👑 Administradores', callback_data: 'admin_type_menu' }],
    [{ text: '👤 Usuarios', callback_data: 'user_type_menu' }],
    [{ text: '🔙 Volver al Panel Admin', callback_data: 'admin_menu' }]
  ];
  return { reply_markup: { inline_keyboard: menuButtons } };
}

function adminTypeMenu(chatId) {
  const menuButtons = [
    [{ text: '📋 Listar Administradores', callback_data: 'list_admins' }],
    [{ text: '🔍 Buscar por Nombre o DNI', callback_data: 'search_admin' }],
    [{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]
  ];
  return { reply_markup: { inline_keyboard: menuButtons } };
}

function userTypeMenu(chatId) {
  const menuButtons = [
    [{ text: '📋 Listar Usuarios', callback_data: 'list_users' }],
    [{ text: '🔍 Buscar por Nombre o DNI', callback_data: 'search_user' }],
    [{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]
  ];
  return { reply_markup: { inline_keyboard: menuButtons } };
}

function userDetailMenu(userId, userType) {
  const menuButtons = [];
  
  // Obtener estado de autorización
  let autorizacionEstado = 'pendiente';
  try {
    const estadoData = userApiService.getAutorizacionEstado(userId);
    autorizacionEstado = estadoData.estado || 'pendiente';
  } catch (error) {
    console.log('No se pudo obtener estado de autorización, usando pendiente por defecto');
  }

  // Determinar texto y acción del botón de estado
  const botonEstadoTexto = autorizacionEstado === 'activo' ? '🔴 Desactivar Autorización' : '🟢 Activar Autorización';
  const nuevoEstado = autorizacionEstado === 'activo' ? 'pendiente' : 'activo';
  
  // Botones comunes para todos los usuarios
  menuButtons.push([{ text: '✏️ Editar Rol', callback_data: `edit_role_${userId}` }]);
  menuButtons.push([{ text: '🆔 Editar DNI', callback_data: `edit_dni_${userId}` }]);
  
  // Botón de estado de autorización
  menuButtons.push([{ 
    text: botonEstadoTexto, 
    callback_data: `change_auth_status_${userId}_${nuevoEstado}` 
  }]);
  
  // Botones para ver datos biométricos
  menuButtons.push([
    { text: '👆 Ver Huella', callback_data: `view_huella_${userId}` },
    { text: '✍️ Ver Firma', callback_data: `view_firma_${userId}` }
  ]);
  
  // Botón generador para todos los usuarios (tanto admins como usuarios normales)
  menuButtons.push([{ text: '🛠️ Generador', callback_data: `generate_auth_${userId}` }]);
  
  menuButtons.push([{ text: '🗑️ Eliminar Usuario', callback_data: `delete_user_${userId}` }]);
  
  // Botón de volver según el tipo
  const backAction = userType === 'admin' ? 'list_admins' : 'list_users';
  menuButtons.push([{ text: '🔙 Volver a Lista', callback_data: backAction }]);
  
  return { reply_markup: { inline_keyboard: menuButtons } };
}

module.exports = { 
  usersManagementMenu, 
  adminTypeMenu, 
  userTypeMenu, 
  userDetailMenu 
};

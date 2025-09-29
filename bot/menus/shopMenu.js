const { createNavigationButtons } = require('../utils/navigation');

function shopManagementMenu(chatId) {
  const menuButtons = [
    [{ text: '📦 Ver Productos', callback_data: 'shop_list' }],
    [{ text: '➕ Agregar Producto', callback_data: 'shop_add' }],
    [{ text: '✏️ Editar Producto', callback_data: 'shop_edit' }],
    [{ text: '🗑️ Eliminar Producto', callback_data: 'shop_delete' }]
  ];
  return { reply_markup: { inline_keyboard: [...menuButtons, ...createNavigationButtons(chatId, 'admin_shop')] } };
}

function tiendaWebApp() {
  const shopUrl = `${process.env.BACKEND_BASE_URL}/shop/html`;
  
  return {
    reply_markup: {
      inline_keyboard: [
        [{ 
          text: '🛒 Abrir Tienda', 
          web_app: { url: shopUrl }
        }],
        [{ 
          text: '📋 Ver Solicitudes', 
          callback_data: 'shop_solicitudes' 
        }],
        [{ text: '🔙 Volver al Menú', callback_data: 'main_menu' }]
      ]
    }
  };
}

module.exports = { shopManagementMenu, tiendaWebApp };
    
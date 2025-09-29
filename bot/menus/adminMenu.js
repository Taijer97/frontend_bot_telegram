function adminMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👥 Gestión de Usuarios', callback_data: 'admin_users' }],
        [{ text: '🛒 Gestión de Tienda', callback_data: 'admin_shop' }],
        [{ text: '🏠 Inicio', callback_data: 'nav_home' }]
      ]
    }
  };
}
module.exports = adminMenu;

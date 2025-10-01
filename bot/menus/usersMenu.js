const { createNavigationButtons } = require('../utils/navigation');

function usersManagementMenu(chatId) {
  const menuButtons = [
    [{ text: '👀 Ver Usuarios', callback_data: 'users_list' }],
    [{ text: '🔙 Volver al Panel Admin', callback_data: 'admin_menu' }]
  ];
  return { reply_markup: { inline_keyboard: menuButtons } };
}
module.exports = usersManagementMenu;

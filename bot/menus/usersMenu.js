const { createNavigationButtons } = require('../utils/navigation');

function usersManagementMenu(chatId) {
  const menuButtons = [
    [{ text: '👀 Ver Usuarios', callback_data: 'users_list' }],
  ];
  return { reply_markup: { inline_keyboard: [...menuButtons, ...createNavigationButtons(chatId, 'admin_users')] } };
}
module.exports = usersManagementMenu;

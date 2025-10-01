function mainMenu(user) {
  const keyboard = [
    [{ text: '👤 Perfil', callback_data: 'perfil' }],
    [{ text: '📝 Mis Consultas', callback_data: 'consulta' }],
    [{ text: '🛒 Tienda', callback_data: 'tienda' }]
  ];
  if (user.rol === 'admin')
    keyboard.push([{ text: '🔐 Panel Admin', callback_data: 'admin' }]);
  return { reply_markup: { inline_keyboard: keyboard } };
}
module.exports = mainMenu;

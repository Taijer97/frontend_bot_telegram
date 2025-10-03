function mainMenu(user) {
  const keyboard = [
    [{ text: '👤 Perfil', callback_data: 'perfil' }]
  ];
  
  // Solo mostrar consultas si NO es administrador
  if (user.role_id !== 1 && user.rol !== 'admin') {
    keyboard.push([{ text: '📝 Mis Consultas', callback_data: 'consulta' }]);
  }
  
  keyboard.push([{ text: '🛒 Tienda', callback_data: 'tienda' }]);
  
  // Agregar panel admin solo para administradores
  if (user.role_id === 1 || user.rol === 'admin') {
    keyboard.push([{ text: '🔐 Panel Admin', callback_data: 'admin' }]);
  }
  
  return { reply_markup: { inline_keyboard: keyboard } };
}
module.exports = mainMenu;

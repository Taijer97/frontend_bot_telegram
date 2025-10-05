const navigationStack = new Map();

function createNavigationButtons(chatId, currentScreen = null, showBack = true, showHome = true) {
  const navButtons = [];
  if (showBack && navigationStack.has(chatId) && navigationStack.get(chatId).length > 0)
    navButtons.push({ text: '⬅️ Atrás', callback_data: 'nav_back' });
  return navButtons.length > 0 ? [navButtons] : [];
}

function pushToNavigationStack(chatId, screen) {
  if (!navigationStack.has(chatId)) navigationStack.set(chatId, []);
  const stack = navigationStack.get(chatId);
  if (stack.length === 0 || stack[stack.length - 1] !== screen) {
    stack.push(screen);
    if (stack.length > 10) stack.shift();
  }
}

function popFromNavigationStack(chatId) {
  if (navigationStack.has(chatId) && navigationStack.get(chatId).length > 0)
    return navigationStack.get(chatId).pop();
  return null;
}

function clearNavigationStack(chatId) {
  navigationStack.delete(chatId);
}

module.exports = {
  createNavigationButtons,
  pushToNavigationStack,
  popFromNavigationStack,
  clearNavigationStack
};

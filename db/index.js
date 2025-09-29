// db/index.js  (o db.js si prefieres)
const Database = require('better-sqlite3');

// crea o abre el archivo de base de datos SQLite
const db = new Database('data.sqlite');

// crea la tabla si no existe
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    dni     TEXT,
    nombre  TEXT,
    rol     TEXT DEFAULT 'user',
    estado  TEXT DEFAULT '1'
  )

`).run();

function insertarUsuario(chat_id, dni, nombre, rol = 'user', estado = '1') {
    try {
        const stmt = db.prepare(`
            INSERT INTO users (chat_id, dni, nombre, rol, estado)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(chat_id, dni, nombre, rol, estado);
        console.log(`Usuario ${nombre} insertado correctamente`);
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            console.error(`Error: chat_id ${chat_id} ya existe`);
        } else {
            console.error('Error al insertar usuario:', err.message);
        }
    }
}

// Comentar esta línea para evitar el error de chat_id duplicado
// insertarUsuario('5021720802', '70871370', 'Kevin Taijer', 'admin', '1');

// ---- Funciones de acceso ----
function getUser(chatId) {
  return db.prepare('SELECT * FROM users WHERE chat_id = ?').get(chatId);
}

function addUser(chatId, dni, nombre, rol = 'user') {
  db.prepare(
    'INSERT OR REPLACE INTO users (chat_id, dni, nombre, rol) VALUES (?, ?, ?, ?)'
  ).run(chatId, dni, nombre, rol);
}

function updateUserEstado(chatId, estado) {
  db.prepare('UPDATE users SET estado = ? WHERE chat_id = ?').run(estado, chatId);
}

function listUsers() {
  return db.prepare('SELECT * FROM users').all();
}

// Función para actualizar el rol de un usuario
function updateUserRol(chatId, rol) {
  db.prepare('UPDATE users SET rol = ? WHERE chat_id = ?').run(rol, chatId);
}

// Función para actualizar el DNI de un usuario
function updateUserDni(chatId, dni) {
  db.prepare('UPDATE users SET dni = ? WHERE chat_id = ?').run(dni, chatId);
}

// Función para eliminar un usuario
function deleteUser(chatId) {
  db.prepare('DELETE FROM users WHERE chat_id = ?').run(chatId);
}

// Función para obtener un usuario por chat_id
function getUserById(chatId) {
  return db.prepare('SELECT * FROM users WHERE chat_id = ?').get(chatId);
}

// exporta las funciones
module.exports = {
  getUser,
  addUser,
  updateUserEstado,
  listUsers,
  updateUserRol,
  updateUserDni,
  deleteUser,
  getUserById
};

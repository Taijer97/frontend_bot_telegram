const sqlite3 = require('sqlite3').verbose();

// Abrir conexión a la base de datos
const db = new sqlite3.Database('./data.sqlite', (err) => {
    if (err) {
        console.error('Error al abrir la base de datos:', err.message);
    } else {
        console.log('Conectado a SQLite.');
    }
});

// Crear la tabla si no existe
db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
        chat_id TEXT PRIMARY KEY,
        dni TEXT,
        nombre TEXT,
        rol TEXT,
        estado TEXT
    )
`);

// Función para insertar un nuevo usuario
function insertarUsuario(chat_id, dni, nombre, rol, estado) {
    const query = `
        INSERT INTO usuarios (chat_id, dni, nombre, rol, estado)
        VALUES (?, ?, ?, ?, ?)
    `;
    db.run(query, [chat_id, dni, nombre, rol, estado], function(err) {
        if (err) {
            console.error('Error al insertar usuario:', err.message);
        } else {
            console.log(`Usuario agregado con chat_id=${chat_id}`);
        }
    });
}

insertarUsuario('5021720802', '70871370', 'Kevin Taijer', 'admin', '1');
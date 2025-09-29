import axios from 'axios';
import fs from 'fs';

(async () => {
  try {
    const res = await axios.post(
      'https://consulta.jamuywasi.com/generate-and-download-pdf',
      { dni: '00150150' },
      { responseType: 'arraybuffer', timeout: 30000 }
    );
    fs.writeFileSync('salida.pdf', res.data);
    console.log('PDF recibido. Guardado como salida.pdf');
  } catch (err) {
    console.error('Error:', err.message);
  }
})();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Client } = require('pg');
const moment = require('moment');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const dns = require('dns').promises; // <-- Importar dns/promises




const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);


// Configura la conexión a PostgreSQL
const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'Odontologico',
    password: 'Maraton.2009',
    port: 5432,
});

client.connect()
    .then(() => {
        console.log('Conectado a PostgreSQL');
        return client.query('SELECT 1');
    })
    .then(() => console.log('Conexión verificada'))
    .catch(err => {
        console.error('Error de conexión a PostgreSQL:', err);
        process.exit(1); // Salir si no se puede conectar
    });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/testimonio', express.static(path.join(__dirname, 'public/testimonio')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Función para validar registros MX del dominio del correo
async function validarCorreoMX(correo) {
    const dominio = correo.split('@')[1];
    try {
        const registros = await dns.resolveMx(dominio);
        return registros && registros.length > 0;
    } catch (error) {
        return false;
    }
}

// Configuración de sesión
app.use(session({
    secret: 'mi_secreto_seguro',
    resave: false,
    saveUninitialized: true
}));

// Rutas
app.get('/', (req, res) => {
    res.render('home', { title: 'Historia Clínica Electrónica' });
});

app.get('/agendar-cita', (req, res) => {
    res.render('agendar-cita', { message: null, formData: {} });
});


const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587, // Usa el puerto 587 para STARTTLS
    secure: false, // No usar SSL/TLS por defecto
    auth: {
        user: 'dra.joselinedelgado.consultorio@gmail.com',
        pass: 'ztac yqif dnnc mqxf'
    }
});

// Ruta para agendar cita
app.post('/agendar-cita', async(req, res) => {
    const { cedula, fecha, hora, especialidad } = req.body;

    // Verificar si el usuario está logueado
    if (!req.session.user) {
        return res.render('agendar-cita', {
            message: { type: 'danger', text: 'Debes iniciar sesión para agendar una cita.' },
            formData: {}, // Vacío para limpiar formulario
        });
    }

    try {
        // Buscar nombre y correo por cédula
        const result = await client.query('SELECT nombre, correo FROM usuarios WHERE cedula = $1', [cedula]);
        if (result.rows.length === 0) {
            return res.render('agendar-cita', {
                message: { type: 'danger', text: 'Paciente no encontrado.' },
                formData: req.body,
            });
        }
        const { nombre, correo } = result.rows[0];

        // Verificar cita duplicada con el mismo doctor y especialidad
        const existingAppointmentResult = await client.query(
            'SELECT COUNT(*) FROM citas WHERE fecha = $1 AND hora = $2 AND especialidad = $3 AND usuario_id = $4', [fecha, hora, especialidad, req.session.user.id]
        );
        const existingAppointments = parseInt(existingAppointmentResult.rows[0].count, 10);
        if (existingAppointments > 0) {
            return res.render('agendar-cita', {
                message: { type: 'danger', text: 'Ya existe una cita agendada a esa hora.' },
                formData: req.body,
            });
        }

        // Verificar cita duplicada con otro doctor
        const existingAppointmentByOtherDoctorResult = await client.query(
            'SELECT COUNT(*) FROM citas WHERE fecha = $1 AND hora = $2', [fecha, hora]
        );
        const existingAppointmentsByOtherDoctor = parseInt(existingAppointmentByOtherDoctorResult.rows[0].count, 10);
        if (existingAppointmentsByOtherDoctor > 0) {
            return res.render('agendar-cita', {
                message: { type: 'danger', text: 'Ya existe una cita agendada a esa hora.' },
                formData: req.body,
            });
        }

        // Insertar cita
        await client.query(
            'INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad) VALUES ($1, $2, $3, $4, $5, $6)', [req.session.user.id, cedula, nombre, fecha, hora, especialidad]
        );

        // Crear una notificación para el usuario
        const nuevaNotificacion = {
            usuarioId: req.session.user.id,
            mensaje: `Has agendado una cita para el ${fecha} a las ${hora} con la especialidad de ${especialidad}.`,
            leida: false,
        };

        // Insertar la notificación en la base de datos
        await client.query(
            'INSERT INTO notificaciones (usuario_id, mensaje, leida) VALUES ($1, $2, $3)', [nuevaNotificacion.usuarioId, nuevaNotificacion.mensaje, nuevaNotificacion.leida]
        );

        // Enviar correo de confirmación
        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com', // Cambia esto por tu correo
            to: correo, // Correo del paciente
            subject: 'Confirmación de Cita Agendada',
            html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          
            <div style="text-align: center;">
            <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
            </div>
            <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita Odontológica</h2>
            <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>

            <p style="font-size: 16px;">Tu cita ha sido agendada con éxito en el consultorio odontológico. Los detalles de tu cita son los siguientes:</p>

            <ul style="font-size: 16px;">
                <li><strong>Fecha:</strong> ${fecha}</li>
                <li><strong>Hora:</strong> ${hora}</li>
                <li><strong>Especialidad:</strong> ${especialidad}</li>
            </ul>

            <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>

            <p style="font-size: 16px; font-weight: bold;">Atentamente,</p>
            <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado</p>
            <p style="font-size: 16px; font-weight: bold;">Odontología Especializada</p>
        </div>
    `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('Error al enviar el correo:', error);
                return res.status(500).send('Error al enviar el correo');
            } else {
                console.log('Correo enviado:', info.response);
            }
        });

        // Mostrar la vista con mensaje de éxito y campos limpios (formData vacío)
        return res.render('agendar-cita', {
            message: { type: 'success', text: 'Su cita se agendó correctamente. Un correo de confirmación ha sido enviado.' },
            formData: {}, // Aquí limpiamos el formulario
        });
    } catch (err) {
        console.error('Error al agendar cita:', err);
        let errorMsg;
        switch (err.code) {
            case '22P02':
                errorMsg = 'Formato incorrecto.';
                break;
            case '23503':
                errorMsg = 'Usuario no encontrado.';
                break;
            default:
                errorMsg = 'Error interno del servidor.';
        }
        return res.render('agendar-cita', {
            message: { type: 'danger', text: errorMsg },
            formData: req.body,
        });
    }
});

// GET para obtener datos de paciente por cédula
app.get('/obtener-datos-paciente', async(req, res) => {
    const { cedula } = req.query;

    if (!cedula) {
        return res.status(400).json({ error: 'Ingrese una cédula para buscar.' });
    }

    if (cedula.length < 10) {
        return res.status(400).json({ error: 'La cédula debe tener al menos 10 dígitos.' });
    }

    try {

        const result = await client.query('SELECT nombre FROM usuarios WHERE cedula = $1', [cedula]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Paciente no encontrado.' });
        }
        res.json({ nombre: result.rows[0].nombre });
    } catch (err) {
        console.error('Error al obtener paciente:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.get('/citas-agendadas', async(req, res) => {
    if (!req.session.user) return res.redirect('/login');

    try {
        const result = await client.query(
            'SELECT id, fecha, hora, especialidad FROM citas WHERE usuario_id = $1 ORDER BY fecha, hora', [req.session.user.id]
        );

        const message = req.query.message ? { text: req.query.message, type: req.query.type || 'info' } :
            null;

        res.render('citas-agendadas', {
            appointments: result.rows,
            message,
        });
    } catch (error) {
        console.error('Error al obtener citas:', error);
        res.render('citas-agendadas', { appointments: [], message: { text: 'Error al cargar citas', type: 'danger' } });
    }
});


app.post('/eliminar-cita', async(req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const citaId = req.body.id;
    const usuarioId = req.session.user.id;

    if (!citaId) {
        // ID no recibido, redirigir con error
        return res.redirect('/citas-agendadas?message=ID de cita inválido&type=danger');
    }

    try {
        // Obtener los detalles de la cita antes de eliminarla
        const citaResult = await client.query(
            'SELECT nombre, fecha, hora, especialidad, usuario_id FROM citas WHERE id = $1', [citaId]
        );

        if (citaResult.rows.length === 0) {
            // No se encontró la cita o no pertenece al usuario
            return res.redirect('/citas-agendadas?message=No se encontró la cita o no tienes permiso para eliminarla&type=danger');
        }

        const { nombre, fecha, hora, especialidad, usuario_id } = citaResult.rows[0];

        // Asegurarnos que la cita pertenece al usuario logueado
        if (usuario_id !== usuarioId) {
            return res.redirect('/citas-agendadas?message=No tienes permiso para eliminar esta cita&type=danger');
        }

        // Obtener el correo del paciente
        const pacienteResult = await client.query(
            'SELECT correo FROM usuarios WHERE id = $1', [usuario_id]
        );

        if (pacienteResult.rows.length === 0) {
            return res.status(400).json({ error: 'Paciente no encontrado.' });
        }
        const correoPaciente = pacienteResult.rows[0].correo;

        // Eliminar la cita de la base de datos
        await client.query('DELETE FROM citas WHERE id = $1', [citaId]);

        // Correo de cancelación
        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com', // Cambia esto por tu correo
            to: correoPaciente, // Correo del paciente
            subject: 'Cancelación de Cita Agendada',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color: #F44336;">Cancelación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>

                    <p style="font-size: 16px;">Lamentamos informarte que tu cita en el consultorio odontológico ha sido cancelada. Los detalles de la cita eran los siguientes:</p>

                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>

                    <p style="font-size: 16px;">Si deseas reprogramar la cita, por favor, contáctanos.</p>

                    <p style="font-size: 16px; font-weight: bold;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold;">Odontología Especializada</p>
                </div>
            `
        };

        // Enviar correo
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('Error al enviar el correo:', error);
                return res.status(500).send('Error al enviar el correo de cancelación');
            } else {
                console.log('Correo de cancelación enviado:', info.response);
            }
        });

        // Responder con éxito
        res.redirect('/citas-agendadas?message=Cita eliminada correctamente. Un correo de cancelación ha sido enviado.&type=success');
    } catch (error) {
        console.error('Error al eliminar la cita:', error);
        res.redirect('/citas-agendadas?message=Error al eliminar la cita&type=danger');
    }
});


// Mostrar formulario para editar cita
app.get('/editar-cita/:id', async(req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const citaId = req.params.id;

    try {
        const result = await client.query(
            'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2', [citaId, req.session.user.id]
        );

        if (result.rows.length === 0) {
            // Cita no encontrada o no pertenece al usuario
            return res.redirect('/citas-agendadas');
        }

        res.render('editar-cita', {
            appointment: result.rows[0],
            message: null,
        });
    } catch (error) {
        console.error('Error al obtener la cita:', error);
        return res.redirect('/citas-agendadas');
    }
});

// Procesar actualización de cita
app.post('/editar-cita/:id', async(req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const citaId = req.params.id;
    const { fecha, hora, especialidad } = req.body;

    try {
        await client.query(
            `UPDATE citas SET fecha = $1, hora = $2, especialidad = $3 WHERE id = $4 AND usuario_id = $5`, [fecha, hora, especialidad, citaId, req.session.user.id]
        );

        // Obtener la cita actualizada para mostrar en formulario
        const result = await client.query(
            'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2', [citaId, req.session.user.id]
        );

        res.render('editar-cita', {
            appointment: result.rows[0],
            message: { type: 'success', text: 'Cita actualizada correctamente.' },
        });
    } catch (error) {
        console.error('Error al actualizar cita:', error);

        // Intentar mostrar datos anteriores para no perder info
        const result = await client.query(
            'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2', [citaId, req.session.user.id]
        );

        res.render('editar-cita', {
            appointment: result.rows[0],
            message: { type: 'danger', text: 'Error al actualizar la cita.' },
        });
    }
});



app.get('/obtener-citas-json', async(req, res) => {
    try {
        const { rows } = await client.query('SELECT fecha, hora, especialidad FROM citas');
        const citas = rows.map(row => ({
            title: row.especialidad,
            start: `${row.fecha.toISOString().split('T')[0]}T${row.hora}`,
            allDay: false,
            estado: 'ocupado' // <-- aquí añadimos el estado para que el frontend pinte rojo
        }));
        res.json(citas);
    } catch (err) {
        console.error('Error al obtener citas JSON:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.get('/citas-por-dia', async(req, res) => {
    try {
        const fecha = req.query.fecha; // formato: 'YYYY-MM-DD'

        if (!fecha) {
            return res.status(400).json({ error: 'Parámetro fecha requerido' });
        }

        // Consulta citas para la fecha dada ordenadas por hora
        const query = `
      SELECT hora, nombre AS nombre
      FROM citas
      WHERE fecha = $1
      ORDER BY hora
    `;

        const { rows } = await client.query(query, [fecha]);

        // Devuelve formato JSON esperado [{hora: "15:30:00", nombre: "Juan Pérez"}, ...]
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener citas por día:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/obtener-citas', (req, res) => {
    res.render('obtener-citas'); // Solo renderiza HTML
});


app.get('/register', (req, res) => {
    res.render('register', { success: null, error: null });
});

// Ruta register ajustada con validación MX
app.post('/register', async(req, res) => {
    const { nombre, correo, password } = req.body;

    // Validar formato básico de correo
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailPattern.test(correo)) {
        return res.status(400).json({ error: 'Por favor, ingresa un correo electrónico válido.' });
    }

    // Validar si dominio tiene registros MX
    const dominioValido = await validarCorreoMX(correo);
    if (!dominioValido) {
        return res.status(400).json({ error: 'El dominio del correo no es válido o no tiene servidor de correo.' });
    }

    try {
        const existingUser = await client.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'El correo ya está registrado' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await client.query(
            'INSERT INTO usuarios (nombre, correo, password) VALUES ($1, $2, $3)', [nombre, correo, passwordHash]
        );

        res.status(200).json({ success: 'Cuenta creada con éxito' });
    } catch (error) {
        console.error('Error al registrar:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async(req, res) => {
    const { correo, password } = req.body;
    try {
        const result = await client.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);

        if (result.rows.length === 0) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos' });
        }

        const user = result.rows[0];

        // Verificar si el usuario está bloqueado
        if (user.bloqueado) {
            return res.render('login', { error: 'Cuenta bloqueada, contáctese con el administrador.' });
        }

        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos' });
        }

        req.session.user = {
            id: user.id,
            correo: user.correo,
            nombre: user.nombre
        };

        res.redirect('/obtener-citas');
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.render('login', { error: 'Ocurrió un error al iniciar sesión. Por favor, inténtalo de nuevo.' });
    }
});


app.get('/PaPrincipal', async(req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const result = await client.query('SELECT nombre, mensaje, foto_url FROM testimonios ORDER BY creado_en DESC');
        const testimonios = result.rows;

        res.render('PaPrincipal', {
            user: req.session.user,
            testimonios // pasar testimonios completos a la vista
        });
    } catch (error) {
        console.error('Error al obtener testimonios:', error);
        res.render('PaPrincipal', {
            user: req.session.user,
            testimonios: []
        });
    }
});



// Multer storage
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Ruta GET para mostrar formulario edición perfil
// Ruta GET para mostrar formulario edición perfil
app.get('/EditPerfil', async(req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const userId = req.session.user.id;
        const result = await client.query('SELECT * FROM usuarios WHERE id = $1', [userId]);

        if (result.rowCount === 0) {
            return res.redirect('/perfil');
        }

        const user = result.rows[0];

        res.render('EditPerfil', {
            user: user,
            message: null
        });
    } catch (error) {
        console.error('Error al obtener datos para editar perfil:', error);
        res.status(500).send('Error al cargar la página de edición de perfil.');
    }
});

// Ruta POST para actualizar perfil con foto y campos adicionales
app.post('/EditPerfil', upload.single('foto_perfil'), async(req, res) => {
    if (!req.session.user) {
        return res.status(401).render('EditPerfil', {
            user: null,
            message: { type: 'danger', text: 'Debes iniciar sesión para editar tu perfil' }
        });
    }

    const obtenerValor = (campo, campoOtros) => {
        if (req.body[campo] === 'Otros') {
            return req.body[campoOtros] || '';
        }
        return req.body[campo] || '';
    };

    try {
        const {
            tipo_id,
            sexo,
            cedula,
            edad,
            celular,
            ciudad,
            barrio,
            ocupacion,
            grupo_sanguineo
        } = req.body;

        // Validación simple para tipo_id y cedula
        if (!tipo_id || !cedula) {
            return res.render('EditPerfil', {
                user: req.body,
                message: { type: 'danger', text: 'Tipo de identificación y número son obligatorios' }
            });
        }

        if (tipo_id === 'nacional' && !/^\d{10}$/.test(cedula)) {
            return res.render('EditPerfil', {
                user: req.body,
                message: { type: 'danger', text: 'La cédula nacional debe tener 10 dígitos numéricos' }
            });
        }

        if (tipo_id === 'extranjero' && !/^[A-Za-z0-9]{5,20}$/.test(cedula)) {
            return res.render('EditPerfil', {
                user: req.body,
                message: { type: 'danger', text: 'El número de pasaporte debe tener entre 5 y 20 caracteres alfanuméricos' }
            });
        }

        const alergias = obtenerValor('alergias', 'alergias_otros');
        const antecedentes_personales = obtenerValor('antecedentes_personales', 'antecedentes_personales_otros');
        const antecedentes_familiares = obtenerValor('antecedentes_familiares', 'antecedentes_familiares_otros');
        const medicamentos_actuales = obtenerValor('medicamentos_actuales', 'medicamentos_actuales_otros');
        const cirugias = obtenerValor('cirugias', 'cirugias_otros');
        const enfermedades_cronicas = obtenerValor('enfermedades_cronicas', 'enfermedades_cronicas_otros');
        const enfermedades_contagiosas_recientes = obtenerValor('enfermedades_contagiosas_recientes', 'enfermedades_contagiosas_recientes_otros');

        const fuma = req.body.fuma === 'on';
        const tipo_fuma = req.body.tipo_fuma || '';
        const tipo_fuma_otros = req.body.tipo_fuma === 'Otros' ? req.body.tipo_fuma_otros || '' : '';
        const alcohol = req.body.alcohol === 'on';
        const foto_perfil = req.file ? req.file.filename : null;

        // Guardar cedula o pasaporte según tipo_id
        let cedulaDB = null;
        let pasaporteDB = null;
        if (tipo_id === 'nacional') {
            cedulaDB = cedula;
        } else if (tipo_id === 'extranjero') {
            pasaporteDB = cedula;
        }

        let query = `
      UPDATE usuarios SET
        tipo_id = $1,
        sexo = $2,
        cedula = $3,
        pasaporte = $4,
        edad = $5,
        celular = $6,
        ciudad = $7,
        barrio = $8,
        ocupacion = $9,
        grupo_sanguineo = $10,
        alergias = $11,
        antecedentes_personales = $12,
        antecedentes_familiares = $13,
        medicamentos_actuales = $14,
        cirugias = $15,
        enfermedades_cronicas = $16,
        enfermedades_contagiosas_recientes = $17,
        fuma = $18,
        alcohol = $19,
        tipo_fuma = $20,
        tipo_fuma_otros = $21
    `;

        const params = [
            tipo_id,
            sexo,
            cedulaDB,
            pasaporteDB,
            edad,
            celular,
            ciudad,
            barrio,
            ocupacion,
            grupo_sanguineo,
            alergias,
            antecedentes_personales,
            antecedentes_familiares,
            medicamentos_actuales,
            cirugias,
            enfermedades_cronicas,
            enfermedades_contagiosas_recientes,
            fuma,
            alcohol,
            tipo_fuma,
            tipo_fuma_otros
        ];

        if (foto_perfil) {
            query += `, foto_perfil = $22 WHERE id = $23`;
            params.push(foto_perfil, req.session.user.id);
        } else {
            query += ` WHERE id = $22`;
            params.push(req.session.user.id);
        }

        await client.query(query, params);

        // Actualizar sesión con nuevos datos
        Object.assign(req.session.user, {
            tipo_id,
            sexo,
            cedula: cedulaDB,
            pasaporte: pasaporteDB,
            edad,
            celular,
            ciudad,
            barrio,
            ocupacion,
            grupo_sanguineo,
            alergias,
            antecedentes_personales,
            antecedentes_familiares,
            medicamentos_actuales,
            cirugias,
            enfermedades_cronicas,
            enfermedades_contagiosas_recientes,
            fuma,
            alcohol,
            tipo_fuma,
            tipo_fuma_otros
        });

        if (foto_perfil) {
            req.session.user.foto_perfil = foto_perfil;
        }

        res.render('EditPerfil', {
            user: req.session.user,
            message: { type: 'success', text: 'Perfil actualizado correctamente' }
        });
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.render('EditPerfil', {
            user: req.session.user,
            message: { type: 'danger', text: 'Error al actualizar el perfil' }
        });
    }
});



// Ruta GET para mostrar perfil
app.get('/perfil', async(req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const userId = req.session.user.id;
        const result = await client.query('SELECT * FROM usuarios WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.redirect('/login');
        }
        const user = result.rows[0];
        res.render('perfil', { user });
    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(500).send('Error al obtener perfil');
    }
});

//Recuperar contraseña
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { error: null }); // Inicializamos error como null
});

app.post('/forgot-password', async(req, res) => {
    const { correo } = req.body;

    try {
        // Verificamos si el correo está registrado en la base de datos
        const result = await client.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);

        if (result.rows.length === 0) {
            return res.render('forgot-password', { error: 'El correo electrónico no está registrado' });
        }

        // Generación de un token único para la recuperación de la contraseña
        const token = crypto.randomBytes(20).toString('hex');
        const expiration = new Date(Date.now() + 3600000); // El token expirará en 1 hora

        // Guardar el token en la base de datos (en la tabla de usuarios)
        await client.query('UPDATE usuarios SET reset_password_token = $1, reset_password_expires = $2 WHERE correo = $3', [token, expiration, correo]);

        // Configuración para enviar un correo con el enlace de recuperación
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'dra.joselinedelgado.consultorio@gmail.com',
                pass: 'ztac yqif dnnc mqxf'
            }
        });

        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com',
            to: correo,
            subject: 'Recuperación de Contraseña',
            text: `Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para restablecerla:\n\nhttp://localhost:4000/reset-password/${token}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log(error);
            } else {
                console.log('Correo enviado: ' + info.response);
            }
        });

        // Mensaje de éxito
        res.render('forgot-password', { success: 'Te hemos enviado un enlace de recuperación a tu correo' });
    } catch (error) {
        console.error('Error al procesar la solicitud de recuperación de contraseña:', error);
        res.render('forgot-password', { error: 'Ocurrió un error al procesar tu solicitud' });
    }
});

app.get('/reset-password', (req, res) => {
    res.render('reset-password', { error: null }); // Asegúrate de pasar `error: null` si no hay error
});

app.post('/reset-password', async(req, res) => {
    const { correo, nuevaContraseña } = req.body;

    try {
        // Verificar si el correo proporcionado existe
        const result = await client.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);

        if (result.rows.length === 0) {
            return res.render('reset-password', { error: 'Correo no encontrado' });
        }

        // Encriptar la nueva contraseña antes de guardarla
        const passwordHash = await bcrypt.hash(nuevaContraseña, 10); // 10 es el salt rounds

        // Realizar la actualización de la contraseña encriptada
        const updateQuery = 'UPDATE usuarios SET password = $1 WHERE correo = $2 RETURNING *';
        const updatedUser = await client.query(updateQuery, [passwordHash, correo]);

        if (updatedUser.rows.length > 0) {
            res.send('Contraseña restablecida con éxito');
        } else {
            res.render('reset-password', { error: 'No se pudo actualizar la contraseña. Intenta nuevamente.' });
        }
    } catch (error) {
        console.error('Error al restablecer la contraseña:', error);
        res.render('reset-password', { error: 'Ocurrió un error al restablecer la contraseña' });
    }
});

app.get('/reset-password/:token', async(req, res) => {
    const { token } = req.params;

    try {
        // Verificamos el token y su expiración en la base de datos
        const result = await client.query('SELECT * FROM usuarios WHERE reset_password_token = $1 AND reset_password_expires > $2', [token, new Date()]);

        if (result.rows.length === 0) {
            return res.render('reset-password', { error: 'El enlace de recuperación es inválido o ha expirado' });
        }

        // Si el token es válido, mostramos el formulario para restablecer la contraseña
        res.render('reset-password', { token });
    } catch (error) {
        console.error('Error al verificar el token de recuperación:', error);
        res.render('reset-password', { error: 'Ocurrió un error al verificar el enlace de recuperación' });
    }
});

app.post('/reset-password/:token', async(req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10); // Encriptamos la nueva contraseña

        // Actualizamos la contraseña en la base de datos
        await client.query('UPDATE usuarios SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE reset_password_token = $2', [hashedPassword, token]);

        res.render('login', { success: 'Tu contraseña ha sido restablecida con éxito. Ahora puedes iniciar sesión.' });
    } catch (error) {
        console.error('Error al restablecer la contraseña:', error);
        res.render('reset-password', { error: 'Ocurrió un error al restablecer la contraseña.' });
    }
});


// Rutas para Especialidades
app.get('/estetica', (req, res) => {
    res.render('estetica', { title: 'Estética Dental' });
});

app.get('/ortodoncia', (req, res) => {
    res.render('ortodoncia', { title: 'Ortodoncia - Odontología Especializada' });
});

app.get('/cirugia', (req, res) => {
    res.render('cirugia', { title: 'Cirugía e Implantes - Odontología Especializada' });
});
app.get('/otras', (req, res) => {
    res.render('otras', { title: 'Otras Especialidades - Odontología Especializada' });
});

//RUTAS DE ESPECIALIDADES QUE ESTÁN ADENTRO DE LA CUENTA
app.get('/Esteticaa', (req, res) => {
    res.render('Esteticaa', { title: 'Estética Dental - Odontología Especializada Dra. Josseline Delgado' });
});

app.get('/Ortodonciaa', (req, res) => {
    res.render('Ortodonciaa', { title: 'Ortodoncia - Odontología Especializada Dra. Josseline Delgado' });
});

app.get('/Cirugiaa', (req, res) => {
    res.render('Cirugiaa', { title: 'Cirugía Oral - Odontología Especializada Dra. Josseline Delgado' });
});

app.get('/OtrasEspee', (req, res) => {
    res.render('OtrasEspee', { title: 'Otras Especialidades - Odontología Especializada Dra. Josseline Delgado' });
});

app.get('/calendario', (req, res) => {
    res.render('calendario');
});

app.get('/admin-login', (req, res) => {
    res.render('admin-login', { error: null }); // por si usas {{error}} en la vista
});

app.post('/admin-login', async(req, res) => {
    const { usuario, contraseña } = req.body;

    try {
        const result = await client.query('SELECT * FROM admin_credenciales WHERE usuario = $1', [usuario]);
        if (result.rows.length === 0) {
            return res.render('admin-login', { error: 'Usuario no encontrado' });
        }

        const user = result.rows[0];

        if (user.contraseña === contraseña) {
            req.session.user = {
                id: user.id,
                usuario: user.usuario,
                rol: user.rol // ✅ usar directamente desde la base
            };

            // Redirigir según el rol
            if (user.rol === 'administrador') {
                return res.redirect('/admin-home');
            } else if (user.rol === 'recepcionista') {
                return res.redirect('/admin-recepcionista');
            } else {
                return res.status(403).send('Rol no autorizado');
            }
        } else {
            return res.render('admin-login', { error: 'Contraseña incorrecta' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).send('Error en el servidor');
    }
});


// Ruta GET para mostrar la página de inicio del administrador
app.get('/admin-home', async(req, res) => {
    try {
        // Obtiene las citas desde la base de datos
        const result = await client.query('SELECT * FROM citas');
        const appointments = result.rows;

        // Renderiza la vista con las citas
        res.render('admin-home', { appointments });
    } catch (error) {
        console.error('Error al obtener las citas:', error);
        res.status(500).send('Error al obtener las citas');
    }
});

//RECEPCIONISTA
app.get('/admin-recepcionista', (req, res) => {
    if (!req.session.user || !req.session.user.rol || req.session.user.rol.toLowerCase() !== 'recepcionista') {
        return res.status(403).send('Acceso no autorizado');
    }
    res.render('admin-recepcionista', { user: req.session.user });
});

// Ruta para mostrar las citas en admin-recepcionista-citas.ejs
app.get('/admin-recepcionista-citas', async(req, res) => {
    try {
        const result = await client.query('SELECT * FROM citas ORDER BY fecha DESC, hora DESC');
        res.render('admin-recepcionista-citas', {
            user: req.session.user,
            citas: result.rows
        });
    } catch (error) {
        console.error('Error al obtener citas:', error);
        res.status(500).send('Error al cargar las citas');
    }
});
app.post('/recepcionista/citas/agregar', async(req, res) => {
    const { usuario_id, cedula, nombre, fecha, hora, especialidad } = req.body;

    try {
        // Verificar si ya existe una cita con la misma fecha y hora
        const existente = await client.query(
            `SELECT * FROM citas WHERE fecha = $1 AND hora = $2`, [fecha, hora]
        );

        if (existente.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe una cita en esa fecha y hora.' });
        }

        // Insertar nueva cita
        await client.query(
            `INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad)
             VALUES ($1, $2, $3, $4, $5, $6)`, [usuario_id, cedula, nombre, fecha, hora, especialidad]
        );

        // Buscar el correo del paciente
        const result = await client.query('SELECT correo FROM usuarios WHERE cedula = $1', [cedula]);
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Paciente no encontrado.' });
        }
        const correoPaciente = result.rows[0].correo;

        // Correo de confirmación
        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com', // Cambia esto por tu correo
            to: correoPaciente,
            subject: 'Confirmación de Cita Agendada',
            html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          
            <div style="text-align: center;">
            <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
            </div>
            <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita Odontológica</h2>
            <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>

            <p style="font-size: 16px;">Tu cita ha sido agendada con éxito en el consultorio odontológico. Los detalles de tu cita son los siguientes:</p>

            <ul style="font-size: 16px;">
                <li><strong>Fecha:</strong> ${fecha}</li>
                <li><strong>Hora:</strong> ${hora}</li>
                <li><strong>Especialidad:</strong> ${especialidad}</li>
            </ul>

            <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>

            <p style="font-size: 16px; font-weight: bold;">Atentamente,</p>
            <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado</p>
            <p style="font-size: 16px; font-weight: bold;">Odontología Especializada</p>
        </div>
    `
        };

        // Enviar correo
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('Error al enviar el correo:', error);
            } else {
                console.log('Correo enviado:', info.response);
            }
        });

        // Responder al cliente
        res.json({ success: 'Cita guardada exitosamente. Un correo de confirmación ha sido enviado.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al guardar la cita.' });
    }
});

app.get('/api/buscar-usuario', async(req, res) => {
    const { cedula } = req.query;

    if (!cedula) {
        return res.status(400).json({ error: 'Debe proporcionar una cédula' });
    }

    try {
        const result = await client.query(
            'SELECT id, nombre FROM usuarios WHERE cedula = $1', [cedula]
        );

        if (result.rows.length > 0) {
            return res.json({
                id: result.rows[0].id,
                nombre: result.rows[0].nombre
            });
        } else {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Error al buscar usuario:', error);
        res.status(500).json({ error: 'Error del servidor al buscar usuario' });
    }
});

// EDITAR CITA
app.get('/recepcionista/citas/editar/:id', async(req, res) => {
    const id = req.params.id;
    try {
        const result = await client.query('SELECT * FROM citas WHERE id = $1', [id]);
        if (result.rows.length > 0) {
            res.render('admin-recepcionista-editarCita', { cita: result.rows[0] });
        } else {
            res.redirect('/admin-recepcionista-citas');
        }
    } catch (error) {
        console.error(error);
        res.redirect('/admin-recepcionista-citas');
    }
});

app.post('/recepcionista/citas/editar/:id', async(req, res) => {
    const { id } = req.params;
    const { fecha, hora, especialidad } = req.body;

    // Validaciones mínimas
    if (!fecha || !hora || !especialidad) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    try {
        const result = await client.query(
            'UPDATE citas SET fecha = $1, hora = $2, especialidad = $3 WHERE id = $4', [fecha, hora, especialidad, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }

        return res.json({ success: 'Cita actualizada correctamente' });
    } catch (error) {
        console.error('Error al actualizar cita:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});



// ELIMINAR CITA
// ELIMINAR CITA
app.delete('/recepcionista/citas/eliminar/:id', async(req, res) => {
    const { id } = req.params;

    try {
        // Obtener los detalles de la cita que se eliminará, incluyendo usuario_id
        const citaResult = await client.query('SELECT nombre, fecha, hora, especialidad, usuario_id FROM citas WHERE id = $1', [id]);
        if (citaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }

        // Usar destructuración para obtener los datos de la cita
        const { nombre, fecha, hora, especialidad, usuario_id } = citaResult.rows[0];

        // Obtener el correo del paciente usando usuario_id
        const result = await client.query('SELECT correo FROM usuarios WHERE id = $1', [usuario_id]);
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Paciente no encontrado.' });
        }
        const correoPaciente = result.rows[0].correo;

        // Eliminar la cita de la base de datos
        await client.query('DELETE FROM citas WHERE id = $1', [id]);

        // Correo de cancelación
        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com', // Cambia esto por tu correo
            to: correoPaciente, // Correo del paciente
            subject: 'Cancelación de Cita Agendada',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(56, 148, 235);">Cancelación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>

                    <p style="font-size: 16px;">Lamentamos informarte que tu cita en el consultorio odontológico ha sido cancelada. Los detalles de la cita eran los siguientes:</p>

                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>

                    <p style="font-size: 16px;">Si deseas reprogramar la cita, por favor, contáctanos.</p>

                    <p style="font-size: 16px; font-weight: bold;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold;">Odontología Especializada</p>
                </div>
            `
        };

        // Enviar correo
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('Error al enviar el correo:', error);
                return res.status(500).send('Error al enviar el correo de cancelación');
            } else {
                console.log('Correo de cancelación enviado:', info.response);
            }
        });

        // Responder con éxito
        res.json({ success: 'Cita eliminada correctamente. Un correo de cancelación ha sido enviado.' });
    } catch (error) {
        console.error('Error al eliminar la cita:', error);
        res.status(500).json({ error: 'Error al eliminar la cita' });
    }
});



// Buscar usuario por cédula para autocompletar nombre e id usuario
app.get('/buscar-usuario', async(req, res) => {
    const { cedula } = req.query;

    if (!cedula) {
        return res.status(400).json({ error: 'Cédula es requerida' });
    }

    try {
        const result = await client.query('SELECT id as usuario_id, nombre FROM usuarios WHERE cedula = $1', [cedula]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al buscar usuario:', error);
        res.status(500).json({ error: 'Error al buscar usuario' });
    }
});

// Ruta para mostrar el formulario de agregar administrador
app.get('/admin-crear', async(req, res) => {
    try {
        const { rows } = await client.query('SELECT * FROM admin_credenciales');
        res.render('admin-crear', { error: null, admins: rows });
    } catch (err) {
        console.error('Error al obtener administradores:', err);
        res.render('admin-crear', { error: 'Error al obtener los administradores' });
    }
});

app.post('/recepcionista/citas/agregar', async(req, res) => {
    const {
        usuario_id,
        cedula,
        nombre,
        fecha,
        hora,
        especialidad
    } = req.body;

    // Validar datos básicos (opcional)
    if (!usuario_id || !cedula || !nombre || !fecha || !hora || !especialidad) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    try {
        await client.query(`
      INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [usuario_id, cedula, nombre, fecha, hora, especialidad]);

        res.json({ success: 'Cita agregada correctamente' });
    } catch (error) {
        console.error('Error al agregar cita:', error);
        res.status(500).json({ error: 'Error interno al guardar la cita' });
    }
});


app.post('/admin-crear', async(req, res) => {
    const { usuario, contraseña, rol } = req.body;

    if (!usuario || !contraseña || !rol) {
        const { rows } = await client.query('SELECT * FROM admin_credenciales');
        return res.render('admin-crear', { error: 'Completa todos los campos', admins: rows });
    }

    try {
        await client.query(
            'INSERT INTO admin_credenciales (usuario, contraseña, rol) VALUES ($1, $2, $3)', [usuario, contraseña, rol]
        );

        const { rows } = await client.query('SELECT * FROM admin_credenciales');
        res.render('admin-crear', { error: null, admins: rows });
    } catch (err) {
        console.error('Error al agregar administrador:', err);
        const { rows } = await client.query('SELECT * FROM admin_credenciales');
        res.render('admin-crear', { error: 'Error al agregar el usuario', admins: rows });
    }
});

app.get('/admin-editar/:id', async(req, res) => {
    const { id } = req.params;
    try {
        const result = await client.query('SELECT * FROM admin_credenciales WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).send('Administrador no encontrado');
        }
        res.render('admin-editar', {
            admin: result.rows[0],
            error: null,
            success: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error del servidor');
    }
});

app.post('/admin-editar/:id', async(req, res) => {
    const { id } = req.params;
    const { usuario, contraseña } = req.body;

    if (!usuario || usuario.trim() === '') {
        return res.render('admin-editar', {
            admin: { id, usuario },
            error: 'El usuario es requerido.',
            success: null
        });
    }

    try {
        const exists = await client.query(
            'SELECT 1 FROM admin_credenciales WHERE usuario = $1 AND id != $2', [usuario, id]
        );

        if (exists.rowCount > 0) {
            return res.render('admin-editar', {
                admin: { id, usuario },
                error: 'El usuario ya está en uso por otro administrador.',
                success: null
            });
        }

        if (contraseña && contraseña.trim() !== '') {
            await client.query(
                'UPDATE admin_credenciales SET usuario = $1, contraseña = $2 WHERE id = $3', [usuario, contraseña, id]
            );
        } else {
            await client.query(
                'UPDATE admin_credenciales SET usuario = $1 WHERE id = $2', [usuario, id]
            );
        }

        // Obtener datos actualizados para mostrar en la vista
        const { rows } = await client.query('SELECT * FROM admin_credenciales WHERE id = $1', [id]);

        res.render('admin-editar', {
            admin: rows[0],
            error: null,
            success: 'Administrador actualizado correctamente.'
        });
    } catch (error) {
        console.error('Error al editar administrador:', error);
        res.render('admin-editar', {
            admin: { id, usuario },
            error: 'Error interno del servidor.',
            success: null
        });
    }
});

// Eliminar administrador
app.delete('/admin/eliminar/:id', async(req, res) => {
    const { id } = req.params;

    try {
        // Eliminar admin por id
        const result = await client.query('DELETE FROM admin_credenciales WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Administrador no encontrado.' });
        }

        return res.json({ success: 'Administrador eliminado correctamente.' });
    } catch (error) {
        console.error('Error al eliminar administrador:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.get('/admin-obtener-citas', (req, res) => {
    res.render('admin-obtener-citas'); // Solo renderiza HTML
});

app.get('/api/citas', async(req, res) => {
    try {
        const { rows } = await client.query('SELECT fecha, hora, especialidad FROM citas');

        const events = rows.map(cita => {
            const fecha = cita.fecha.toISOString().split('T')[0]; // "2025-05-23"
            const hora = cita.hora; // ya viene en formato "HH:MM:SS"
            const start = `
                        $ { fecha }
                        T$ { hora }
                        `;

            return {
                title: cita.especialidad,
                start: start
            };
        });

        res.json(events);
    } catch (err) {
        console.error('Error al obtener citas:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.get('/admin-obtener-citas-json', async(req, res) => {
    try {
        const { rows } = await client.query('SELECT fecha, hora, especialidad FROM citas');
        const citas = rows.map(row => ({
            title: row.especialidad,
            start: `${row.fecha.toISOString().split('T')[0]}T${row.hora}`,
            allDay: false
        }));
        res.json(citas);
    } catch (err) {
        console.error('Error al obtener citas JSON:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});



app.get('/admin-citas-dia/:fecha', async(req, res) => {
    const fecha = req.params.fecha; // formato yyyy-mm-dd
    try {
        const { rows } = await client.query(
            'SELECT nombre, cedula, hora, especialidad FROM citas WHERE fecha = $1 ORDER BY hora', [fecha]
        );
        res.render('admin-citas-dia', { fecha, citas: rows });
    } catch (err) {
        console.error('Error al obtener citas por fecha:', err);
        res.status(500).send('Error al obtener las citas del día');
    }
});

//pantalla de todas las citas
app.get('/admin-citas-agendadas', async(req, res) => {
    try {
        const citas = await client.query('SELECT * FROM citas');
        res.render('admin-citas-agendadas', { citas: citas.rows, error: req.query.error });
    } catch (error) {
        console.error('Error al obtener citas:', error);
        res.render('admin-citas-agendadas', { error: 'Hubo un error al obtener las citas.' });
    }
});

// Mostrar formulario para crear historial clínico (vacío siempre)
app.get('/admin/historial-clinico/:usuario_id', async(req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);

    try {
        const pacienteResult = await client.query('SELECT * FROM usuarios WHERE id = $1', [usuarioId]);
        if (pacienteResult.rowCount === 0) {
            return res.status(404).send('Paciente no encontrado');
        }
        const paciente = pacienteResult.rows[0];

        // No cargamos historial aquí para que el formulario siempre sea vacío
        res.render('admin-historial-clinica', {
            paciente,
            mensaje: null,
            historial: null
        });

    } catch (error) {
        console.error('Error al cargar historial clínico:', error);
        res.status(500).send('Error en el servidor');
    }
});

// Crear historial clínico y recargar formulario vacío
app.post('/admin/historial-clinico/:usuario_id/crear', async(req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);
    const {
        codigo_hc,
        tratamientos,
        observaciones,
        odontograma_json,
        medicamentos,
        prescripcion,
        codigo_diagnostico,
        nombre_diagnostico
    } = req.body;

    try {
        const pacienteResult = await client.query('SELECT * FROM usuarios WHERE id = $1', [usuarioId]);
        if (pacienteResult.rowCount === 0) {
            return res.status(404).send('Paciente no encontrado');
        }
        const paciente = pacienteResult.rows[0];

        await client.query(
            `INSERT INTO historial_clinico 
            (usuario_id, codigo_hc, cedula, nombre, tratamientos, medicamentos, prescripcion, observaciones, odontograma_json, codigo_diagnostico, nombre_diagnostico) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
                usuarioId,
                codigo_hc,
                paciente.cedula,
                paciente.nombre,
                tratamientos,
                medicamentos,
                prescripcion,
                observaciones,
                odontograma_json,
                codigo_diagnostico || null,
                nombre_diagnostico || null
            ]
        );

        res.redirect(`/admin/historial-clinico/${usuarioId}?mensaje=Historial%20guardado%20correctamente&tipoMensaje=success`);
    } catch (error) {
        console.error('Error al crear historial clínico:', error);
        res.redirect(`/admin/historial-clinico/${usuarioId}?mensaje=Error%20al%20guardar%20el%20historial&tipoMensaje=error`);
    }
});



// Mostrar todos los historiales clínicos del paciente
app.get('/admin/historiales-clinicos/:usuario_id', async(req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);

    try {
        const pacienteResult = await client.query('SELECT * FROM usuarios WHERE id = $1', [usuarioId]);
        if (pacienteResult.rowCount === 0) {
            return res.status(404).send('Paciente no encontrado');
        }
        const paciente = pacienteResult.rows[0];

        const historialesResult = await client.query(
            'SELECT * FROM historial_clinico WHERE usuario_id = $1 ORDER BY created_at DESC', [usuarioId]
        );
        const historiales = historialesResult.rows;

        res.render('admin-lista-historiales', {
            paciente,
            historiales
        });

    } catch (error) {
        console.error('Error al obtener historiales clínicos:', error);
        res.status(500).send('Error en el servidor');
    }
});

// Ruta para imprimir un historial clínico en formato limpio
// Ruta para mostrar todos los historiales clínicos de un paciente
app.get('/admin/historiales-clinicos/:usuario_id/imprimir', async(req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);

    try {
        const pacienteResult = await client.query('SELECT * FROM usuarios WHERE id = $1', [usuarioId]);
        if (pacienteResult.rowCount === 0) {
            return res.status(404).send('Paciente no encontrado');
        }
        const paciente = pacienteResult.rows[0];

        const historialesResult = await client.query(
            'SELECT * FROM historial_clinico WHERE usuario_id = $1 ORDER BY created_at DESC', [usuarioId]
        );
        const historiales = historialesResult.rows;

        res.render('admin-imprimir-todos-historiales', { paciente, historiales });
    } catch (error) {
        console.error('Error al imprimir historiales clínicos:', error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/admin/historial-clinico/:usuario_id/receta/:historial_id', async(req, res) => {
    const { usuario_id, historial_id } = req.params;
    try {
        const pacienteResult = await client.query('SELECT * FROM usuarios WHERE id = $1', [usuario_id]);
        if (pacienteResult.rowCount === 0) return res.status(404).send('Paciente no encontrado');
        const paciente = pacienteResult.rows[0];

        const historialResult = await client.query('SELECT * FROM historial_clinico WHERE id = $1 AND usuario_id = $2', [historial_id, usuario_id]);
        if (historialResult.rowCount === 0) return res.status(404).send('Historial clínico no encontrado');
        const historial = historialResult.rows[0];

        res.render('admin-imprimir-receta', { paciente, historial });
    } catch (error) {
        console.error('Error al obtener receta médica:', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.get('/admin/historial-clinico/:usuario_id/editar/:historial_id', async(req, res) => {
    const { usuario_id, historial_id } = req.params;

    try {
        const pacienteResult = await client.query('SELECT * FROM usuarios WHERE id = $1', [usuario_id]);
        if (pacienteResult.rowCount === 0) return res.status(404).send('Paciente no encontrado');
        const paciente = pacienteResult.rows[0];

        const historialResult = await client.query('SELECT * FROM historial_clinico WHERE id = $1 AND usuario_id = $2', [historial_id, usuario_id]);
        if (historialResult.rowCount === 0) return res.status(404).send('Historial clínico no encontrado');
        const historial = historialResult.rows[0];

        res.render('admin-editar-historial', { paciente, historial });
    } catch (error) {
        console.error('Error en GET editar historial:', error);
        res.status(500).send('Error en el servidor');
    }
});

app.post('/admin/historial-clinico/:usuario_id/editar/:historial_id', async(req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);
    const historialId = parseInt(req.params.historial_id);

    const {
        codigo_hc,
        tratamientos,
        observaciones,
        odontograma_json,
        medicamentos,
        prescripcion,
        codigo_diagnostico,
        nombre_diagnostico
    } = req.body;

    try {
        const historialResult = await client.query('SELECT * FROM historial_clinico WHERE id = $1 AND usuario_id = $2', [historialId, usuarioId]);
        if (historialResult.rowCount === 0) {
            return res.status(404).send('Historial clínico no encontrado');
        }

        await client.query(`
            UPDATE historial_clinico SET
                codigo_hc = $1,
                tratamientos = $2,
                medicamentos = $3,
                prescripcion = $4,
                observaciones = $5,
                odontograma_json = $6,
                codigo_diagnostico = $7,
                nombre_diagnostico = $8
            WHERE id = $9 AND usuario_id = $10
        `, [
            codigo_hc,
            tratamientos,
            medicamentos,
            prescripcion,
            observaciones,
            odontograma_json,
            codigo_diagnostico || null,
            nombre_diagnostico || null,
            historialId,
            usuarioId
        ]);

        res.redirect(`/admin/historial-clinico/${usuarioId}?mensaje=Historial%20actualizado%20correctamente&tipoMensaje=success`);
    } catch (error) {
        console.error('Error al editar historial clínico:', error);
        res.redirect(`/admin/historial-clinico/${usuarioId}?mensaje=Error%20al%20editar%20el%20historial&tipoMensaje=error`);
    }
});


//Ruta POST para eliminar historial clínico (desde el modal)
app.post('/admin/historial-clinico/eliminar', async(req, res) => {
    const { id } = req.body;

    try {
        // Buscar el historial para obtener usuario_id y redirigir después
        const historialResult = await client.query('SELECT usuario_id FROM historial_clinico WHERE id = $1', [id]);
        if (historialResult.rowCount === 0) {
            return res.status(404).send('Historial clínico no encontrado');
        }
        const usuarioId = historialResult.rows[0].usuario_id;

        // Eliminar historial
        await client.query('DELETE FROM historial_clinico WHERE id = $1', [id]);

        // Redirigir a lista de historiales del paciente
        res.redirect(`/admin/historiales-clinicos/${usuarioId}`);

    } catch (error) {
        console.error('Error al eliminar historial clínico:', error);
        res.status(500).send('Error en el servidor');
    }
});

//listar todos los historiales clinicos - panel home
app.get('/admin-todos-historiales', async(req, res) => {
    try {
        const result = await client.query(`
            SELECT hc.*, u.nombre 
            FROM historial_clinico hc 
            JOIN usuarios u ON hc.usuario_id = u.id 
            ORDER BY hc.created_at DESC
        `);

        res.render('admin-lista-historiales', { historiales: result.rows });
    } catch (error) {
        console.error('Error al obtener historiales clínicos:', error);
        res.status(500).send('Error al obtener los historiales clínicos');
    }
});


app.get('/admin/citas-agendadas', async(req, res) => {
    try {
        // Consultar todas las citas agendadas en la base de datos
        const result = await client.query('SELECT * FROM citas ORDER BY fecha, hora');
        const citas = result.rows;

        // Renderizar la vista con las citas
        res.render('admin-citas-agendadas', { citas });
    } catch (error) {
        console.error('Error al obtener citas agendadas:', error);
        res.status(500).send('Error al obtener citas agendadas');
    }
});

// Suponiendo que 'client' es tu cliente de PostgreSQL ya configurado
app.post('/admin/citas/agregar', async(req, res) => {
    try {
        const { usuario_id, cedula, nombre, fecha, hora, especialidad } = req.body;

        // Validaciones básicas (puedes ampliar)
        if (!usuario_id || !cedula || !nombre || !fecha || !hora || !especialidad) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
        }

        // Verificar si ya existe una cita a la misma hora, fecha y especialidad (por ejemplo)
        const checkQuery = `
            SELECT COUNT(*) FROM citas
            WHERE fecha = $1 AND hora = $2 AND especialidad = $3
        `;
        const checkResult = await client.query(checkQuery, [fecha, hora, especialidad]);
        const count = parseInt(checkResult.rows[0].count);

        if (count > 0) {
            return res.status(400).json({ error: 'Ya existe una cita agendada a esa fecha, hora y especialidad.' });
        }

        // Insertar nueva cita
        const insertQuery = `
            INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await client.query(insertQuery, [usuario_id, cedula, nombre, fecha, hora, especialidad]);

        // Obtener el correo del paciente
        const result = await client.query('SELECT correo FROM usuarios WHERE cedula = $1', [cedula]);
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Paciente no encontrado.' });
        }
        const correoPaciente = result.rows[0].correo;

        // Correo de confirmación
        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com', // Cambia esto por tu correo
            to: correoPaciente,
            subject: 'Confirmación de Cita Agendada',
            html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          
            <div style="text-align: center;">
            <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
            </div>
            <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita Odontológica</h2>
            <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>

            <p style="font-size: 16px;">Tu cita ha sido agendada con éxito en el consultorio odontológico. Los detalles de tu cita son los siguientes:</p>

            <ul style="font-size: 16px;">
                <li><strong>Fecha:</strong> ${fecha}</li>
                <li><strong>Hora:</strong> ${hora}</li>
                <li><strong>Especialidad:</strong> ${especialidad}</li>
            </ul>

            <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>

            <p style="font-size: 16px; font-weight: bold;">Atentamente,</p>
            <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado</p>
            <p style="font-size: 16px; font-weight: bold;">Odontología Especializada</p>
        </div>
    `
        };

        // Enviar correo
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('Error al enviar el correo:', error);
            } else {
                console.log('Correo enviado:', info.response);
            }
        });

        // Responder al cliente
        return res.status(200).json({ success: 'Cita agendada correctamente. Un correo de confirmación ha sido enviado.' });
    } catch (error) {
        console.error('Error al agregar cita:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


//Buscar nombre y usuario_id con la cedula
app.get('/buscar-usuario', async(req, res) => {
    const { cedula } = req.query;
    try {
        const result = await client.query(
            'SELECT id AS usuario_id, nombre FROM usuarios WHERE cedula = $1 LIMIT 1', [cedula]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Paciente no encontrado' });
        }
    } catch (error) {
        console.error('Error al buscar paciente:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Ruta GET para mostrar formulario de edición de cita
app.get('/admin/citas/editar/:id', async(req, res) => {
    console.log('PUT /admin-editar/:id recibido');
    console.log('req.body:', req.body);
    const citaId = req.params.id;

    try {
        const result = await client.query('SELECT * FROM citas WHERE id = $1', [citaId]);

        if (result.rows.length === 0) {
            return res.status(404).send('Cita no encontrada');
        }

        const cita = result.rows[0];

        // Renderiza la vista con la cita para editar
        res.render('admin-editar-cita', { cita, message: null });
    } catch (error) {
        console.error('Error al obtener la cita:', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.post('/admin/citas/editar/:id', async(req, res) => {
    const id = req.params.id;
    const { fecha, hora, especialidad } = req.body;

    try {
        // Actualizar cita en BD
        await client.query(
            'UPDATE citas SET fecha = $1, hora = $2, especialidad = $3 WHERE id = $4', [fecha, hora, especialidad, id]
        );

        // Redirigir o devolver JSON de éxito
        res.redirect('/admin-citas-agendadas?success=Cita%20actualizada%20correctamente.');
    } catch (error) {
        console.error('Error al editar cita:', error);
        res.render('admin-editar-cita', { error: 'Error al actualizar cita', cita: req.body });
    }
});


app.post('/admin/citas/editar/:id', async(req, res) => {
    const id = req.params.id;
    const { fecha, hora, especialidad } = req.body;

    try {
        // Actualizar cita en BD
        await client.query(
            'UPDATE citas SET fecha = $1, hora = $2, especialidad = $3 WHERE id = $4', [fecha, hora, especialidad, id]
        );

        // Redirigir o devolver JSON de éxito
        res.redirect('/admin-citas-agendadas?success=Cita%20actualizada%20correctamente.');
    } catch (error) {
        console.error('Error al editar cita:', error);
        res.render('admin-editar-cita', { error: 'Error al actualizar cita', cita: req.body });
    }
});


// Eliminar cita desde el administrador
app.post('/admin/citas/eliminar', async(req, res) => {
    try {
        // Obtener el ID de la cita desde el body
        const citaId = req.body.id;

        if (!citaId) {
            return res.status(400).send('ID de cita es requerido');
        }

        // Obtener los detalles de la cita que se eliminará
        const citaResult = await client.query('SELECT cedula, nombre, fecha, hora, especialidad FROM citas WHERE id = $1', [citaId]);
        if (citaResult.rows.length === 0) {
            return res.status(404).send('Cita no encontrada');
        }

        const { cedula, nombre, fecha, hora, especialidad } = citaResult.rows[0];

        // Obtener el correo del paciente mediante la cédula
        const pacienteResult = await client.query('SELECT correo FROM usuarios WHERE cedula = $1', [cedula]);
        if (pacienteResult.rows.length === 0) {
            return res.status(400).send('Paciente no encontrado');
        }

        const correoPaciente = pacienteResult.rows[0].correo;


        // Eliminar la cita de la base de datos
        await client.query('DELETE FROM citas WHERE id = $1', [citaId]);

        // Correo de cancelación
        const mailOptions = {
            from: 'dra.joselinedelgado.consultorio@gmail.com', // Cambia esto por tu correo
            to: correoPaciente, // Correo del paciente
            subject: 'Cancelación de Cita Agendada',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(54, 152, 244);">Cancelación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>

                    <p style="font-size: 16px;">Lamentamos informarte que tu cita en el consultorio odontológico ha sido cancelada. Los detalles de la cita eran los siguientes:</p>

                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>

                    <p style="font-size: 16px;">Si deseas reprogramar la cita, por favor, contáctanos.</p>

                    <p style="font-size: 16px; font-weight: bold;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold;">Odontología Especializada</p>
                </div>
            `
        };

        // Enviar correo
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('Error al enviar el correo:', error);
                return res.status(500).send('Error al enviar el correo de cancelación');
            } else {
                console.log('Correo de cancelación enviado:', info.response);
            }
        });

        // Redirigir o responder después de la eliminación y el envío del correo
        res.redirect('/admin/citas-agendadas'); // Ajusta la ruta según sea necesario
    } catch (error) {
        console.error('Error al eliminar cita:', error);
        res.status(500).send('Error al eliminar la cita');
    }
});


const storageTestimonio = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/testimonio'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Nombre único con timestamp + extensión original
    }
});

const uploadTestimonio = multer({ storage: storageTestimonio });
// Obtener testimonios
app.get('/admin-testimonios', async(req, res) => {
    try {
        const result = await client.query('SELECT * FROM testimonios ORDER BY creado_en DESC');
        res.render('admin-testimonios', { testimonios: result.rows, message: null });
    } catch (error) {
        console.error(error);
        res.render('admin-testimonios', { testimonios: [], message: { type: 'danger', text: 'Error al cargar testimonios' } });
    }
});

// Guardar testimonio
app.post('/admin-testimonios', uploadTestimonio.single('foto'), async(req, res) => {
    const { nombre, mensaje } = req.body;
    let foto_url = null;
    if (req.file) {
        foto_url = req.file.filename;
    }
    try {
        await client.query('INSERT INTO testimonios(nombre, mensaje, foto_url) VALUES($1, $2, $3)', [nombre, mensaje, foto_url]);
        res.redirect('/admin-testimonios');
    } catch (error) {
        console.error(error);
        res.redirect('/admin-testimonios');
    }
});

// Editar testimonio
app.post('/admin-testimonios/editar/:id', uploadTestimonio.single('foto'), async(req, res) => {
    const { id } = req.params;
    const { nombre, mensaje } = req.body;
    let query, params;
    if (req.file) {
        query = 'UPDATE testimonios SET nombre=$1, mensaje=$2, foto_url=$3 WHERE id=$4';
        params = [nombre, mensaje, req.file.filename, id];
    } else {
        query = 'UPDATE testimonios SET nombre=$1, mensaje=$2 WHERE id=$3';
        params = [nombre, mensaje, id];
    }
    try {
        await client.query(query, params);
        res.redirect('/admin-testimonios');
    } catch (error) {
        console.error(error);
        res.redirect('/admin-testimonios');
    }
});

// Eliminar testimonio
app.post('/admin-testimonios/eliminar/:id', async(req, res) => {
    const { id } = req.params;
    try {
        await client.query('DELETE FROM testimonios WHERE id=$1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.json({ success: false });
    }
});


//NOTIFICACION - guardar notificación cuando agendas cita
app.post('/api/citas', async(req, res) => {
    const usuario_id = req.session.user && req.session.user.id;
    console.log('ID del usuario desde sesión:', usuario_id);

    if (!usuario_id) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const { cedula, nombre, fecha, hora, especialidad } = req.body;

    try {
        const horaCorta = hora.substring(0, 5);
        const fechaObj = new Date(fecha);
        const fechaFormateada = fechaObj.toLocaleDateString('es-EC');

        const mensaje = `Usted agendó una cita para el ${fechaFormateada} a las ${horaCorta} con la Dra. Josselin Delgado`;

        // Guardar la cita
        await client.query(
            'INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad) VALUES ($1, $2, $3, $4, $5, $6)', [usuario_id, cedula, nombre, fecha, horaCorta, especialidad]
        );

        // Guardar la notificación
        await client.query(
            'INSERT INTO notificaciones (usuario_id, mensaje) VALUES ($1, $2)', [usuario_id, mensaje]
        );

        res.json({ mensaje });
    } catch (error) {
        console.error('Error al agendar cita:', error);
        res.status(500).json({ error: 'Error al guardar cita' });
    }
});



//Crear endpoint para traer notificaciones de un usuario:
app.get('/api/notificaciones/usuario', async(req, res) => {
    const usuario_id = req.session.user ? req.session.user.id : null;


    if (!usuario_id) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    try {
        const result = await client.query(
            'SELECT id, mensaje, leida FROM notificaciones WHERE usuario_id = $1 ORDER BY fecha DESC', [usuario_id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener notificaciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


//Endpoint para marcar una notificación como leída
app.put('/api/notificaciones/:id/leida', async(req, res) => {
    const { id } = req.params;

    try {
        await client.query(
            'UPDATE notificaciones SET leida = TRUE WHERE id = $1', [id]
        );
        res.sendStatus(200);
    } catch (error) {
        console.error('Error al marcar como leída:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para buscar citas
app.get('/admin/citas/buscar', async(req, res) => {
    const query = req.query.query.trim();

    try {
        let citas;

        if (!query) {
            // Si el campo de búsqueda está vacío, obtener todas las citas
            citas = await client.query('SELECT * FROM citas');
        } else {
            // Filtrar por cédula o nombre
            citas = await client.query(
                `SELECT * FROM citas 
                WHERE cedula ILIKE $1 OR nombre ILIKE $1`, [`%${query}%`] // Parámetro de búsqueda (cédula o nombre)
            );
        }

        res.json({ citas: citas.rows });
    } catch (err) {
        console.error('Error al buscar citas:', err);
        res.status(500).json({ error: 'Error al buscar las citas' });
    }
});

// Ruta para mostrar la lista de usuarios
app.get('/admin-lista-usuarios', async(req, res) => {
    try {
        const result = await client.query('SELECT * FROM usuarios');
        const usuarios = result.rows;
        res.render('admin-lista-usuarios', { usuarios });
    } catch (error) {
        console.error('Error al obtener los usuarios:', error);
        res.status(500).send('Error al obtener los usuarios');
    }
});

app.get('/admin/usuarios', async(req, res) => {
    try {
        const result = await client.query('SELECT * FROM usuarios');
        const usuarios = result.rows;

        // Pasamos las variables success_msg y error_msg desde res.locals
        res.render('admin-lista-usuarios', {
            usuarios: usuarios,
            success_msg: res.locals.success_msg,
            error_msg: res.locals.error_msg
        });

        // Limpiar después de pasar los mensajes
        delete res.locals.success_msg;
        delete res.locals.error_msg;

    } catch (error) {
        console.error('Error al obtener los usuarios:', error);
        res.status(500).send('Error al obtener los usuarios');
    }
});


// Ruta para eliminar un usuario
app.post('/admin/usuarios/eliminar', async(req, res) => {
    const { id } = req.body;

    try {
        await client.query('DELETE FROM usuarios WHERE id = $1', [id]);
        res.locals.success_msg = 'Cuenta eliminada con éxito';
        res.redirect('/admin/usuarios');
    } catch (error) {
        console.error('Error al eliminar el usuario:', error);
        res.locals.error_msg = 'Error al eliminar la cuenta';
        res.redirect('/admin/usuarios');
    }
});



// Ruta para bloquear un usuario
app.post('/admin/usuarios/bloquear', async(req, res) => {
    const { id } = req.body;

    try {
        // Actualiza el campo bloqueado a TRUE
        await client.query('UPDATE usuarios SET bloqueado = TRUE WHERE id = $1', [id]);
        res.locals.success_msg = 'Cuenta bloqueada con éxito';
        res.redirect('/admin/usuarios');
    } catch (error) {
        console.error('Error al bloquear el usuario:', error);
        res.locals.error_msg = 'Error al bloquear la cuenta';
        res.redirect('/admin/usuarios');
    }
});

// Ruta para desbloquear un usuario
app.post('/admin/usuarios/desbloquear', async(req, res) => {
    const { id } = req.body;

    try {
        // Actualiza el campo bloqueado a FALSE
        await client.query('UPDATE usuarios SET bloqueado = FALSE WHERE id = $1', [id]);
        res.locals.success_msg = 'Cuenta desbloqueada con éxito';
        res.redirect('/admin-lista-usuarios');
    } catch (error) {
        console.error('Error al desbloquear el usuario:', error);
        res.locals.error_msg = 'Error al desbloquear la cuenta';
        res.redirect('/admin/usuarios');
    }
});




// Iniciar el servidor
app.listen(4000, () => {
    console.log('Servidor en http://localhost:4000');
});
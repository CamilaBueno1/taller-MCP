// ============================================================
// Servidor MCP (Model Context Protocol) que expone herramientas
// para consultar/gestionar tareas guardadas en Supabase.
// Se comunica por stdio (entrada/salida estándar).
// ============================================================

// Carga las variables definidas en el archivo .env dentro de process.env
import 'dotenv/config';
// McpServer: clase con la que se declara el servidor y sus herramientas (tools)
import {McpServer} from '@modelcontextprotocol/server';
// serveStdio: arranca el servidor escuchando por stdin y respondiendo por stdout
import {serveStdio} from '@modelcontextprotocol/server/stdio';
// Cliente oficial de Supabase para hacer consultas a la base de datos
import {createClient} from '@supabase/supabase-js';
// Zod: define y valida el "inputSchema" (parámetros) de cada herramienta
import * as z from 'zod/v4';

// Credenciales de Supabase tomadas del entorno
const {EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY} = process.env;

// Validación temprana: si falta alguna credencial, avisa y detiene el proceso
if (!EXPO_PUBLIC_SUPABASE_URL || !EXPO_PUBLIC_SUPABASE_KEY) {
  console.error('Revisa las variables del archivo .env')
  process.exit(1);

}

// Cliente de Supabase reutilizado por todas las herramientas
const supabase = createClient(EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY);

// Valores permitidos para el campo "estado" (se reutiliza en el esquema de Zod)
const estados =['pendiente', 'en progreso', 'completada'];

// Da formato a una respuesta exitosa según lo que espera MCP:
// un array "content" con un bloque de texto (aquí, el JSON indentado)
const exito = (datos) => ({
  content: [{type: 'text', text : JSON.stringify(datos, null , 2)}]
})

// Fábrica del servidor: crea una instancia nueva con sus herramientas
function crearServidor() {
  // Metadatos de identificación del servidor
  const server = new McpServer({
    name: 'taller-supabase', version: '1.0.0'
  });

  // ----------------------------------------------------------
  // Herramienta 1: listar_tareas
  // Lee la tabla "tareas_mcp", opcionalmente filtrada por
  // estado y con un número máximo de filas.
  // ----------------------------------------------------------
  server.registerTool('listar_tareas', {
    // Texto que el cliente/LLM usa para saber cuándo llamar a la herramienta
    description: 'Lista tareas de Supabase; filtra por estado',
    // Contrato de entrada: estado opcional + límite de 1 a 30 (10 por defecto)
    inputSchema: z.object({
      estado: z.enum(estados).optional(),
      limite: z.number().int().min(1).max(30).default(10)
    })
  }, async ({ estado, limite }) => {
    // Construye la consulta: columnas a traer, orden por id y límite de filas
    let consulta = supabase.from('tareas_mcp')
      .select('id,titulo,estado').order('id').limit(limite);
    // Si se indicó un estado, agrega el filtro (eq = igual a)
    if (estado) consulta = consulta.eq('estado', estado);
    // Ejecuta la consulta; el objeto es "thenable", por eso se usa await
    const { data, error } = await consulta;
    // Si Supabase responde con error, se devuelve como error de la herramienta
    if (error) return {
      isError: true,
      content: [{ type: 'text', text: error.message }]
    };
    // Si todo salió bien, devuelve las filas formateadas
    return exito(data);
  });
  // ----------------------------------------------------------
  // Herramienta 2: buscar_tareas
  // Busca coincidencias de texto dentro del título (sin distinguir
  // mayúsculas/minúsculas) y devuelve hasta 20 resultados.
  // ----------------------------------------------------------
  server.registerTool('buscar_tareas',{
    // Texto que el cliente/LLM usa para saber cuándo llamar a la herramienta
    description:'Busca tareas por texto dentro del titulo',
    // Contrato de entrada: solo un texto de búsqueda
    inputSchema: z.object({
        // .trim() quita espacios sobrantes; debe medir entre 2 y 10 caracteres
        texto : z.string().trim().min(2).max(10)
    })

  },async ({texto}) => {
    // Consulta la tabla seleccionando las mismas columnas que listar_tareas
    const {data, error} = await supabase
    .from('tareas_mcp')
    .select('id,titulo,estado')
    // ilike = búsqueda LIKE sin distinguir mayúsculas/minúsculas;
    // los % permiten que el texto aparezca en cualquier parte del título
    .ilike('titulo', `%${texto}%`)
    // Ordena por id y limita a 20 filas para no traer demasiados datos
    .order('id').limit(20);
    // Si Supabase devuelve error, se responde como error de la herramienta
    if (error)return{
        isError: true,
        content: [{type: 'text', text: error.message}]

    }
    // Éxito: devuelve las tareas encontradas ya formateadas
    return exito(data)
  })

  // ----------------------------------------------------------
  // Herramienta 3: crear_tarea
  // Inserta una nueva fila en la tabla "tareas_mcp" y devuelve
  // la tarea recién creada (ya con su id generado).
  // ----------------------------------------------------------
  server.registerTool('resumen_tareas', {
    description: 'Cuentame cuantas tareas existen por estado',
    inputSchema : z.object([])
  }, async () =>{
    const conteos = [];
    for (const estados of estados ){
        const {count, error} = await supabase 
        .from ('tareas_mcp')
        .select('id',{count: 'exact', head: true})
        .eq('estado', estado);
        if (error)return{
            isError : true,
            content:[{type: 'text', text: error.message}]

        };
        conteos.push({estado, cantidad: count ?? 0});
    }
    return exito(conteos);

  })

  return server;
}

// Inicia el servidor por stdio. serveStdio recibe la fábrica y crea
// una instancia del servidor por cada conexión de cliente.
serveStdio(crearServidor);
console.error('Servidor MCP iniciado (stdio)');

import { createServer } from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'
import { detectRuntimes, resolveCommand, RUNTIME_CATALOG } from './runtimes.js'
import { startSession, writeToSession, resizeSession, killSession, listActiveSessions } from './sessions.js'
import { listSessions, listEvents, recordEvent } from './db.js'

const PORT = process.env.PORT ? Number(process.env.PORT) : 7845

const app = express()
app.use(express.json())

// CORS restrito a origens locais (frontend Vite / build)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'vertice-core', version: '0.1.0' })
})

app.get('/api/runtimes', async (_req, res) => {
  res.json({ runtimes: await detectRuntimes() })
})

app.get('/api/catalog', (_req, res) => {
  res.json({ catalog: RUNTIME_CATALOG })
})

app.post('/api/sessions', async (req, res) => {
  const { agentId, runtimeId, cwd } = req.body ?? {}
  const runtime = RUNTIME_CATALOG.find((item) => item.id === runtimeId)
  if (!agentId || !runtime) return res.status(400).json({ error: 'agentId e runtimeId válidos são obrigatórios' })
  try {
    const command = await resolveCommand(runtime.command)
    const session = startSession({ agentId, command, args: runtime.sessionArgs, cwd, onEvent: broadcast })
    broadcast({ type: 'session-started', ...session })
    res.json({ session })
  } catch (error) {
    res.status(500).json({ error: `Falha ao iniciar sessão: ${error.message}` })
  }
})

app.get('/api/sessions', (_req, res) => {
  res.json({ active: listActiveSessions(), history: listSessions() })
})

app.post('/api/sessions/:id/input', (req, res) => {
  const ok = writeToSession(req.params.id, String(req.body?.data ?? ''))
  res.status(ok ? 200 : 404).json({ ok })
})

app.post('/api/sessions/:id/resize', (req, res) => {
  const ok = resizeSession(req.params.id, Number(req.body?.cols) || 120, Number(req.body?.rows) || 30)
  res.status(ok ? 200 : 404).json({ ok })
})

app.delete('/api/sessions/:id', (req, res) => {
  const ok = killSession(req.params.id)
  if (ok) broadcast({ type: 'session-ended', sessionId: req.params.id })
  res.status(ok ? 200 : 404).json({ ok })
})

app.get('/api/events', (_req, res) => {
  res.json({ events: listEvents() })
})

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(event) {
  const payload = JSON.stringify(event)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload)
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello', service: 'vertice-core', version: '0.1.0' }))
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'input' && msg.sessionId) writeToSession(msg.sessionId, String(msg.data ?? ''))
      if (msg.type === 'resize' && msg.sessionId) resizeSession(msg.sessionId, msg.cols, msg.rows)
    } catch { /* ignora mensagens inválidas */ }
  })
})

recordEvent(null, 'Serviço local do Vértice iniciado', 'system')

server.listen(PORT, () => {
  console.log(`[vertice-core] ouvindo em http://localhost:${PORT} (ws em /ws)`)
})

// Runs the API server (holds the Anthropic key) and the workbench dev server together.
import { spawn } from 'node:child_process'

const procs = [
  spawn('npm', ['run', 'dev', '-w', '@breve/server'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', '@breve/workbench'], { stdio: 'inherit' }),
]
const stop = () => procs.forEach((p) => p.kill())
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0) }))

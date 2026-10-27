import { createRoot } from 'react-dom/client'
import App from './App'
import { editor } from './store/editor'
import { lib } from './store/library'
import * as maskops from './store/maskops'
import { ui } from './store/ui'
import './styles.css'

// Stores for browser tests during development.
if (import.meta.env.DEV) Object.assign(window, { __gl: { ui, lib, editor, maskops } })

// No StrictMode: the detail view owns a WebGL context that must not be created twice.
createRoot(document.getElementById('root')!).render(<App />)

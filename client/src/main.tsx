import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from '@/context/ThemeContext'
import { TimeFormatProvider } from '@/context/TimeFormatContext'
import { applyThemeToDocument, getStoredTheme } from '@/lib/theme'

applyThemeToDocument(getStoredTheme())

const FONT_BOOTSTRAP_MS = 150

async function mountApp() {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('#root not found')

  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('400 1em "Geist Variable"'),
        document.fonts.load('400 1em "Geist Mono Variable"'),
      ]),
      new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, FONT_BOOTSTRAP_MS)
      }),
    ])
  } catch {
    /* use metric-matched fallbacks */
  }

  createRoot(rootEl).render(
    <ThemeProvider>
      <TimeFormatProvider>
        <App />
      </TimeFormatProvider>
    </ThemeProvider>,
  )
}

void mountApp()

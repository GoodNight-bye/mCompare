import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { setMonacoTheme } from './monaco'

const savedTheme = localStorage.getItem('mcompare-theme')
setMonacoTheme(savedTheme === 'light' ? 'light' : 'dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

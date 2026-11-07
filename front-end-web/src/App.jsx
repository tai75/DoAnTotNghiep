import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import AppRoutes from './routes/AppRoutes'
import './App.css'
import DeferredChatWidget from './components/DeferredChatWidget'

function App() {
  return <BrowserRouter><AuthProvider><NotificationProvider><AppRoutes /><DeferredChatWidget /></NotificationProvider></AuthProvider></BrowserRouter>
}

export default App

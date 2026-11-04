import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import AppRoutes from './routes/AppRoutes'
import './App.css'
import DeferredChatWidget from './components/DeferredChatWidget'

function App() {
  return <BrowserRouter><AuthProvider><AppRoutes /><DeferredChatWidget /></AuthProvider></BrowserRouter>
}

export default App

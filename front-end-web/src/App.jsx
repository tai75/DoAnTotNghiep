import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import AppRoutes from './routes/AppRoutes'
import './App.css'
import ChatWidget from './components/ChatWidget'

function App() {
  return <BrowserRouter><AuthProvider><AppRoutes /><ChatWidget /></AuthProvider></BrowserRouter>
}

export default App

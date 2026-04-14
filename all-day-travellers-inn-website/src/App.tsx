import './App.css'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AvailabilityPage from './pages/AvailabilityPage'
import BookNowPage from './pages/BookNowPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AvailabilityPage />} />
        <Route path="/book-now" element={<BookNowPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
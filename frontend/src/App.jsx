import { useState } from 'react'
import api from './api'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [responseTime, setResponseTime] = useState(null)

  const handleFetchData = async () => {
    setLoading(true)
    setError(null)
    const startTime = performance.now()
    try {
      const response = await api.get('/')
      const endTime = performance.now()
      setData(response.data)
      setResponseTime(Math.round(endTime - startTime))
    } catch (err) {
      console.error(err)
      setError(
        err.response?.data?.message ||
        err.message ||
        'Không thể kết nối tới backend. Hãy đảm bảo FastAPI đang chạy tại http://localhost:8000'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="badge-row">
          <span className="badge tech-badge">FastAPI + React</span>
          <span className="badge endpoint-badge">GET /</span>
        </div>

        <h1 className="title">Kiểm tra kết nối Frontend - Backend</h1>
        <p className="subtitle">
          Nhấn nút bên dưới để gửi request tới backend (<code>http://localhost:8000/</code>) và hiển thị dữ liệu phản hồi.
        </p>

        <div className="action-area">
          <button
            type="button"
            className={`btn-test ${loading ? 'btn-loading' : ''}`}
            onClick={handleFetchData}
            disabled={loading}
          >
            {loading ? (
              <span className="spinner-wrapper">
                <span className="spinner"></span>
                <span>Đang kết nối...</span>
              </span>
            ) : (
              <span>Lấy dữ liệu từ Backend</span>
            )}
          </button>
        </div>

        {error && (
          <div className="result-box error-box">
            <div className="result-header">
              <span className="status-dot status-error"></span>
              <strong>Kết nối thất bại</strong>
            </div>
            <p className="error-message">{error}</p>
            <div className="tip-box">
              <span>Gợi ý: Chạy lệnh sau trong thư mục <code>backend</code>:</span>
              <pre className="command-preview">uvicorn main:app --reload --port 8000</pre>
            </div>
          </div>
        )}

        {data && !error && (
          <div className="result-box success-box">
            <div className="result-header">
              <div className="status-info">
                <span className="status-dot status-success"></span>
                <strong>Kết nối thành công (200 OK)</strong>
              </div>
              {responseTime !== null && (
                <span className="response-time">{responseTime} ms</span>
              )}
            </div>
            <div className="data-preview">
              <span className="data-label">Dữ liệu nhận được:</span>
              <pre className="json-display">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

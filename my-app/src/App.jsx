import { AmapMap } from './components/AmapMap'
import './App.css'

function App() {
  return (
    <main className="app">
      <h1>my-app</h1>
      <section className="app-map-section" aria-label="地图">
        <h2>地图</h2>
        <AmapMap />
      </section>
    </main>
  )
}

export default App

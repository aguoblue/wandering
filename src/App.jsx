import { useCallback, useRef, useState } from 'react'
import { AmapMap } from './components/AmapMap'
import { Favorites } from './components/Favorites'
import './App.css'

function App() {
  const mapRef = useRef(null)
  const [selectedLocation, setSelectedLocation] = useState(null)

  const handleMapLocationSelect = useCallback((location) => {
    setSelectedLocation(location)
  }, [])

  const handleFavoriteSelect = useCallback((favorite) => {
    mapRef.current?.showLocation(favorite)
  }, [])

  return (
    <main className="app">
      <h1>我的地图应用</h1>
      <div className="app-content">
        <aside className="app-sidebar">
          <Favorites
            onSelectLocation={handleFavoriteSelect}
            selectedLocation={selectedLocation}
          />
        </aside>
        <section className="app-map-section" aria-label="地图">
          <h2>地图</h2>
          <AmapMap ref={mapRef} onLocationSelect={handleMapLocationSelect} />
        </section>
      </div>
    </main>
  )
}

export default App

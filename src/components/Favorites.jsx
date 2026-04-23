import { useEffect, useState } from 'react'

const FAVORITES_STORAGE_KEY = 'map-favorites'

const normalizeLocation = (location) => {
  if (!location) return null

  if (typeof location === 'string') {
    const [lng, lat] = location.split(',').map((value) => Number(value.trim()))
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat }
    }
  }

  if (Array.isArray(location) && location.length >= 2) {
    const lng = Number(location[0])
    const lat = Number(location[1])
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat }
    }
  }

  if (typeof location.getLng === 'function' && typeof location.getLat === 'function') {
    const lng = Number(location.getLng())
    const lat = Number(location.getLat())
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat }
    }
  }

  if ('lng' in location && 'lat' in location) {
    const lng = Number(location.lng)
    const lat = Number(location.lat)
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat }
    }
  }

  if ('longitude' in location && 'latitude' in location) {
    const lng = Number(location.longitude)
    const lat = Number(location.latitude)
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat }
    }
  }

  return null
}

const normalizeFavorite = (favorite) => {
  const location = normalizeLocation(favorite?.location)
  if (!location) return null

  return {
    ...favorite,
    location,
    address: favorite?.address || '地址未知'
  }
}

/** 列表展示名：优先备注，否则用地图解析的名称，再退回地址 */
const deriveFavoriteTitle = (remark, selectedLocation, address) => {
  const r = remark?.trim()
  if (r) return r
  const fromMap = selectedLocation?.name?.trim()
  if (fromMap) return fromMap
  const addr = address?.trim()
  if (addr) return addr
  return '收藏地点'
}

const loadFavorites = () => {
  try {
    const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!savedFavorites) return []

    const parsedFavorites = JSON.parse(savedFavorites)
    if (!Array.isArray(parsedFavorites)) return []

    return parsedFavorites
      .map(normalizeFavorite)
      .filter(Boolean)
  } catch (e) {
    console.error('加载收藏夹失败:', e)
    return []
  }
}

/**
 * 收藏夹组件
 * 管理收藏的地点，支持添加、查看、删除操作
 */
export function Favorites({ onSelectLocation, selectedLocation }) {
  const [favorites, setFavorites] = useState(loadFavorites)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFavorite, setNewFavorite] = useState({
    remark: '',
    address: '',
    location: null
  })

  const sortedFavorites = [...favorites].sort((a, b) => {
    if (a.lastUsed && b.lastUsed) {
      return new Date(b.lastUsed) - new Date(a.lastUsed)
    }
    return new Date(b.createdAt) - new Date(a.createdAt)
  })

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites))
    } catch (e) {
      console.error('保存收藏夹失败:', e)
    }
  }, [favorites])

  const effectiveAddress = newFavorite.address || selectedLocation?.address || ''
  const effectiveLocation = normalizeLocation(selectedLocation?.location) || normalizeLocation(newFavorite.location)
  const resolvedTitle = deriveFavoriteTitle(newFavorite.remark, selectedLocation, effectiveAddress)

  const handleAddFavorite = () => {
    if (!effectiveLocation) {
      alert('请先选择位置')
      return
    }

    const favorite = {
      id: Date.now().toString(),
      name: resolvedTitle,
      address: effectiveAddress || '地址未知',
      location: effectiveLocation,
      createdAt: new Date().toISOString()
    }

    setFavorites((prev) => [...prev, favorite])
    setNewFavorite({ remark: '', address: '', location: null })
    setShowAddForm(false)
  }

  const handleDeleteFavorite = (id) => {
    if (window.confirm('确定要删除这个收藏吗？')) {
      setFavorites((prev) => prev.filter((fav) => fav.id !== id))
    }
  }

  const handleSelectFavorite = (favorite) => {
    onSelectLocation?.(favorite)

    setFavorites((prev) => prev.map((fav) =>
      fav.id === favorite.id ? { ...fav, lastUsed: new Date().toISOString() } : fav
    ))
  }

  return (
    <div className="favorites-panel">
      <div className="favorites-header">
        <h3>我的收藏</h3>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? '取消' : '添加收藏'}
        </button>
      </div>

      {showAddForm && (
        <div className="add-favorite-form">
          <h4>添加新收藏</h4>
          <div className="form-group">
            <label>备注（选填）</label>
            <input
              type="text"
              value={newFavorite.remark}
              onChange={(e) => setNewFavorite({ ...newFavorite, remark: e.target.value })}
              placeholder="留空则使用地图地点名称"
            />
            <small className="field-help">
              展示名称：{resolvedTitle}
            </small>
          </div>
          <div className="form-group">
            <label>地址</label>
            <input
              type="text"
              value={effectiveAddress}
              onChange={(e) => setNewFavorite({ ...newFavorite, address: e.target.value })}
              placeholder="可选"
            />
          </div>
          <div className="form-group">
            <label>位置</label>
            <input
              type="text"
              value={effectiveLocation ? `${effectiveLocation.lng},${effectiveLocation.lat}` : ''}
              readOnly
              placeholder="请在地图上点击选择位置"
              className="readonly-input"
            />
            <small className="field-help">
              打开表单后，可在地图上点击或通过搜索选择位置
            </small>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAddFavorite}
          >
            保存
          </button>
        </div>
      )}

      <div className="favorites-list">
        {sortedFavorites.length === 0 ? (
          <p className="empty-message">暂无收藏</p>
        ) : (
          sortedFavorites.map((favorite) => {
            const favoriteLocation = normalizeLocation(favorite.location)
            if (!favoriteLocation) {
              return null
            }

            return (
            <div key={favorite.id} className="favorite-item">
              <div className="favorite-info">
                <h4>{favorite.name}</h4>
                <p className="favorite-address">{favorite.address}</p>
                <p className="favorite-coords">
                  {favoriteLocation.lng.toFixed(6)}, {favoriteLocation.lat.toFixed(6)}
                </p>
                {favorite.lastUsed && (
                  <p className="favorite-last-used" style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                    最后使用: {new Date(favorite.lastUsed).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="favorite-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => handleSelectFavorite(favorite)}
                  title="定位到此处"
                >
                  定位
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDeleteFavorite(favorite.id)}
                  title="删除"
                >
                  删除
                </button>
              </div>
            </div>
            )
          })
        )}
      </div>

      <style jsx>{`
        .favorites-panel {
          background: white;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          max-height: 600px;
          display: flex;
          flex-direction: column;
        }

        .favorites-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .favorites-header h3 {
          margin: 0;
          font-size: 18px;
        }

        .add-favorite-form {
          background: #f5f5f5;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 16px;
        }

        .add-favorite-form h4 {
          margin: 0 0 12px 0;
          font-size: 16px;
        }

        .form-group {
          margin-bottom: 12px;
        }

        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-size: 14px;
          color: #666;
        }

        .form-group input {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .readonly-input {
          background: #f0f0f0;
          cursor: not-allowed;
        }

        .field-help {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          color: #666;
        }

        .favorites-list {
          overflow-y: auto;
          flex: 1;
        }

        .favorite-item {
          display: flex;
          justify-content: space-between;
          align-items: start;
          padding: 12px;
          border: 1px solid #eee;
          border-radius: 4px;
          margin-bottom: 8px;
          transition: all 0.2s;
        }

        .favorite-item:hover {
          background: #f9f9f9;
          border-color: #007aff;
        }

        .favorite-info {
          flex: 1;
        }

        .favorite-info h4 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 500;
        }

        .favorite-address {
          margin: 0 0 4px 0;
          font-size: 14px;
          color: #666;
        }

        .favorite-coords {
          margin: 0;
          font-size: 12px;
          color: #999;
        }

        .favorite-actions {
          display: flex;
          gap: 4px;
        }

        .btn {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #007aff;
          color: white;
        }

        .btn-primary:hover {
          background: #0056b3;
        }

        .btn-danger {
          background: #dc3545;
          color: white;
        }

        .btn-danger:hover {
          background: #c82333;
        }

        .btn-sm {
          padding: 4px 8px;
          font-size: 12px;
        }

        .empty-message {
          text-align: center;
          color: #999;
          padding: 20px 0;
        }
      `}</style>
    </div>
  )
}

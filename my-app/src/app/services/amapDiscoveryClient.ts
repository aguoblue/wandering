import AMapLoader from '@amap/amap-jsapi-loader';

export interface DiscoveryCenter {
  name: string;
  address: string;
  location: [number, number];
}

export interface DiscoverySuggestion extends DiscoveryCenter {
  id: string;
}

export interface NearbyPoi {
  id: string;
  name: string;
  category: 'scenic' | 'food';
  type: string;
  address: string;
  location: [number, number];
  distance?: number;
  tel?: string;
}

let amapPromise: Promise<any> | null = null;

const asLocationTuple = (location: any): [number, number] | null => {
  if (!location) return null;

  if (Array.isArray(location) && location.length >= 2) {
    const lngFromArray = Number(location[0]);
    const latFromArray = Number(location[1]);
    if (Number.isFinite(lngFromArray) && Number.isFinite(latFromArray)) {
      return [lngFromArray, latFromArray];
    }
  }

  if (typeof location === 'string' && location.includes(',')) {
    const [lngText, latText] = location.split(',');
    const lngFromText = Number(lngText);
    const latFromText = Number(latText);
    if (Number.isFinite(lngFromText) && Number.isFinite(latFromText)) {
      return [lngFromText, latFromText];
    }
  }

  const lng = Number(location.lng ?? location.getLng?.());
  const lat = Number(location.lat ?? location.getLat?.());

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [lng, lat];
};

const ensureAmap = async () => {
  if (!amapPromise) {
    const amapKey = import.meta.env.VITE_AMAP_KEY;
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

    if (!amapKey) {
      throw new Error('缺少 VITE_AMAP_KEY，无法调用高德定位服务。');
    }

    if (securityCode) {
      (window as Window & { _AMapSecurityConfig?: { securityJsCode: string } })._AMapSecurityConfig = {
        securityJsCode: securityCode
      };
    }

    amapPromise = AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.Geolocation']
    });
  }

  return amapPromise;
};

/** 浏览器 Geolocation API 返回 WGS84；高德地图与逆地理接口使用 GCJ-02，需先转再画点。 */
const convertGpsToGcj02 = (AMap: any, wgs84: [number, number]): Promise<[number, number]> => {
  return new Promise((resolve, reject) => {
    AMap.convertFrom(wgs84, 'gps', (status: string, result: any) => {
      if (status === 'complete' && result?.info === 'ok' && result.locations?.length) {
        const loc = result.locations[0];
        const lng = Number(loc.lng ?? loc.getLng?.());
        const lat = Number(loc.lat ?? loc.getLat?.());
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          resolve([lng, lat]);
          return;
        }
      }
      reject(new Error('GPS 坐标无法转换为高德坐标，请稍后重试。'));
    });
  });
};

const reverseGeocode = (
  AMap: any,
  location: [number, number]
): Promise<{ name: string; address: string }> => {
  return new Promise((resolve) => {
    const geocoder = new AMap.Geocoder({
      radius: 1000,
      extensions: 'all'
    });

    geocoder.getAddress(location, (status: string, result: any) => {
      if (status !== 'complete' || result?.info !== 'OK') {
        resolve({
          name: '当前位置',
          address: '当前位置附近'
        });
        return;
      }

      const geocode = result.regeocode ?? {};
      const addressComponent = geocode.addressComponent ?? {};
      const city = String(addressComponent.city || addressComponent.province || '当前位置');
      const district = String(addressComponent.district || '');
      const township = String(addressComponent.township || '');
      const name = township || district || city || '当前位置';
      const address = String(geocode.formattedAddress || `${city}${district}` || '当前位置附近');

      resolve({
        name,
        address
      });
    });
  });
};

export async function locateCenterByKeyword(keyword: string): Promise<DiscoveryCenter> {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    throw new Error('请输入想搜索的地点。');
  }

  const AMap = await ensureAmap();

  const pois = await new Promise<any[]>((resolve, reject) => {
    const placeSearch = new AMap.PlaceSearch({
      pageSize: 10,
      pageIndex: 1,
      city: '全国',
      citylimit: false,
      extensions: 'all'
    });

    placeSearch.search(trimmedKeyword, (status: string, result: any) => {
      if (status !== 'complete' || result?.info !== 'OK') {
        reject(new Error('地点搜索失败，请稍后重试。'));
        return;
      }

      resolve(result.poiList?.pois ?? []);
    });
  });

  const centerPoi = pois.find((poi) => asLocationTuple(poi.location));
  if (!centerPoi) {
    throw new Error('没有找到可定位的地点，请换个关键词试试。');
  }

  const centerLocation = asLocationTuple(centerPoi.location);
  if (!centerLocation) {
    throw new Error('搜索结果缺少坐标信息，请换个关键词。');
  }

  const addressParts = [centerPoi.cityname, centerPoi.adname, centerPoi.address].filter(Boolean);

  return {
    name: String(centerPoi.name ?? trimmedKeyword),
    address: addressParts.join(' ') || '定位到该地点附近',
    location: centerLocation
  };
}

export async function searchLocationSuggestions(keyword: string): Promise<DiscoverySuggestion[]> {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return [];
  }

  const AMap = await ensureAmap();

  const pois = await new Promise<any[]>((resolve, reject) => {
    const placeSearch = new AMap.PlaceSearch({
      pageSize: 8,
      pageIndex: 1,
      city: '全国',
      citylimit: false,
      extensions: 'all'
    });

    placeSearch.search(trimmedKeyword, (status: string, result: any) => {
      if (status !== 'complete' || result?.info !== 'OK') {
        reject(new Error('地点提示获取失败，请稍后重试。'));
        return;
      }

      resolve(result.poiList?.pois ?? []);
    });
  });

  return pois
    .map((poi) => {
      const location = asLocationTuple(poi.location);
      if (!location) return null;

      const addressParts = [poi.cityname, poi.adname, poi.address].filter(Boolean);
      const name = String(poi.name ?? trimmedKeyword);
      const address = addressParts.join(' ') || name;

      return {
        id: String(poi.id ?? `${name}-${location[0]}-${location[1]}`),
        name,
        address,
        location
      } satisfies DiscoverySuggestion;
    })
    .filter((item): item is DiscoverySuggestion => Boolean(item));
}

export type LocateByLocationOptions = {
  /** 为 true 时表示 location 来自 navigator.geolocation（WGS84），会先转 GCJ-02 */
  fromBrowserGps?: boolean;
};

export async function locateCenterByLocation(
  location: [number, number],
  options?: LocateByLocationOptions
): Promise<DiscoveryCenter> {
  const AMap = await ensureAmap();
  const lnglat =
    options?.fromBrowserGps === true
      ? await convertGpsToGcj02(AMap, location)
      : location;

  const geocode = await reverseGeocode(AMap, lnglat);

  return {
    name: geocode.name,
    address: geocode.address,
    location: lnglat
  };
}

type SearchNearbyByKeywordOptions = {
  keyword: string;
  category: 'scenic' | 'food';
  location: [number, number];
  radius: number;
  pageSize: number;
};

const searchNearbyByKeyword = async (
  options: SearchNearbyByKeywordOptions
): Promise<NearbyPoi[]> => {
  const AMap = await ensureAmap();
  const { keyword, category, location, radius, pageSize } = options;

  const pois = await new Promise<any[]>((resolve, reject) => {
    const placeSearch = new AMap.PlaceSearch({
      pageSize,
      pageIndex: 1,
      city: '全国',
      citylimit: false,
      extensions: 'all'
    });

    placeSearch.searchNearBy(keyword, location, radius, (status: string, result: any) => {
      if (status !== 'complete' || result?.info !== 'OK') {
        reject(new Error('周边搜索失败'));
        return;
      }

      resolve(result.poiList?.pois ?? []);
    });
  });

  return pois
    .map((poi) => {
      const poiLocation = asLocationTuple(poi.location);
      if (!poiLocation) return null;

      return {
        id: String(poi.id ?? `${category}-${poi.name}-${poiLocation[0]}-${poiLocation[1]}`),
        name: String(poi.name ?? keyword),
        category,
        type: String(poi.type ?? ''),
        address: String(poi.address ?? poi.name ?? ''),
        location: poiLocation,
        distance: Number.isFinite(Number(poi.distance)) ? Number(poi.distance) : undefined,
        tel: String(poi.tel ?? '')
      } satisfies NearbyPoi;
    })
    .filter((item): item is NearbyPoi => Boolean(item));
};

export async function searchNearbyPois(
  location: [number, number],
  options?: { radius?: number; perCategoryLimit?: number }
): Promise<NearbyPoi[]> {
  const radius = options?.radius ?? 1500;
  const perCategoryLimit = options?.perCategoryLimit ?? 10;

  const [scenic, food] = await Promise.all([
    searchNearbyByKeyword({
      keyword: '景点',
      category: 'scenic',
      location,
      radius,
      pageSize: perCategoryLimit
    }),
    searchNearbyByKeyword({
      keyword: '美食',
      category: 'food',
      location,
      radius,
      pageSize: perCategoryLimit
    })
  ]);

  const deduped = new Map<string, NearbyPoi>();
  [...scenic, ...food].forEach((poi) => {
    const key = `${poi.category}-${poi.name}-${poi.location[0].toFixed(6)}-${poi.location[1].toFixed(6)}`;
    if (!deduped.has(key)) {
      deduped.set(key, poi);
    }
  });

  return Array.from(deduped.values());
}
